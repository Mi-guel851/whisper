/**
 * Notification targeting, call lifecycle, and the surfaces built on them.
 *
 * WHY THIS FILE EXISTS (and why it is static, like security-hardening.test.mjs)
 * There is no local Postgres here: the notification triggers and call RPCs
 * execute on the Supabase instance once the migrations are applied. These
 * tests assert the source-level invariants the deployed behavior depends on —
 * every recipient set is narrow, every event honors prefs/blocks/no-self/dedup,
 * the call lifecycle exists on BOTH sides (SQL + hook + Android + web SW), and
 * the settings switches write exactly the columns the triggers read. A build
 * passing proves nothing about behavior; a missing guard IS visible in the
 * text, which is what this file checks, clause by clause.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIG = "supabase/migrations";
const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");
const exists = (rel) => existsSync(join(process.cwd(), rel));
const count = (hay, re) => (hay.match(re) || []).length;

/** Slice a file between two literal markers; "" when the start is absent. */
function between(hay, startLiteral, endLiteral) {
  const at = hay.indexOf(startLiteral);
  if (at < 0) return "";
  const end = hay.indexOf(endLiteral, at);
  return hay.slice(at, end < 0 ? undefined : end + endLiteral.length);
}

const m3 = read(`${MIG}/202609100004_notification_targeting.sql`);
const m4 = read(`${MIG}/202609100005_durable_guards_and_payments.sql`);
const m5 = read(`${MIG}/202609100006_call_lifecycle.sql`);

// ---------------------------------------------------------------------------
// Migrations exist; the push trigger chain is intact.
// ---------------------------------------------------------------------------

test("the three 20260910 migrations exist", () => {
  for (const rel of [
    `${MIG}/202609100004_notification_targeting.sql`,
    `${MIG}/202609100005_durable_guards_and_payments.sql`,
    `${MIG}/202609100006_call_lifecycle.sql`,
  ]) {
    assert.ok(exists(rel), `${rel} must exist`);
  }
});

test("the push path is structural: row -> deliver_notification_push -> edge fn", () => {
  // The AFTER INSERT trigger lives in 202608190003 and fires whatever the
  // current definition of deliver_notification_push is; 0003 replaces that
  // definition (whispers join the path, feed rows skip it as batch-pushed).
  const prior = read(`${MIG}/202608190003_notification_delivery.sql`);
  assert.match(prior, /create trigger[\s\S]{0,160}after insert on public\.notifications\s+for each row execute function public\.deliver_notification_push\(\)/, "table trigger exists upstream");
  assert.match(m3, /create or replace function public\.deliver_notification_push\(\)/, "0003 replaces the delivery fn");
  const deliver = between(m3, "create or replace function public.deliver_notification_push()", "\n$$;");
  assert.match(deliver, /if new\.type = 'public_feed' then\s+return new;/, "feed skips the per-row push (batched in its own trigger)");
  assert.match(deliver, /p\.push_notifications is not distinct from false/, "global pref gate on every push");
  assert.match(deliver, /post_to_edge_function\(\s*'notify-on-notification',[\s\S]*?'record', to_jsonb\(new\)/, "the record rides the payload verbatim");
});

// ---------------------------------------------------------------------------
// Preferences: added, granted, typed, and HONORED where the UI promises.
// ---------------------------------------------------------------------------

test("0003 adds the five category prefs and grants the client exactly those columns", () => {
  for (const [col, ord] of [
    ["push_notifications", 1],
    ["notify_feed_posts", 2],
    ["notify_replies", 3],
    ["notify_friend_requests", 4],
    ["notify_coin_transfers", 5],
    ["notify_calls", 6],
  ]) {
    if (ord > 1) {
      assert.ok(m3.includes(`alter table public.profiles add column if not exists ${col} boolean;`), `${col} added`);
    }
    // The grant block enumerates them (202609100002 narrowed profiles to
    // per-column grants; anything unlisted would be invisible to the UI and
    // to the security-invoker checks below).
    assert.ok(m3.includes(`('${col}', ${ord})`), `${col} listed in the grant rebuild`);
  }
  assert.match(m3, /grant select \(%s\) on table public\.profiles to authenticated/, "select granted");
  assert.match(m3, /grant update \(%s\) on table public\.profiles to authenticated/, "update granted");
  // New notification types are accepted by the CHECK constraint.
  assert.match(m3, /check \(type in \('message', 'friend_request', 'public_feed', 'whisper',\s*\n\s*'reply', 'coin_transfer', 'call'\)\)/, "types extended");
});

test("once-per-event dedup: unique index with a legacy-dupe escape hatch", () => {
  assert.match(m3, /create unique index notifications_user_type_source_uniq\s+on public\.notifications \(user_id, type, source_id\)/, "dedup index");
  // Every insert site uses the UNTARGETED form — `on conflict (user_id,
  // type, source_id)` crashes when the index is absent (legacy dupes).
  assert.ok(count(m3, /on conflict do nothing/g) >= 6, "all row inserts dedup untargeted");
  assert.equal(count(m3, /on conflict \(user_id, type, source_id\)/g), 0, "no targeted conflict clause on notifications");
  // The index creation itself tolerates pre-existing duplicates with a warning.
  assert.match(m3, /raise warning 'T3: duplicate notification rows still exist/, "warn-not-fail on legacy dupes");
});

// ---------------------------------------------------------------------------
// The event → recipient matrix. Each event's recipient SQL must be narrow,
// and the narrowness IS the product decision (friends-only, targeted-only).
// ---------------------------------------------------------------------------

test("public-feed posts: author's accepted friends only, never the author, blocks and bans excluded", () => {
  const fn = between(m3, "create or replace function public.notify_new_public_feed_post()", "\n$$;");
  assert.ok(fn.length > 100, "feed trigger must be rewritten in 0003");
  // Friends in EITHER direction (the accept flow writes both rows; either counts).
  assert.match(fn, /\(f\.user_id = new\.author_id and f\.friend_id = p\.id\)[\s\S]*?\(f\.user_id = p\.id and f\.friend_id = new\.author_id\)/, "friends both directions");
  assert.match(fn, /where p\.id <> new\.author_id/, "never the author themself");
  assert.match(fn, /\(b\.user_id = new\.author_id and b\.blocked_user_id = p\.id\)[\s\S]*?\(b\.user_id = p\.id and b\.blocked_user_id = new\.author_id\)/, "blocks both directions");
  assert.match(fn, /not public\.user_is_banned\(p\.id\)/, "recipient ban");
  assert.match(fn, /not public\.user_is_banned\(new\.author_id\)/, "author ban");
  // Prefs gate the recipient set itself (in-app bell and push can't diverge).
  assert.match(fn, /p\.push_notifications is distinct from false\s+and p\.notify_feed_posts is distinct from false/, "global + category pref");
  // The broadcast fan-out view must be gone entirely from this function.
  assert.doesNotMatch(fn, /v_notification_user_targets/, "no all-users broadcast");
  // Replies are not new posts: they must not re-fan-out through this trigger.
  assert.match(fn, /if new\.parent_post_id is not null then\s+return new;/, "replies skip the post trigger");
  // Push goes out in bounded chunks addressed to exactly this list.
  assert.match(fn, /v_chunk_size constant integer := 200/, "batched pushes");
  assert.match(fn, /'recipients', to_jsonb\(v_chunk\)/, "recipients array is the contract");
});

test("feed replies notify exactly the parent's author — never a fan-out", () => {
  const fn = between(m3, "create or replace function public.notify_feed_reply()", "\n$$;");
  assert.match(fn, /select p\.author_id, coalesce\(p\.parent_post_id, p\.id\)[\s\S]*?where p\.id = new\.parent_post_id/, "parent author (thread root for nested replies)");
  assert.match(fn, /if v_parent_author = new\.author_id then\s+return new;/, "no self-notify (replying to your own post is silent)");
  assert.match(fn, /blocked_user_id = v_parent_author/, "block guard");
  assert.match(fn, /or \(b\.user_id = v_parent_author and b\.blocked_user_id = new\.author_id\)/, "block guard, other direction");
  assert.match(fn, /p\.push_notifications is not distinct from false\s+or p\.notify_replies is not distinct from false/, "recipient prefs");
  assert.doesNotMatch(fn, /v_notification_user_targets|unnest\(v_recipients/, "no fan-out anywhere");
  assert.match(fn, /'reply_id', new\.id/, "metadata routes the UI to the thread");
});

test("coin transfers: recipient only, completed rows only, amount without balance", () => {
  const fn = between(m3, "create or replace function public.notify_coin_transfer_received()", "\n$$;");
  assert.match(fn, /if new\.status <> 'completed' or new\.recipient_id is null then/, "failed receipts are silent");
  assert.match(fn, /if new\.recipient_id = new\.sender_id then\s+return new;/, "no self-notify");
  assert.match(fn, /'\+' \|\| new\.amount \|\| ' Whisper Coins'/, "amount only — no balance in the banner");
  assert.doesNotMatch(fn, /balance/, "the word balance must not appear in this function");
  assert.match(fn, /p\.notify_coin_transfers is not distinct from false/, "category pref");
  assert.match(fn, /'route', '\/premium'/, "tap lands on the wallet page that exists");
  // The trigger is attached at the table with a row filter too (belt + braces).
  assert.match(m3, /create trigger coin_transfer_received_notification\s+after insert on public\.coin_transfers\s+for each row\s+when \(new\.status = 'completed'\)/, "trigger + when clause");
});

test("direct messages: exactly one recipient — the other participant — no broadcast, dedup", () => {
  const fn = between(m3, "create or replace function public.notify_new_direct_message()", "\n$$;");
  assert.match(fn, /select case when user_a = new\.sender_id then user_b else user_a end\s+into recipient\s+from public\.conversations/, "recipient = the other side of the conversation");
  assert.match(fn, /if recipient = new\.sender_id then\s+return new;/, "no self-notify");
  assert.match(fn, /if recipient is null then\s+return new;/, "orphan messages never notify");
  assert.doesNotMatch(fn, /v_notification_user_targets|'all'/, "the old broadcast audience branch is gone");
  assert.match(fn, /on conflict do nothing/, "dedup");
  // Media messages notify with descriptions, not paths (and never audio text).
  assert.match(fn, /'🎙️ Sent you a voice note'/, "voice note copy");
  assert.match(fn, /'📷 Sent you a photo'/, "photo copy");
  assert.doesNotMatch(fn, /new\.audio_path,|new\.image_path\b(?!\s*is not null)/, "paths never become the notification body");
});

test("friend requests: prefs on both branches; decline/withdraw leaves no ghost alert", () => {
  const fn = between(m3, "create or replace function public.notify_friend_request_events()", "\n$$;");
  assert.match(fn, /where new\.receiver_id <> new\.sender_id/, "no self-notify on request");
  assert.match(fn, /p\.notify_friend_requests is not distinct from false/, "recipient category pref honored on the request row");
  assert.match(fn, /old\.status = 'pending' and new\.status = 'accepted'/, "acceptance branch fires only on pending→accepted");
  assert.match(fn, /where new\.sender_id <> new\.receiver_id/, "no self-notify on acceptance");
  assert.match(fn, /p\.id = new\.sender_id[\s\S]*?notify_friend_requests is not distinct from false/, "requester's prefs gate the acceptance row");
  assert.match(fn, /'You are now friends on Whisper\.'/, "acceptance copy");
  // Decline and cancel are DELETEs of the pending row; the alert must follow.
  const purge = between(m3, "create or replace function public.purge_friend_request_notification()", "\n$$;");
  assert.match(purge, /if old\.status = 'pending' then/, "only pending deletions purge (unfriend keeps the accepted note)");
  assert.match(purge, /delete from public\.notifications\s+where type = 'friend_request'\s+and source_id = old\.id\s+and user_id = old\.receiver_id/, "exactly the recipient's row for that request");
  assert.match(m3, /create trigger friend_request_delete_purge\s+after delete on public\.friend_requests/, "purge is structural, not app-level");
});

// ---------------------------------------------------------------------------
// Call lifecycle — SQL side.
// ---------------------------------------------------------------------------

test("call_logs: the outcome set, unique call id, and the missed flag", () => {
  // The table itself predates this migration (202609090004); 0005 hardens it.
  assert.match(read(`${MIG}/202609090004_voice_calls.sql`), /create table if not exists public\.call_logs/);
  assert.match(m5, /check \(status in \('ringing','answered','declined','canceled','missed','expired','completed','busy'\)\)/, "outcome set");
  assert.match(m5, /call_logs_call_id_key/, "unique index on call_id (idempotent start)");
  assert.match(m5, /and not missed;/, "backfill is idempotent");
  assert.match(m5, /update public\.call_logs set missed = true where status in \('missed','expired'\)/, "backfill of the missed column");
});

test("start_call_log: membership + blocks + bans first, lazy expiry, busy refusal, replay safety", () => {
  const fn = between(m5, "create or replace function public.start_call_log(", "\n$$;");
  assert.ok(fn.length > 100, "start RPC must exist");
  assert.match(fn, /raise exception 'Cannot start a call\.' using errcode = '42501'/, "non-participants are denied");
  assert.match(fn, /from public\.blocked_users b/, "blocked peers never get rung");
  assert.match(fn, /user_is_banned/, "banned accounts cannot call");
  // Lazy expiry runs BEFORE anything else reads 'ringing' state.
  const expireAt = fn.indexOf("set status = 'expired'");
  const insertAt = fn.indexOf("insert into public.call_logs");
  assert.ok(expireAt > 0 && expireAt < insertAt, "stale rows expire before the new row lands");
  assert.match(fn, /cl\.started_at < now\(\) - interval '60 seconds'/, "60s window");
  // Busy = refuse BEFORE creating a row (a busy attempt must never become a
  // phantom missed entry).
  const busyAt = fn.indexOf("return jsonb_build_object('status', 'busy');");
  assert.ok(busyAt > 0 && busyAt < insertAt, "busy returns before any insert");
  assert.match(fn, /cl\.callee_id = v_peer and cl\.status = 'ringing' and cl\.started_at > now\(\) - interval '60 seconds'/, "busy check: live ringing for the peer");
  assert.match(fn, /cl\.caller_id = v_peer and cl\.status = 'answered'/, "busy check: peer on a live call");
  // Replay safety: same call_id hands back the original row instead of failing.
  assert.match(fn, /on conflict \(call_id\) where call_id is not null do nothing/, "replay-tolerant insert");
  assert.match(fn, /'replayed', true/, "replay answer says so");
  // The callee alert row: prefs-gated, once-per-call, conversation-routed.
  assert.match(fn, /'Incoming call 📞'/, "ringing title");
  assert.match(fn, /p\.push_notifications is distinct from false\s+and p\.notify_calls is distinct from false/, "callee prefs gate the alert");
  assert.match(fn, /on conflict do nothing\s+returning id into v_ring_id/, "dedup + alert confirmation");
  assert.match(fn, /'alerted', v_ring_id is not null/, "the caller learns whether the other side will be woken");
  // Both camelCase and snake_case spellings ride along (Android reads camel).
  assert.match(fn, /'call_id', v_log\.call_id,\s+'callId', v_log\.call_id/, "call id both spellings");
  assert.match(fn, /'conversation_id', v_log\.conversation_id,\s+'conversationId', v_log\.conversation_id/, "conversation both spellings");
});

test("end_call_log: the transition table is the law; illegal endings are ignored, not applied", () => {
  const fn = between(m5, "create or replace function public.end_call_log(", "\n$$;");
  assert.match(fn, /for update/, "row lock — two devices settling at once serialize");
  assert.match(fn, /where call_id = p_call_id and \(caller_id = v_me or callee_id = v_me\)/, "only the parties settle");
  assert.match(fn, /when v_me = v_log\.caller_id and v_log\.status = 'ringing'\s+and p_outcome in \('canceled', 'missed'\) then p_outcome/, "caller: cancel or timeout-miss only");
  assert.match(fn, /when v_log\.status = 'answered' and p_outcome = 'completed'[\s\S]*?either participant may end a live call/, "either side completes an answered call");
  assert.match(fn, /when v_me = v_log\.callee_id and v_log\.status = 'ringing'\s+and p_outcome in \('answered', 'declined', 'busy'\) then p_outcome/, "callee: answered/declined/busy");
  assert.match(fn, /'ignored', true/, "illegal transitions return ignored, never an error toast");
  assert.match(fn, /missed = \(v_next in \('missed', 'expired'\)\)/, "missed flag only for real misses — declined ≠ missed");
  assert.match(fn, /update public\.notifications set is_read = true\s+where source_id = v_log\.id and type = 'call'/, "answering retires the unread ring alert");
  assert.match(fn, /'Missed Voice Call 📞'/, "missed notice exists");
  assert.match(fn, /'An anonymous friend called you while you were away\.'/, "no caller name in the banner body");
  // Every terminal end cancels the lingering device alert — addressed to the
  // CALLEE's devices (where the ringing notification was posted).
  assert.match(fn, /'action', 'cancel',\s+'user_id', v_log\.callee_id,\s+'call_id', v_log\.call_id/, "cancel to callee");
});

test("expire_stale_calls: service-role sweep, honest expired state, cancel to the callee", () => {
  const fn = between(m5, "create or replace function public.expire_stale_calls()", "\n$$;");
  assert.match(fn, /if auth\.role\(\) is distinct from 'service_role' then\s+raise exception 'Not authorized' using errcode = '42501'/, "no client execution");
  assert.match(m5, /revoke all on function public\.expire_stale_calls\(\) from public, anon, authenticated/, "grants match the check");
  assert.match(m5, /grant execute on function public\.expire_stale_calls\(\) to service_role/);
  assert.match(fn, /for update\s+loop/, "locked sweep iteration");
  assert.match(fn, /set status = 'expired', ended_at = now\(\), missed = true/, "expired is a real terminal state");
  assert.match(fn, /'Missed Voice Call 📞'/, "missed notice on expiry");
  assert.match(fn, /p\.notify_calls is distinct from false/, "expiry notice honors the same prefs");
  assert.match(fn, /jsonb_build_object\('action', 'cancel', 'user_id', v_row\.callee_id, 'call_id', v_row\.call_id\)/, "cancel to the callee, not the caller");
});

test("call realtime is membership-gated and the table is published", () => {
  assert.match(m5, /alter publication supabase_realtime add table public\.call_logs/, "realtime publication (DO-wrapped)");
  assert.match(m5, /realtime\.topic\(\) like 'whisper-call:%'[\s\S]*?split_part\(realtime\.topic\(\), ':', 2\)/, "call topics parse the conversation id");
  assert.match(m5, /c\.id = nullif\(split_part\(realtime\.topic\(\), ':', 2\), ''\)::uuid\s+and \(c\.user_a = auth\.uid\(\) or c\.user_b = auth\.uid\(\)\)/, "membership required");
  assert.match(m5, /not like 'whisper-call:%'/, "non-call broadcast topics stay allowed (nothing else breaks)");
  assert.match(m5, /uuid regex guard|~\*\s*'\^\[0-9a-f\]\{8\}/, "malformed topics can't crash the cast");
});

// ---------------------------------------------------------------------------
// Call lifecycle — client side (the two halves must speak the same contract).
// ---------------------------------------------------------------------------

test("the call engine is server-authoritative (no optimistic missed/canceled)", () => {
  const hook = read("lib/calls/callSession.ts");
  assert.match(hook, /supabase\.rpc\("start_call_log"/, "reserve the call with the server FIRST");
  assert.match(hook, /supabase\.rpc\("end_call_log"/, "settle via RPC");
  assert.match(hook, /PGRST202|42883/, "legacy fallback until the migration ships");
  assert.match(hook, /legacyFinalize/, "the fallback path is explicit, not implicit");
  assert.match(hook, /hangUp\(null, "timeout"\)/, "client watchdog reports a miss");
  assert.match(hook, /reason === "timeout" && this\.state\.status === "outgoing"/, "only an unanswered OUTGOING call becomes missed");
  assert.match(hook, /reportOutcome\("declined"\)/, "callee decline is a decline, never a miss");
  assert.match(hook, /channel\(`call-logs-\$\{conversationId\}-\$\{this\.myId/, "realtime teardown subscription, conversation-scoped");
  assert.match(hook, /type: "dismiss-notifications"/, "rings stop locally via the service worker");
  assert.match(hook, /receipt\.status === "busy"/, "the busy verdict comes from the server receipt, not a guess");
});

test("missed calls are persistent rows inside the correct conversation timeline", () => {
  const chat = read("app/chat/[conversationId]/page.tsx");
  assert.match(chat, /from\("call_logs"\)/, "the timeline reads the server table, not transient local state");
  assert.match(chat, /table: "call_logs"/, "live via the membership-gated realtime topic");
  assert.match(chat, /CallEntryRow/, "rendered as timeline entries");
  assert.match(chat, /visibleTimeline/, "merged into the message ordering");
  const row = read("components/chat/CallEntryRow.tsx");
  assert.match(row, /Call back/, "callback action");
  assert.match(row, /onCallBack/, "start path is supplied by the chat page (hook's outgoing call, busy check included)");
  assert.match(chat, /onCallBack=/, "the page wires the callback action");
  const fmt = read("lib/calls/callFormat.ts");
  assert.match(fmt, /Missed voice call/, "missed wording, incoming");
  assert.match(fmt, /No answer/, "missed wording, outgoing");
  assert.match(fmt, /Call declined|Declined a call/, "declined distinct from missed");
  assert.match(fmt, /Call cancelled/, "cancelled distinct from declined");
  assert.match(fmt, /`Voice call\$\{duration \? ` · \$\{duration\}` : ""\}`/, "connected calls show duration");
  assert.match(fmt, /\["missed", "expired", "canceled", "declined"\]/, "call back offered for every unanswered ending");
});

// ---------------------------------------------------------------------------
// Push plumbing: channels, privacy, collapse, cancellation.
// ---------------------------------------------------------------------------

test("notify-on-notification: per-type channels, prefs, collapse, TTL, cancel", () => {
  const t = read("supabase/functions/notify-on-notification/index.ts");
  for (const ch of ['"messages"', '"whispers"', '"calls"', '"coins"', '"feed"', '"friend_requests"']) {
    assert.ok(t.includes(ch), `channel ${ch}`);
  }
  assert.match(t, /raw === "coin_transfer"\) return "coins"/, "transfer rows route to the coins channel");
  assert.match(t, /profile\?\.push_notifications === false/, "global pref is re-checked at send time (rows exist regardless)");
  assert.match(t, /payload\?\.action === "cancel"/, "cancel messages address the lingering alert");
  assert.match(t, /type: "call_cancel", callId/, "data-only retractation shape");
  assert.match(t, /collapse_key: `call-cancel-\$\{callId\}`/, "cancel collapses against the ring it replaces");
  assert.match(t, /collapse_key = `call-\$\{meta\.call_id\}`[\s\S]*?ttl = "60s"/, "rings: collapse + 60s TTL matching the SQL expiry window");
  assert.match(t, /type: route,\s+notificationId: notification\.id/, "type is written AFTER spreading metadata; id rides along for stable collapse");
  assert.match(t, /body: notification\.body/, "the banner body is what the trigger authored — never re-queried");
  assert.match(t, /deadTokens/, "unregistered tokens pruned");
});

test("feed push is recipients-only, in-function; the webhook paths are retired", () => {
  const fn = read("supabase/functions/notify-new-feed-post/index.ts");
  assert.match(fn, /payload\?\.recipients/, "the recipients array from the trigger is the contract");
  assert.match(fn, /skipped: "no explicit recipients"/, "an empty list is a skip, not a fan-out");
  assert.doesNotMatch(fn, /FROM public\.users/, "no whole-table audience query remains");
  assert.doesNotMatch(fn, /notification_user_targets/, "no broadcast targets from the fn");
  const retired = read("supabase/functions/notify-new-whisper/index.ts");
  assert.match(retired, /skipped: "retired/, "webhook fn no-ops immediately");
  const dmFn = read("supabase/functions/notify-new-direct-message/index.ts");
  assert.match(dmFn, /skipped: true/, "the legacy DM double-path is closed in the deployed fn too");
});

test("web push payload keeps secrets out of the banner", () => {
  const t = read("app/api/send-push/route.ts");
  // The whisper branch first drafts a content-bearing body, then deliberately
  // replaces it — assert the OVERRIDE exists and comes last.
  const draft = t.indexOf('notificationBody = record.message');
  const override = t.indexOf('notificationBody = "A new anonymous whisper arrived. Open Whisper to read it.";');
  assert.ok(draft > 0, "the draft line is present (its removal would hide the intent)");
  assert.ok(override > draft, "the privacy override wins");
  assert.match(t, /record\.content\n\s+\? record\.content\.slice\(0, 100\)|record\.content\.slice\(0, 100\)/, "DM previews are the trimmed stored body, nothing re-queried");
  assert.match(t, /tag: notificationType === "message" && notificationConversationId\s+\? `chat-\$\{notificationConversationId\}`\s+: notificationType/, "collapse tags: per-conversation for DMs, per-type elsewhere");
});

test("the service worker collapses, suppresses on-surface banners, and honors dismissals", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /tag: data\.tag \|\| undefined/, "collapse by server-assigned tag");
  assert.match(sw, /visibilityState === "visible" && client\.url\.indexOf\(surface\) !== -1/, "on-surface detection");
  assert.match(sw, /postMessage\(\{ type: "whisper:notification", data \}\)/, "open surface gets an in-app notice instead of a duplicate banner");
  {
    const postAt = sw.indexOf('viewing.postMessage({ type: "whisper:notification"');
    const showAt = sw.indexOf("self.registration.showNotification(title, options)", postAt);
    assert.ok(postAt > 0 && showAt > postAt, "the in-app notice RETURNS before any banner would show");
  }
  assert.match(sw, /message\.type === "dismiss-notifications" && Array\.isArray\(message\.tags\)/, "call UI can clear ringing banners by tag");
  assert.match(sw, /self\.addEventListener\("notificationclick"/, "tap routes to the right surface");
});

test("Android routes calls to the calls channel with full-screen and cancellation", () => {
  const t = read("android/app/src/main/java/com/whisper/app/FCMMessagingService.java");
  assert.ok(t.length > 100, "the FCM service must exist at its real package path");
  assert.match(t, /\{"coins", "Coins and wallet"\}/, "coins channel");
  assert.match(t, /\{"calls", "Voice calls"\}/, "calls channel");
  assert.match(t, /RingtoneManager\.getDefaultUri\(RingtoneManager\.TYPE_RINGTONE\)/, "calls sound like a ring, not a ding");
  assert.match(t, /USAGE_NOTIFICATION_RINGTONE/, "ring stream — media volume must not swallow it");
  assert.match(t, /"call_cancel"\.equals\(data\.get\("type"\)\)/, "cancel path");
  assert.match(t, /cancel\(stableNotificationId\("call-" \+ callId, callId\)\)/, "cancel finds its own row by the stable id");
  assert.match(t, /Math\.abs\(key\.hashCode\(\)\) \| 0x40000000/, "stable ids from a hash, above the 0x3FFFFFFF budget");
  assert.match(t, /areNotificationsEnabled\(\)\) return;/, "a globally-muted phone shows nothing, not even calls");
  assert.match(t, /VISIBILITY_PRIVATE/, "lock-screen content guarded");
  assert.match(t, /setOngoing\(true\)/, "rings are not fling-away dismissible");
  assert.match(t, /setTimeoutAfter\(60_000L\)/, "60s — matching the server-side expiry, not racing it");
  assert.match(t, /setFullScreenIntent\(pendingIntent, true\)/, "full-screen incoming call while locked");
  assert.match(t, /"whisperapp:\/\/chat\/"/, "the ring notification opens the conversation");
  assert.doesNotMatch(t, /DEFAULT_SOUND_URI/, "the default-ding reuse bug class stays fixed");
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /USE_FULL_SCREEN_INTENT/);
});

// ---------------------------------------------------------------------------
// UI surfaces: settings switches and the persistent Activity history.
// ---------------------------------------------------------------------------

test("the settings switches write exactly the columns the triggers check", () => {
  const card = read("components/NotificationSettingsCard.tsx");
  for (const col of [
    "push_notifications",
    "notify_feed_posts",
    "notify_replies",
    "notify_friend_requests",
    "notify_coin_transfers",
    "notify_calls",
  ]) {
    assert.ok(card.includes(col), `${col} must be in the card's read AND write shape`);
  }
  assert.match(card, /\.update\(\{ \[key\]: next \}\)/, "writes the same key that was flipped");
  assert.match(card, /value !== false/, "NULL means ON — matching `is distinct from false` in SQL");
  const settings = read("app/settings/page.tsx");
  assert.match(settings, /NotificationSettingsCard/, "rendered on the settings page");
});

test("the Activity page shows the persistent notification history", () => {
  const list = read("components/NotificationActivityList.tsx");
  assert.match(list, /from\("notifications"\)/, "reads the notification table");
  assert.match(list, /safeRoute/, "only same-origin absolute paths are linked");
  assert.match(list, /\{ is_read: true \}/, "click marks read; nothing else is writable");
  const page = read("app/notifications/page.tsx");
  assert.match(page, /NotificationActivityList/, "wired into /notifications");
});

// ---------------------------------------------------------------------------
// PKCE honesty and the durable guards the settings/routes lean on.
// ---------------------------------------------------------------------------

test("AppUrlHandler is PKCE-only and refuses implicit token URLs loudly", () => {
  const t = read("components/AppUrlHandler.tsx");
  assert.match(t, /exchangeCodeForSession/, "the code exchange happens here");
  // The ONE approved use of access_token strings here is the refusal itself;
  // no setSession call may receive values parsed from the URL.
  assert.doesNotMatch(t, /setSession\(\{\s*access_token/, "URL tokens must never reach setSession");
  assert.match(t, /url\.searchParams\.has\("access_token"\)/, "implicit responses are DETECTED");
  assert.match(t, /console\.error/, "…and reported, not silently dropped");
  assert.match(t, /`\/public-feed\?post=\$\{encodeURIComponent\(postId\)\}`/, "feed posts deep-link with ?post= (the old /feed entry 404'd)");
  assert.match(t, /return "\/premium"/, "wallet lands on a page that exists");
});

test("0004 ships the durable rate-limit store and the payment/session primitives", () => {
  assert.match(m4, /create table if not exists public\.rate_limit_windows/, "durable bucket table");
  assert.match(m4, /create or replace function public\.rate_limit_consume\(/, "atomic consume RPC");
  assert.match(m4, /create or replace function public\.credit_verified_payment\(/, "idempotent credit fn");
  assert.match(m4, /pg_advisory_xact_lock\(hashtextextended\(payment_reference, 0\)\)/, "replay serialization on the reference");
  assert.match(m4, /perform public\.ensure_coin_wallet\(target_user\)/, "wallet exists before credit");
  assert.match(m4, /create or replace function public\.revoke_user_sessions\(/, "session revocation after recovery");
  const apiGuard = read("lib/apiGuard.ts");
  assert.match(apiGuard, /admin\.rpc\("rate_limit_consume"/, "routes consume durable counts, not per-instance maps");
  assert.match(apiGuard, /failing closed/, "a limiter fault DENIES, it does not allow");
});
