# whisper-native — where the app stands

The Expo app is a port of the Whisper web app, screen for screen. It talks to the
same Supabase project and the same `/api/*` routes as the site; it creates no
tables, no policies, and no Edge Functions of its own.

```
branch   arena/01a09583-whisper
router   expo-router (file-based), app/ is the route tree
build    npx tsc --noEmit clean · expo export (android) succeeds — every import resolves
```

## Verified in this pass (phase 2 — feature parity)

| Requirement | Result |
| --- | --- |
| Routing structure | 29 route files in `app/` (19 from phase 1 + 10 new), all registered in the root Stack and present in the Android export bundle |
| Anonymous send | `whisper.tsx`: the web `/u/[username]` form — sender context from `/api/sender-context`, Cloudinary photo, `sendWhisper` insert; opened from `u.tsx`'s primary button |
| Complete profile | `complete-profile.tsx`: username (web validation), country + phone (`country`/`country_code`/`dial_code`/`phone_number`), consent via `record_consent`, recovery phrase via `/api/set-recovery-phrase`, then `profile_completed = true`. Gated at the `index` fork; `settings` re-checks defensively |
| Friends | `friends.tsx` + `lib/friends.ts`: roster with joins, incoming/outgoing requests, discover scan with friend/pending/blocked exclusion, accept (both rows, `source: "request"`), decline/cancel, unfriend (both rows), start-chat with the 23505 race fallback, pending threads via `ensure_pending_conversation`, realtime on `friend_requests` + `friends` |
| Chat pinning | `conversation.tsx` + `lib/dms.ts`: pin via long-press menu → duration sheet (24 h / 7 d / 30 d / forever), pinned bar under the header with cycle + unpin, pin mark on bubbles, realtime INSERT/DELETE on `pinned_messages`, lazy `sweep_expired_pins` on open |
| Legal / help | `legal.tsx` (+ `lib/legal.ts` verbatim text), `help.tsx` (web's 4 guides + 8 FAQs), `support.tsx` and `feedback.tsx` (category/rating + mailto), `favorites.tsx` (the web's Coming Soon, natively) |
| Discover | `discover.tsx`: the web's feature cards + utility list, all routing natively |
| Games + daily | `games.tsx` + `lib/games.ts`: the web's 8 games, share/copy with the user's link; the Daily Whisper pool (42 prompts, categories, seeded rotation ported line for line) and the feed's question of the day |
| Feed spotlight | `(tabs)/feed.tsx`: Daily Whisper card — `dailyQuestionFor` question, `public_feed_spotlight` post, refreshed on pull-to-refresh |
| Type-check | `npx tsc --noEmit` — zero errors |
| Bundle | `npx expo export --platform android` — 1634 modules, all 10 new routes compiled into the hbc |
| Placeholders | none — no TODO/FIXME anywhere in `app/` |

Phase 1 (the expo-router migration itself) was verified in the previous pass; see
git history.

## The route tree

```
app/
├── _layout.tsx            providers + root Stack; complete-profile is a full stop,
│                          whisper is a modal, hub pages push
├── index.tsx              the fork: session ? (profile complete ? feed : complete-profile) : login
├── (auth)/                _layout guards: signed-in users are redirected (through the fork)
│   ├── onboarding.tsx     animated gradient logo · "Say it. Anonymously." · Get Started
│   ├── login.tsx          signInWithPassword · inline errors · forgot-password link
│   └── signup.tsx         signUp · username in metadata · email-confirmation notice
├── (tabs)/
│   ├── _layout.tsx        floating dark-glass tab bar, gradient pill on the active tab
│   ├── feed.tsx           sorts · topics · search · likes · threads · Daily Whisper card
│   ├── dms.tsx            conversations · previews · unread counts · the 40-coin lock
│   ├── notifications.tsx  whispers (public.messages) + alerts (public.notifications)
│   └── profile.tsx        avatar upload · whisper link · coin badge · your posts · edit sheet
├── complete-profile.tsx   username · country+phone · consent · recovery phrase (2 steps)
├── coins.tsx              4 packages in ₦ · Paystack popup · verify via /api/paystack/verify
├── create-whisper.tsx     composer · photo or poll · topic chips · anonymous locked on
├── conversation.tsx       chat bubbles · voice notes · view-once · pins
├── whisper-detail.tsx     root card · replies · pinned reply composer · coin tip sheet
├── whisper.tsx            anonymous send to one person · sender context · Cloudinary photo
├── friends.tsx            friends · requests · discover tabs · realtime
├── games.tsx              Whisper Games · share/copy prompt + link
├── discover.tsx           feature cards + utility rows
├── legal.tsx              privacy · terms · guidelines (accordion sections)
├── help.tsx               guides grid + FAQ accordion
├── support.tsx            category chips + fields → mailto
├── feedback.tsx           stars + message → mailto
├── favorites.tsx          Coming Soon (parity with the web's own page)
├── settings.tsx           push toggles · wallet address · discover row · logout
├── forgot-password.tsx    username + recovery phrase → /api/reset-with-phrase
├── saved.tsx              saved posts (bookmark) — pointer, not archive
└── u.tsx                  another user's profile · send-whisper CTA · report / block
```

## Deliberate deviations (unchanged, plus two new ones)

* **No voice in the create-whisper composer.** `public_feed_posts` has no audio
  columns and the `voice-messages` bucket's policies are conversation-scoped.
  Voice notes remain chat-only.
* **The sender-context device string is coarser.** The web parses the
  `user-agent` header; a React Native fetch sends no parseable UA, so the app
  reports the platform family ("iPhone" / "Android device") while the location
  half still comes from the same `/api/sender-context` edge route.
* **Support and feedback go through the OS mail app.** The web pages compose a
  `mailto:` too — there is no tickets table anywhere — so the native screens
  hand the same composed message to `Linking.openURL` and say exactly what
  happened ("nothing is sent until you tap send there").
* **`favorites` is a Coming Soon page, on purpose.** The web's `/favorites` is
  the same; inventing storage for it would be a second, worse `saved`.

## Two things only you can do

1. **Payment keys** — the Paystack public key is not in the repo. Set
   `EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY` in `whisper-native/.env` (copy `.env.example`)
   before the Coin Store can charge. Verification is server-side only:
   `/api/paystack/verify` → `credit_verified_payment`. There is no client credit
   path, deliberately.
2. **Push on a device** — `google-services.json` is committed, but a real FCM
   token only arrives on a physical device or a Play-services emulator. Sign in,
   accept the token, and check `profiles.push_token` updated.

Supabase URL and anon key are in the ignored `.env`, so the app talks to the live
backend as soon as it starts:

```
npx expo start          # then press a / i
```

`EXPO_PUBLIC_*` values are inlined at build time, so **changing `.env` requires
restarting the bundler** (`npx expo start --clear`).
