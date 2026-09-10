# Notifications, calls, and security — implementation report (2026‑09‑10)

Repo: `Mi-guel851/whisper`, branch `arena/01a08a7f-whisper`, on top of PR #44 (`be85e05`).
This report covers the six workstreams requested: security closure, durable rate
limiting, payment/transfer integrity, view‑once honesty, server‑enforced uploads,
session revocation + auth hygiene — and the notification/call experience: friends‑only
feed alerts, the event→notification matrix, WhatsApp‑like incoming calls, and
persistent missed calls.

**Read the “Not verified in this environment” section before believing anything here.**
Everything below was verified at source level and through the toolchain (typecheck,
tests, lint, build, audit). None of it was executed against your Supabase project,
a real Android device, or a push provider — I don't have access to those from here.

---

## 1. What was implemented

### 1.1 Notification targeting (friends‑only, per‑event, deduped) — `supabase/migrations/202609100003_notification_targeting.sql`

One transaction (`begin;` … `commit;`), idempotent (everything is `if not exists` /
`create or replace` / `drop trigger if exists`).

| # | Section | What it does |
|---|---------|--------------|
| T1 | Preferences | `profiles` gains `notify_feed_posts`, `notify_replies`, `notify_friend_requests`, `notify_coin_transfers`, `notify_calls` (boolean; **NULL means ON**, only `false` mutes — pre‑existing profiles keep their current behavior). Per‑column SELECT+UPDATE grants are rebuilt for exactly these columns (202609100002 narrowed profiles grants; anything unlisted would be invisible to the UI and to `security invoker` checks). |
| T2 | Types | `notifications.type` CHECK extended with `reply`, `coin_transfer`, `call`. |
| T3 | Dedup | Unique index `notifications_user_type_source_uniq (user_id, type, source_id)` (drops a legacy partial duplicate first if present, with a `raise warning` escape hatch); every insert site uses untargeted `on conflict do nothing` so a database that still carries duplicates skips instead of aborting the user action. |
| T4 | Feed posts | `notify_new_public_feed_post()` computes the audience **once** — accepted friends of the author (either direction, matching the two‑row storage), never the author, no block either way, neither side banned, recipient's global + `notify_feed_posts` prefs — and writes `public_feed_notifications` + `notifications` from that same array, then pushes in 200‑recipient batches to `notify-new-feed-post` with `recipients` in the payload. **All‑users/followers broadcast paths are gone.** |
| T5 | Replies | `notify_feed_reply()` on `public_feed_posts` inserts: exactly one recipient — the author of whatever is being replied to (thread root for nested replies); no self‑notify; block/ban excluded; recipient's `notify_replies` preference respected. |
| T6 | Transfers | `notify_coin_transfer_received()` on committed `coin_transfers` rows: recipient only, `completed` only, no self‑notify, body is the amount (never a balance), `notify_coin_transfers` pref respected, dedup makes a replayed idempotency key unable to double‑notify. |
| T7 | Rewritten legacy triggers | `notify_new_direct_message()` (exactly one recipient: the other participant; content‑aware body without paths; **no broadcast fan‑out remains**), `notify_friend_request_events()` (pending → recipient, `pending→accepted` → requester, prefs on both, no self‑notify), `notify_new_whisper_record()` (recipient only), and `purge_friend_request_notification()` — a pending request that is declined or withdrawn (both are row DELETEs) removes its ghost alert; accepted history is never rewritten. |
| — | Push | `deliver_notification_push()` (already on the table from 202608190003) is redefined: every notification row rides one path to `notify-on-notification`, the global pref is checked at send time, `public_feed` rows skip it (batched in T4). The standalone dashboard webhook is retired: the `notify-new-whisper` edge function now answers `skipped` immediately, and `notify-new-direct-message` no‑ops too, so no second delivery path can double‑notify. |

Settings UI: `components/NotificationSettingsCard.tsx` on `/settings` — one global
switch (`push_notifications`, re‑registers the native push token when turned back on)
and five category switches that write **exactly** the columns the triggers read,
optimistic with rollback on failure. `/notifications` now renders
`components/NotificationActivityList.tsx`: the persistent `notifications` history with
deep links (only server‑written `metadata.route` values that are same‑origin paths),
click‑marks‑read as its only write.

### 1.2 Incoming calls — server‑authoritative lifecycle — `supabase/migrations/202609100005_call_lifecycle.sql` + `lib/calls/useVoiceCall.ts`

The old flow kept the whole call in component state: refresh, background or a dead
tab lost the state machine, and “missed” never existed as a fact. Now:

* `call_logs` gains `call_id uuid unique` (client‑minted UUID = idempotency key) and a
  `status` machine `ringing → answered → completed | declined | canceled | missed | expired | busy`, plus a `missed` boolean for cheap reading, backfilled from legacy rows.
* **`start_call_log(p_call_id, p_conversation_id)`** (authenticated, `security definer`):
  participants of a real conversation only (42501 otherwise); friends only; blocks and
  bans enforced here regardless of what any client checked; first **lazily expires** our
  own stale ringing rows (> 60 s) so a dead tab can't leave a call "ringing" forever;
  refuses **before creating a row** if the peer is busy (a busy attempt never becomes a
  phantom missed entry); inserts the ringing row replay‑safely (`on conflict (call_id)
  do nothing` → hands back the original with `replayed: true`); writes the callee's
  `call` notification row gated on their prefs/blocks — **the DB row and the push can
  no longer disagree** — and reports `alerted` so the caller knows whether anyone will
  actually be woken.
* **`end_call_log(p_call_id, p_outcome)`**: `for update`‑locked transition table —
  caller may only `canceled`/`missed` while ringing, callee only `answered`/`declined`/`busy`
  while ringing, **either** side `completed` after answer, everything else returns
  `{ignored: true}` instead of a P2002 red‑screen on a double hang‑up. Answering marks
  the ring alert read; a genuine miss (missed/expired) inserts the callee's "Missed
  Voice Call" row addressed to the conversation; **every** terminal end posts a
  `cancel` to `notify-on-notification` so the ringing UI dies on all of the callee's
  devices, not just the one that acted. Decline/busy settle the *loser's* row server‑side —
  the caller's own row never flips to answered.
* **`expire_stale_calls()`** (service‑role only): sweeps ringing > 60 s → `expired`
  (+missed flag), posts the missed notice and the cancel. Wired as Vercel Cron
  (`vercel.json`: `/api/calls/sweep` every minute, `CRON_SECRET`‑authorized) — but it
  is an *accelerator*: the lazy sweep inside `start_call_log` already guarantees honesty
  even if cron never runs.
* Realtime: `call_logs` added to `supabase_realtime` (DO‑wrapped), and a policy on
  `realtime.messages` restricts `whisper-call:<conversation>` broadcast topics to
  conversation participants (UUID‑regex‑guarded so a malformed topic can't error every
  client), with the non‑call‑topics allow policy preserved so nothing else breaks.

### 1.3 The missed call lives in the chat (WhatsApp parity, web included)

`app/chat/[conversationId]/page.tsx` fetches `call_logs` for the conversation and
subscribes to its realtime topic; entries merge into the message stream by timestamp
(`visibleTimeline`) and render as `components/chat/CallEntryRow.tsx` — **no message
rows are fabricated**, so RLS and chat history stay untouched. Statuses read as:
*Missed voice call* / *No answer* / *Call declined* / *Call cancelled* / *Calling…* /
*Voice call · m:ss*, with **Call back** for every unanswered ending (callee side, friend
still accepted; the server re‑checks all of it inside `start_call_log` anyway). A
ringing row older than 75 s renders as a miss even before the sweep agrees, so the UI
never lies “still calling” about a dead call.

### 1.4 Device push plumbing

* `notify-on-notification` (redeploy): per‑type Android channels (`whispers`,
  `messages`, `friend_requests`, `feed`, `coins`, `calls`), re‑checks the global pref at
  send time, rings get `collapse_key: call-<call_id>` + 60 s TTL (matching SQL expiry —
  a ring that arrives after hang‑up is worse than none), everything else collapses per
  post/conversation; `data.type` written **last** so trigger metadata can't shadow the
  router key; `action:"cancel"` messages are data‑only `call_cancel` per device token,
  and dead tokens are pruned from real FCM 4xx responses.
* Android `FCMMessagingService` (rebuild required): `calls` channel with the system
  **ringtone** on the ring‑tone stream (the whisper‑ring bug class — reusing the default
  ding — stays fixed), non‑ongoing‑banner policy respected (`areNotificationsEnabled`
  gate first), full‑screen intent (permission declared in the manifest) with
  `setOngoing(true)` + `setTimeoutAfter(60_000)` + `VISIBILITY_PRIVATE`/publicVersion,
  stable ids derived from `call_id` so `call_cancel` finds its own row; feed deep links
  land on `/public-feed?post=…`, coin receipts on the coins channel.
* Web: `app/api/send-push` payload carries `tag` + `type`; `public/sw.js` collapses by
  tag, **suppresses the banner when a visible window is already on the target surface**
  (posts `whisper:notification` in‑app instead), and honors `dismiss-notifications` so
  an answered/ended ring clears on every tab. `NotificationProvider` toasts are skipped
  on the same surface. The notification **row** and unread count are server‑side and
  unaffected by suppression — by design, suppression is display‑level only.
* Foreground UX: `IncomingCallOverlay` is a modal full‑screen dialog (opaque, Escape =
  decline, focus handling + live region); backgrounding keeps the ringing alive because
  the client watchdog no longer cancels when `document.hidden`.

### 1.5 Security closure (the other half of the request)

* **Durable rate limiting** (`202609100004`): `rate_limit_windows` + atomic
  `rate_limit_consume()` RPC (`insert … on conflict … returning` in one statement,
  fixed window, service‑role only, no client writes). `lib/apiGuard.ts` now awaits it,
  **fails closed** on real DB faults for sensitive buckets, and only degrades to the
  in‑memory layer for “migration not applied yet”. Awaiting `consume(...)` was wired
  into every sensitive route: recovery, admin verify‑pin, paystack verify (IP+user,
  `consumeMulti`), coin posting (feed‑post/reply), creator posting, TURN credentials,
  and the view‑once/photo‑view endpoints (40–60 views/min per user).
* **Payments/ownership** (`202609100004`): `ensure_coin_wallet`, `credit_verified_payment`
  (advisory xact‑lock on the reference → replay returns the existing balance, missing
  wallet created, single UPDATE→ledger pair, `P0002` if the row moved under it),
  `revoke_user_sessions`, and feed‑photo ownership enforcement for the friends feed.
  Paystack verification and transfer settlement were already atomic (repo‑owned credit
  fn + `refund_whisper_coins_for` authorization, 202609100001); replayed references hit
  the ledger's unique key.
* **View‑once honesty**: photo/audio/feed‑photo view endpoints claim the row atomically
  server‑side (202609100001) with per‑user rate buckets now added on top — a burst can
  no longer read the claim loop as an oracle.
* **Server‑enforced uploads**: `/api/cloudinary/sign` requires the caller's Bearer JWT,
  allows only `whisper/<kind>/<owner>` with `owner === user.id` (single deliberate
  exception: `whisper/message-images/<recipientId>` for DM media, whose rows are still
  owner‑checked at write time), no deeper nesting, and `max_file_size` comes from the
  **server policy** — the client's `sizeLimit` is UX, not enforcement. Without
  `CLOUDINARY_API_KEY/SECRET` the route answers 503 and the client degrades loudly to
  the unsigned preset (documented transitional state).
* **Session revocation after phrase reset**: `reset-with-phrase` calls
  `revoke_user_sessions` so old sessions die with the password.
* **PKCE, no token logging**: `AppUrlHandler` is rewritten to consume **only** `?code=`
  via `exchangeCodeForSession`; a URL carrying `access_token`/`refresh_token` is
  refused with a loud `console.error` pointing at dashboard config, and its hash is
  scrubbed. No code path stores URL‑borne tokens anymore. The route map was also fixed
  (`/public-feed?post=`, `/premium` — several old targets 404'd or lost their params).
* **CSP (measurement → enforcement)**: `middleware.ts` emits the full intended policy
  as **`Content-Security-Policy-Report-Only`** with a per‑request nonce piped to Next
  via `x-nonce`, reports land at `/api/csp-report` (bounded, query‑stripped). The
  unbreakable directives (`frame-ancestors 'none'; object-src 'none'; base-uri 'self';
  form-action 'self'`) are already enforced from `next.config.ts`. Flip to enforcement
  after a clean week of reports (see §4.6).
* **Audit + secret scans**: see §3.

---

## 2. Deploy order (exact — in this order; steps 2–4 can't wait on each other randomly)

### 2.1 SQL (Supabase dashboard → SQL editor, one file per run, whole file at once)

Each file is `begin; … commit;` and safe to re‑run. Watch the `NOTICE`/`WARNING` lines
in the output — they are the degradation reports (e.g. `T3: duplicate notification rows
still exist…` means dedup is skipped until you prune legacy rows; everything else still
works).

1. `supabase/migrations/202609100003_notification_targeting.sql`
2. `supabase/migrations/202609100004_durable_guards_and_payments.sql`
3. `supabase/migrations/202609100005_call_lifecycle.sql`

If you deploy via CLI instead: `supabase db push` (same order, same scripts).

### 2.2 Edge functions (dashboard → Edge Functions → Deploy, from `supabase/functions/`)

```bash
supabase functions deploy notify-on-notification
supabase functions deploy notify-new-feed-post
supabase functions deploy notify-new-whisper      # retired stub — deploying it closes the webhook path
```
(`notify-new-direct-message` / `notify-friend-request` are deployed‑but‑unused; the
first now also no‑ops. You may delete both once 0003 is live.)

### 2.3 Dashboard webhooks

Database → Webhooks: **delete** the legacy `notify-new-whisper` HTTP trigger on
`public.messages` if present. Optional while the stub is deployed (it answers
`skipped`), but removal is what makes “one delivery path” structural.
`/api/send-push` (the HTTP fallback route) is only reachable with `PUSH_WEBHOOK_SECRET`
— nothing needs to point at it anymore.

### 2.4 Environment variables

Vercel project settings (add/set before the redeploy):

| Var | Why |
|-----|-----|
| `CRON_SECRET` | Authorizes `/api/calls/sweep` (Vercel sends it as `Authorization: Bearer`). Without it the cron call 401s — harmless (lazy sweep covers correctness) but the accelerator does nothing. |
| `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Enables `/api/cloudinary/sign`. Until set, uploads keep working via the unsigned preset with a logged warning — **this is the one security item that is transitional by design.** |
| `ADMIN_GRANT_PIN` | Pre‑existing requirement; re‑verify it's set (missing it returns 500 on admin verify with an explicit configuration error). |

### 2.5 Redeploy the app (Next/Vercel)

`vercel.json` (cron `* * * * *` → `/api/calls/sweep`) takes effect on this deploy.
The middleware (CSP report‑only), the new `/api/*` routes, the chat timeline and
settings surfaces ship together.

### 2.6 Android

Rebuild and distribute the APK (FCM service changes are **breaking for call UX** —
old builds keep working at legacy quality: no full‑screen, no per‑type channels, no
remote banner cancel). `npx cap sync android && cd android && ./gradlew assembleRelease`
per your usual flow. iOS: nothing new to build (see §5.2).

---

## 3. What was verified **in this sandbox** (and how)

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` (full typecheck) | ✅ clean |
| `npm test` (whole `tests/` suite, incl. new `tests/notification-targeting.test.mjs` 25 tests + extended `tests/security-hardening.test.mjs`) | ✅ exit 0 — 107 PASS lines |
| `npm run lint` | ✅ 0 errors (27 pre‑existing warnings, none from this pass) |
| `npm run build` | ✅ production build compiles, all new routes present |
| `npm audit` | ✅ 0 vulnerabilities (overrides included) |
| Secret grep across app/lib/components/supabase/functions/tests/android (JWTs, sk_live/ghp/bearer literals, PEM bodies) | ✅ no embedded secrets; the only PEM hits are `.replace("-----BEGIN PRIVATE KEY-----", …)` *parsers* that read env‑supplied keys |
| Tracked files hygiene | ⚠️ `android/app/release.keystore` **is tracked in git** (predates this pass, in PR #44's history). No matching password file is tracked and `build.gradle` doesn't reference it — it looks like a scaffold relic, but **a keystore in the repo (and its history) is your call**: if it ever signed a published release, rotate the signing key off‑repo; `git rm` alone does not erase history. |

The SQL was verified statically: function signatures, transition tables, grant/revoke
pairs, trigger attachment, index creation blocks. **It has not been executed** — no
local Postgres here (see §4 for what to run to verify).

## 4. Verification script (run these; they cover what I couldn't)

### 4.1 In the SQL editor (as admin) — one‑liner checks

```sql
-- migrations applied (expect 5, 2, 3 rows of non-empty names):
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and proname in ('rate_limit_consume','ensure_coin_wallet',
   'credit_verified_payment','revoke_user_sessions','start_call_log','end_call_log',
   'expire_stale_calls','purge_friend_request_notification','deliver_notification_push');
-- prefs columns + dedup index:
select column_name from information_schema.columns
 where table_name='profiles' and column_name like 'notify_%';
select indexname from pg_indexes where indexname='notifications_user_type_source_uniq';
-- call_logs published for realtime:
select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='call_logs';
-- legacy DM/whisper broadcast hooks gone (expect 0 rows):
select tgname from pg_trigger where tgname in
 ('notify_new_direct_message_trigger','whisper_notification_webhook');
```

Expect 9 rows. The friend-request ghost cleanup lives in the
`friend_request_delete_purge` trigger (check: `select tgname from pg_trigger where
tgname in ('friend_request_delete_purge','coin_transfer_received_notification',
'feed_reply_notification_trigger','notification_push_delivery');` — expect 4).

### 4.2 Sweep + guard endpoints

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<app-domain>/api/calls/sweep            # 401 (no secret)
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CRON_SECRET" \
     https://<app-domain>/api/calls/sweep                                                  # 200 {"expired":n}
# signed uploads (with a user's access token):
curl -s -H "Authorization: Bearer $USER_JWT" -H 'content-type: application/json' \
     -d '{"folder":"whisper/profile-photos/<your-uid>","expires":'$(date -d '+1 hour' +%s)'}' \
     https://<app-domain>/api/cloudinary/sign | head -c 200                               # signature+policy, or 503 pre-config
# a foreign folder must be refused:
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $USER_JWT" \
     -d '{"folder":"whisper/profile-photos/<someone-elses-uid>"}' \
     https://<app-domain>/api/cloudinary/sign                                             # 403
```

### 4.3 Three‑account matrix (A = caller, B = callee, C = non‑friend control)

All three accounts must be on the **new** Android build for the device rows; the web
client covers the timeline rows on any platform. Make sure A↔B are friends; C is not
friends with A.

| # | Steps | Expect |
|---|-------|--------|
| 1 | A calls B while B's app is **idle in another tab/window** | B's timeline gains `Missed voice call` (within ≤ 1 min of expiry even with the browser closed — the sweep is server-side). `Call back` shown on B; **not** on A (A sees `No answer`). C's chat with A shows nothing. |
| 2 | A calls B, B **declines** | B's row reads `Declined a call`, no miss flag; A sees `Call declined`; both banners stop on every B device (`call_cancel`); A does **not** get a missed entry. |
| 3 | Both live, A calls, B accepts | `Voice call · m:ss` appears for both on hang-up; ring alert becomes read on B; audio flows (TURN creds route is rate‑guarded now — hammering it 61×/min should 429). |
| 4 | B **backgrounds** WhatsApp-style: A calls, B's screen off | Android: full‑screen ring with Accept/Decline (or high‑priority notification on the **calls** channel with ringtone — not the default ding); answering from the lock screen opens the overlay already connected‑pending; the 45 s client watchdog + 60 s server TTL both expire it; after expiry the banner vanishes on its own (setTimeoutAfter) **and** the timeline shows the miss. |
| 5 | B goes into airplane mode, A calls | A's 45 s watchdog → server reports `missed`; when B reconnects: the timeline shows `Missed voice call` (push was lost — TTL 60 s means no zombie ring arriving minutes late; that is the honest behavior, not a bug). |
| 6 | A calls B, then A hangs up before answer | B's devices: banner cancels promptly (`call_cancel` while online). Timeline: B gets `Missed voice call` only if the row expired without seeing it; if B's realtime was connected, the row settles `canceled` → `Call cancelled` for B (no “call back” nudge on a call the caller retracted? — call back **is** shown for canceled/declined/missed/expired; that matches WhatsApp, which offers redial on all four). |
| 7 | C (non‑friend) tries the same | No call entry, no notification, no ringing — `start_call_log` raises 42501 regardless of client. |
| 8 | B had earlier set `notify_calls=false` in Settings | B still gets the timeline row (history is data), but no `call` notification row, no push, no banner; flip it back on → re‑registers the device token. |
| 9 | Reply/transfer/friend matrix | B replies to A's feed post → A gets one Activity row + push on the **feed** surface with `?post=` deep link. A transfers coins to B → B's `coins` channel only, amount in the body, no balance; A gets nothing. A sends B a friend request → B's `friend_requests` channel; B declines → B's alert disappears (delete‑trigger); A resends → one new alert (dedup). |
| 10 | Web push privacy | From any account, whisper B: B's banner reads “New whisper from @…” **without the message text**; the DM banner previews 100 chars; a second DM in the same chat **replaces** the first banner (tag collapse); with the chat tab open & visible, B gets **no banner at all** (suppressed to that surface) but the unread badge still moves. |

### 4.4 Recovery / revocation / auth hygiene

| Check | Expect |
|-------|--------|
| Reset B's password via the recovery phrase, keeping a second device signed in | The old device's next refresh fails (sessions revoked; note: a stateless access token still rides until its ≤ 1 h expiry — GoTrue design, see §5.5). |
| Login flow URL inspection (DevTools Network) | Redirect contains `?code=` only; **never** `access_token`/`refresh_token` in the URL, and no token appears in `console` logs (the app logs nothing auth‑related; the old handler that did is gone). |
| Craft `…#access_token=xyz` visit | Console error about implicit flow + hash scrubbed; no session established from it. |

### 4.5 Rate limits durable (multi‑instance claim)

Fire 41 photo‑views in a minute from one account across two logged‑out devices (or
incognito profile + logged tab): total > 40 must start 429‑ing **even if the two
requests land on different serverless instances** — the bucket lives in Postgres now;
re‑check by `select name, identity, hits from public.rate_limit_windows order by updated_at desc limit 10;`.

### 4.6 CSP → enforcement

Watch reports for a week: `select count(*) from …` — or simply grep the Vercel function
logs for `[csp-report]` volume by `documentURL`/`blocked`. When reports are clean
(only things you intended), replace `Content-Security-Policy-Report-Only` with
`Content-Security-Policy` in `middleware.ts` line ~60 and redeploy. Paystack checkout
and the Cloudinary upload hosts are already in the policy; if you embed anything new
(share previews, external images), it shows up here as a report first, not a break.

## 5. Honest limitations (things this does **not** do)

1. **Web has no background call push.** A ring reaches a browser only while a tab is
   open (realtime) or via normal web push (which can't ring like a phone, can't be
   answered from the banner, and is at the mercy of the OS/browser). The persistent
   timeline row is the web guarantee; the phone is the experience guarantee.
2. **iOS gets no CallKit** — no lock‑screen answer UI. A native iOS build would show a
   standard notification (this web app ships no iOS push path at all today).
3. **Android parity is “high‑priority full‑screen notification”, not the system
   in‑call screen.** No telecom/`ConnectionService` integration (no dialer‑level
   answer/hold/merge, no native call log entry) — that needs a native calling plugin
   and the Dialer role, which changes the app's identity. Vibrate + ringtone +
   full‑screen + not‑fling‑away is what the platform allows a notification to be.
   `USE_FULL_SCREEN_INTENT`'s exemption rules (Android 14: only calling‑category apps
   may bypass) — we set `CATEGORY_CALL`, which is the right channel; on a few OEM
   skins the full‑screen may show as a heads‑up; that's their policy, not our code.
4. **Screenshot/recording of view‑once media cannot be prevented.** Android
   `FLAG_SECURE` (the `SecureScreenPlugin`) is best‑effort: it blocks screenshots and
   recent‑app thumbnails while the app is foregrounded, not camera‑photography of the
   screen, not iOS (no equivalent API), not desktop browsers. The honest protection
   remains: view‑once content is fetched on a single server‑side claim, so **second
   views are impossible**, and previews in push/banners never contain it.
5. **Revoked sessions expire within the hour, not instantly.** GoTrue access tokens are
   stateless; `revoke_user_sessions` kills refresh tokens immediately, and the
   outstanding access token dies at its natural (≤ 60 min) expiry.
6. **Rate windows are fixed‑window counters** — 2× bursts are possible at a window
   boundary. Deliberate: the alternative (sliding ledgers) costs writes we don't need
   for the abuse class these buckets target (credential stuffing, oracle‑hammering,
   payment probing).
7. **Old native builds** never got the new lifecycle: they fall back to the legacy
   direct insert/update path (which is why RLS on `call_logs` stays permissive‑to‑own‑rows
   until you can deprecate them); they miss remote banner cancel and calls channels.
8. **Unsigned uploads until the secret is set.** `/api/cloudinary/sign` 503‑and‑fallback
   is documented transitional; set the two env vars to actually close this.
9. **The dedup index is conditional** on legacy duplicates being absent; if T3 printed
   its warning, dedup is behavioral (on‑conflict) but not schema‑guaranteed until you
   prune and re‑run section T3.
10. Suppression layers (SW skip, toast skip) are **display‑only by design**: the
    notification row and unread count still exist server‑side. If someone expected
    “on‑surface = not recorded”, that's deliberately not the contract (history belongs
    to the account, banners belong to the moment).
11. **Nothing here was run against production data** — see §3/§4.

## 6. Deviations from the plan (stated so the diff is reviewable)

* **Android stable ids**: use the `data.notificationId` hash when present (the server
  only sends it for non‑call pushes), and `call-<call_id>` hash otherwise; the web side
  uses `tag`. A non‑call push without the id falls back to a millis id — acceptable,
  one banner per event either way.
* **`setTimeoutAfter(60_000)`** matches the *server* ring expiry window rather than the
  45 s client watchdog, so the banner never outlives the truth.
* **Full‑screen intent target** is `whisperapp://chat/<conversationId>` (MainActivity →
  `AppUrlHandler` route → the overlay mounts from the live realtime state) instead of a
  dedicated `CallActivity` — fewer moving parts, same outcome, decline/answer both work
  from it.
* The missed‑call *row* on caller‑hangup (`canceled`) shows for the callee too —
  earlier plan had cancels visible to the caller only; WhatsApp shows the callee a
  "missed" on a retracted call, and the timeline copy distinguishes them
  (`Call cancelled` vs `Missed voice call`).
* Friend‑request ghost cleanup is a DB **trigger** (`friend_request_delete_purge`),
  not app code — a DELETE is a DELETE from wherever it comes.
* `notify_friend_requests` prefs gate the **row** (both branches), matching how
  reply/transfer gates read; feed gates its row for a different reason (bell/push
  single source) — the settings copy spells this out rather than pretending uniformity.

## 7. File map (what to review, by area)

```
supabase/migrations/202609100003_notification_targeting.sql   (T1–T7 + push path)
supabase/migrations/202609100004_durable_guards_and_payments.sql (limiter, wallet, revocation)
supabase/migrations/202609100005_call_lifecycle.sql            (state machine, sweep, realtime)
supabase/functions/notify-on-notification/index.ts             (channels, prefs, ttl/collapse, cancel)
supabase/functions/notify-new-feed-post/index.ts               (recipients-only fan-out)
supabase/functions/notify-new-whisper/index.ts                 (retired stub)
app/api/calls/sweep/route.ts + vercel.json                     (cron accelerator)
app/api/cloudinary/sign/route.ts + lib/cloudinary(.server).ts  (signed uploads)
middleware.ts + app/api/csp-report/route.ts + next.config.ts   (CSP nonce/report-only)
lib/apiGuard.ts (durable, awaited) + all sensitive routes
lib/calls/useVoiceCall.ts + lib/calls/signaling.ts + callFormat.ts
app/chat/[conversationId]/page.tsx + components/chat/CallEntryRow.tsx
components/AppUrlHandler.tsx (PKCE-only)
components/NotificationSettingsCard.tsx + NotificationActivityList.tsx
app/notifications/page.tsx, app/settings/page.tsx
app/api/send-push/route.ts (fallback) + public/sw.js (tag/suppress/dismiss)
android: FCMMessagingService.java, AndroidManifest.xml, SecureScreenPlugin.java
tests/notification-targeting.test.mjs (new), tests/security-hardening.test.mjs (extended)
```
