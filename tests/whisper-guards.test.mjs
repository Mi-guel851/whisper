/*
 * Regression guards for the four 2026-09-09 feature migrations and their
 * client wiring: consent gate, friend-request messaging gates, Find a Match,
 * voice calls.
 *
 * The database is the enforcement layer in this app (the UI is never the only
 * guard), so the thing most worth testing without a database is that the
 * enforcement is STILL in the SQL and the client is still pointing at it —
 * a future edit that "simplifies" a policy away, or retypes a price, should
 * fail here at lint time rather than in production.
 *
 * Dependency-free on purpose, same shape as service-worker-navigation.test.mjs:
 * read the real files, assert the load-bearing phrases. `npm test` runs both.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log("  ok   " + name);
  else {
    failures++;
    console.log("  FAIL " + name + (extra ? " — " + extra : ""));
  }
}

const consentSql = read("supabase/migrations/202609090001_consent_gate.sql");
const gatesSql = read("supabase/migrations/202609090002_pending_friend_threads.sql");
const matchSql = read("supabase/migrations/202609090003_find_a_match.sql");
const matchResultRepairSql = read("supabase/migrations/202609090006_find_match_result_type_repair.sql");
const callsSql = read("supabase/migrations/202609090004_voice_calls.sql");
const signup = read("app/signup/page.tsx");
const completeProfile = read("app/complete-profile/page.tsx");
const chatPage = read("app/chat/[conversationId]/page.tsx");
const nextConfig = read("next.config.ts");
const knowledge = read("lib/ai/server/knowledge.ts");
const consentLib = read("lib/consent.ts");
const infoPlist = read("ios/App/App/Info.plist");
const turnRoute = read("app/api/calls/turn-credentials/route.ts");
const iceServers = read("lib/calls/iceServers.ts");
const friendsPage = read("app/friends/page.tsx");

console.log("consent gate (feature 3)");
check("consents table created", consentSql.includes("create table if not exists public.consents"));
check("consents RLS enabled", /alter table public\.consents enable row level security/.test(consentSql));
check(
  "consents policies are own-rows-only",
  (consentSql.match(/auth\.uid\(\) = user_id/g) || []).length >= 3
);
check("no delete policy on consents", !/for delete/i.test(consentSql));
check("profiles trigger demands consent on completion", consentSql.includes("profiles_require_consent") && consentSql.includes("profile_completed"));
check("record_consent is security definer", /function public\.record_consent[\s\S]{0,200}security definer/.test(consentSql));
check(
  "client and server agree on the consent version",
  (() => {
    const server = consentSql.match(/current_consent_doc_version\(\)[\s\S]{0,200}?select (\d+);/);
    const client = consentLib.match(/CONSENT_DOC_VERSION = (\d+)/);
    return Boolean(server && client && server[1] === client[1]);
  })(),
  "current_consent_doc_version() vs CONSENT_DOC_VERSION"
);
check("signup button disabled until consent", /disabled=\{loading \|\| !agreed\}/.test(signup));
check("signup links both documents", signup.includes('href="/privacy"') && signup.includes('href="/terms"'));
check("signup checkbox unchecked by default", /useState\(false\)/.test(signup) && signup.includes("agreed"));
check("complete-profile re-gates on the same consent", completeProfile.includes("consentChecked") && completeProfile.includes("@/lib/consent"));

console.log("messaging gates (feature 2)");
check("send gate keeps the ban clause", gatesSql.includes("user_is_banned(target_sender_id)"));
check("send gate keeps the block clause", gatesSql.includes("blocked_users"));
check("send gate keeps the unlock clause", gatesSql.includes("chat_unlocks"));
check(
  "send gate admits the pending request's SENDER only",
  gatesSql.includes("r.sender_id = target_sender_id") && gatesSql.includes("r.status = 'pending'")
);
check("send gate admits friends in either row direction", /f\.user_id = target_sender_id[\s\S]{0,220}f\.user_id = \(case when/.test(gatesSql));
check("ensure_pending_conversation is security definer", /function public\.ensure_pending_conversation[\s\S]{0,200}security definer/.test(gatesSql));
check("decline/cancel tears the thread down server-side", gatesSql.includes("after delete on public.friend_requests") && gatesSql.includes("cleanup_pending_thread"));
check("teardown is guarded for accepted friendships", /no friendship either way|f\.user_id = pair_a and f\.friend_id = pair_b/.test(gatesSql.replace(/\s+/g, " ")));
check("chat UI locks the receiver's composer", chatPage.includes("Accept the request to reply"));
check("chat UI shows the pending banner", chatPage.includes("Someone wants to be your friend"));
check("friends page opens the pending thread via the RPC", friendsPage.includes("ensure_pending_conversation"));

console.log("find a match (feature 1)");
check(
  "no geolocation anywhere — policy still hard-disabled",
  nextConfig.includes("geolocation=()"),
  "next.config.ts Permissions-Policy must keep geolocation=()"
);
check(
  "ranking is opt-in region, not coordinates",
  matchResultRepairSql.includes("country_code") &&
    !/latitude|longitude|geography|geometric|ST_(Geog|Point|Distance)/i.test(matchResultRepairSql),
  "no coordinate columns or PostGIS in the effective ranking SQL"
);
check("effective RPC excludes banned users", matchResultRepairSql.includes("user_is_banned"));
check("effective RPC excludes blocked users either way", matchResultRepairSql.includes("blocked_users"));
check(
  "effective RPC excludes friends and pending requests",
  matchResultRepairSql.includes("public.friends") && matchResultRepairSql.includes("friend_requests")
);
check(
  "effective RPC honours opt-out, whose schema default remains ON",
  matchResultRepairSql.includes("find_a_match_enabled is distinct from false") && matchSql.includes("default true")
);
check("effective RPC is capped at 20 per page", matchResultRepairSql.includes("limit 20"));
check(
  "RPC score exactly matches its declared double-precision result type",
  matchResultRepairSql.includes(")::double precision as candidate_rank_score")
);
check(
  "RPC internals cannot shadow its OUT-column names",
  matchResultRepairSql.includes("#variable_conflict error") &&
    matchResultRepairSql.includes("candidate_profile_id") &&
    matchResultRepairSql.includes("candidate_country_code")
);
check(
  "all RPC result fields are explicitly normalized",
  matchResultRepairSql.includes("p.id::uuid as candidate_profile_id") &&
    matchResultRepairSql.includes("p.country_code::text as candidate_country_code") &&
    matchResultRepairSql.includes(")::boolean as candidate_active_recent")
);
check("presence heartbeat feeds recency", matchResultRepairSql.includes("last_active_at") && read("lib/realtime/presence.ts").includes("last_active_at"));
check("scan refuses offline", friendsPage.includes("requireOnline"));
check("scan never toasts a raw database error", friendsPage.includes("matchScanErrorMessage(rpc.error)"));
check("settings toggle present and documented", read("app/settings/page.tsx").includes("FindAMatchSettingRow") && read("components/FindAMatchSettingRow.tsx").includes("find_a_match_enabled"));

console.log("voice calls (feature 4)");
check("call_logs RLS enabled", callsSql.includes("alter table public.call_logs enable row level security"));
check(
  "call logging is caller-only inside accepted friendships",
  /for insert with check \([\s\S]{0,300}auth\.uid\(\) = caller_id[\s\S]{0,300}public\.friends/.test(callsSql)
);
check("missed-call notification reuses the notifications pattern", callsSql.includes("public.notifications") && callsSql.includes("after insert or update of missed"));
check("call log is a log, not media (no audio columns)", !/audio_path|recording|media_url/.test(callsSql));
check("iOS Info.plist declares microphone usage", infoPlist.includes("NSMicrophoneUsageDescription"));
check("TURN credentials minted server-side from env", turnRoute.includes("process.env.TURN_REST_API_URL") && turnRoute.includes("process.env.TURN_CREDENTIALS"));
check("no TURN secret embedded in the client", !/openrelayproject|turn:[a-z]+:[a-z@!]/i.test(iceServers) && !/credential:\s*"/i.test(iceServers));
check("signaling is realtime broadcast, no polling", read("lib/calls/signaling.ts").includes('type: "broadcast"') && !/setInterval\([\s\S]{0,40}fetch/i.test(read("lib/calls/useVoiceCall.ts")));
check("call button gated to accepted friendships in the UI", /enabled: Boolean\(isFriendConversation\)/.test(chatPage));

console.log("knowledge base honesty");
check("chat unlock price matches lib/coins.ts (40)", knowledge.includes("unlocking a chat (40)") && knowledge.includes("costs 40 coins, once"));
check("no stale 30-coin chat unlock anywhere", !knowledge.includes("30 coins, once") && !knowledge.includes("unlocking a chat (30)"));
check("consent step documented", knowledge.includes("Privacy Policy and Terms"));
check("pending-thread flow documented", knowledge.includes("Accept the request to reply"));
check("Find a Match documented, incl. no-geolocation boundary", knowledge.includes("Find a Match") && knowledge.includes("never uses device geolocation"));
check("voice calls documented, incl. no-recording promise", knowledge.includes("Voice calls") && knowledge.includes("never records or stores call audio"));

console.log(failures === 0 ? "\nALL GUARDS PASSED" : `\n${failures} GUARD(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
