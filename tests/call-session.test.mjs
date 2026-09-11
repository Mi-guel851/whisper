/**
 * Guards for two changes that are easy to undo by accident:
 *
 *   1. the ambient word wall on the dashboard welcome card (three morphing
 *      lanes drawn from a ~100-word vocabulary, in both themes), and
 *   2. the call moving out of the chat page into an app-wide session — ring
 *      enforced everywhere, answering collapsing into a floating pill, and the
 *      two signaling fixes that stop a call parking itself on "Connecting…".
 *
 * Static source guards, in the style of every other test here: these files are
 * the contract, and each assertion names the behaviour that would silently
 * disappear if the line were removed.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  words,
  wall,
  cloud,
  hero,
  morph,
  css,
  engine,
  provider,
  pill,
  sheet,
  overlay,
  chat,
  layout,
  format,
  turnRoute,
  ice,
  outcomesMigration,
] = await Promise.all([
  read("lib/whisperWords.ts"),
  read("components/dashboard/WordWall.tsx"),
  read("components/WhisperWordCloud.tsx"),
  read("components/dashboard/DashboardHero.tsx"),
  read("components/ui/MorphingText.tsx"),
  read("app/globals.css"),
  read("lib/calls/callSession.ts"),
  read("components/calls/CallSessionProvider.tsx"),
  read("components/calls/InCallPill.tsx"),
  read("components/calls/InCallSheet.tsx"),
  read("components/calls/IncomingCallOverlay.tsx"),
  read("app/chat/[conversationId]/page.tsx"),
  read("app/layout.tsx"),
  read("lib/calls/callFormat.ts"),
  read("app/api/calls/turn-credentials/route.ts"),
  read("lib/calls/iceServers.ts"),
  read("supabase/migrations/202609120003_honest_call_outcomes.sql"),
]);

function ok(name, check) {
  assert.ok(check, name);
  console.log(`  ok   ${name}`);
}

/* ------------------------------------------------------------------------- */
console.log("ambient word wall");
/* ------------------------------------------------------------------------- */

const dictionary = [...words.slice(words.indexOf("export const WHISPER_WORDS"), words.indexOf("];"))
  .matchAll(/"([^"]+)"/g)].map((match) => match[1]);

ok("the vocabulary carries about a hundred words", dictionary.length >= 100);
ok("no word appears twice in the vocabulary", new Set(dictionary).size === dictionary.length);
ok("lanes are interleaved, so simultaneous lanes cannot collide", /position % count === index/.test(words));
/* Three lanes on desktop, two on phones — the wall thins on small screens
   instead of being removed, and each set is a literal lane list now rather
   than a count constant. */
const desktopLanes = (wall.match(/const DESKTOP_LANES: readonly Lane\[\] = \[([\s\S]*?)\n\];/) || [])[1] ?? "";
const mobileLanes = (wall.match(/const MOBILE_LANES: readonly Lane\[\] = \[([\s\S]*?)\n\];/) || [])[1] ?? "";
ok("the desktop wall runs exactly three lanes", (desktopLanes.match(/\{ position:/g) || []).length === 3);
ok("phones thin the wall to two lanes instead of hiding it", (mobileLanes.match(/\{ position:/g) || []).length === 2);
ok("both lane sets are drawn from the shared vocabulary", /whisperLane\(index, DESKTOP_LANES\.length/.test(wall) && /whisperLane\(index, MOBILE_LANES\.length/.test(wall));
ok("the wall uses the same morph component and timing as the send page", /from "@\/components\/ui\/MorphingText"/.test(wall)
  && /holdSeconds={2\.6}/.test(wall) && /morphSeconds={1\.2}/.test(wall) && /blurPx=\{8\}/.test(wall)
  && /holdSeconds={2\.6}/.test(cloud) && /morphSeconds={1\.2}/.test(cloud));
ok("the send page wall draws on the same vocabulary", /whisperLane\(index, BRAND_LINES\.length/.test(cloud));
ok("the wall is decorative and unclickable", /aria-hidden/.test(wall) && /\.dashboard-word-wall \{[\s\S]{0,240}pointer-events:none/.test(css));
/* The theme's text colour held back with `opacity`, NOT a colour-mix alpha:
   this build's minifier strips the percentage out of
   `color-mix(in srgb, var(--x) 15%, transparent)` and emits the variable at
   full strength (verified in .next/static/chunks/*.css), which would turn the
   wall into a block of solid text. */
const wallRuleRaw = css.slice(css.indexOf(".dashboard-word-wall-word {"), css.indexOf("}", css.indexOf(".dashboard-word-wall-word {")));
const wallRule = wallRuleRaw.replace(/\/\*[\s\S]*?\*\//g, ""); // declarations only, not the note explaining them
ok("the wall is legible in both themes (theme token, not hardcoded white)", /color:var\(--theme-text\)/.test(wallRule) && /opacity:\.1(;|\})/.test(wallRule));
ok("the wall does not depend on a construct the minifier mangles", !/color-mix/.test(wallRule));
ok("the wall thins on phones instead of disappearing", /@media \(max-width:44rem\) \{\s*\.dashboard-word-wall-word \{ font-size:\.62rem; \}/.test(css) && !/\.dashboard-word-wall \{[^}]*display:none/.test(css));
ok("reduced motion gets a static word instead of a loop", /if \(reduced \|\| texts\.length < 2\) \{/.test(morph));
ok("the welcome card renders the wall", /<WordWall \/>/.test(hero) && /\.dashboard-welcome-card \{ position:relative; overflow:hidden; \}/.test(css));

/* ------------------------------------------------------------------------- */
console.log("one call engine, owned by the app");
/* ------------------------------------------------------------------------- */

ok("the engine is a singleton, not a hook", /export const callSession = new CallSession\(\);/.test(engine) && !/from "react"/.test(engine));
ok("the root layout mounts it", /<CallSessionProvider \/>/.test(layout) && !/GlobalCallListener/.test(layout));
ok("the chat page no longer owns the call or its surfaces", !/useVoiceCall|IncomingCallOverlay|InCallSheet/.test(chat));
ok("the chat page registers the thread so it can ring live", /call\.attachThread\(\{/.test(chat) && /enabled: Boolean\(isFriendConversation\)/.test(chat));
ok("the chat page places calls through the shared engine", /call\.startCall\(\{ conversationId, peerId: otherUserId \}\)/.test(chat));
ok("the ring has no route exception — it is enforced everywhere", !/usePathname/.test(provider) && /call\.status === "incoming" && \(/.test(provider));
ok("every ring path converges on the engine", ["postgres_changes", "INCOMING_CALL_EVENT", "PENDING_CALL_KEY", "beginIncomingRing"].every((needle) => provider.includes(needle)));
ok("the ring stands down when its row is read or deleted", /cancelRing\(/.test(provider) && /cancelRing = \(callId/.test(engine));

/* ------------------------------------------------------------------------- */
console.log("answering works from anywhere");
/* ------------------------------------------------------------------------- */

ok("a ringing caller re-broadcasts its offer", /OFFER_RETRANSMIT_MS/.test(engine) && /this\.retransmitTimer = setInterval\(/.test(engine));
ok("a late callee waits for that offer instead of failing", /OFFER_WAIT_MS/.test(engine) && /this\.awaitingOffer = true;/.test(engine));
ok("a retransmitted offer refreshes the ring instead of answering busy", /if \(this\.state\.status === "incoming"\) \{\s*if \(sdp\) this\.pendingOfferSdp = sdp;/.test(engine));
ok("our ICE candidates are replayed to a peer who subscribed late", /private replayCandidates\(\)/.test(engine) && (engine.match(/this\.replayCandidates\(\);/g) || []).length >= 2);
ok("their ICE candidates arriving early are queued, not dropped", /queuedRemoteCandidates/.test(engine) && /flushQueuedCandidates/.test(engine));

/* ------------------------------------------------------------------------- */
console.log('"Connecting…" always resolves');
/* ------------------------------------------------------------------------- */

ok('ICE "completed" counts as connected', /state === "connected" \|\| state === "completed"/.test(engine));
ok("the aggregate connection state is the second opinion", /if \(pc\.connectionState === "connected"\) \{\s*this\.markConnected\(\);/.test(engine));
ok("a stalled connect restarts ICE, then ends with a sentence", /CONNECT_TIMEOUT_MS/.test(engine) && /We couldn't connect\. Check your connection and try again\./.test(engine));
ok("a disconnected call gets a grace period before restarting", /ICE_DISCONNECT_GRACE_MS/.test(engine));

/* ------------------------------------------------------------------------- */
console.log("picking up is not a busy signal");
/* ------------------------------------------------------------------------- */

/* The bug this section exists for: the caller re-offers every 2s while
   ringing, and the callee's status becomes "connecting" the instant Accept is
   pressed — so the next retransmission used to fall through to the busy
   catch-all and the callee hung up its own call, two seconds after answering. */
const offerBranch = engine.slice(engine.indexOf('case "offer": {'), engine.indexOf('case "answer": {'));
ok(
  "an offer that lands after Accept is recognised as a retransmission, not a second call",
  /if \(this\.state\.status === "connecting" \|\| this\.state\.status === "in_call"\) \{/.test(offerBranch)
    && /const sameCall = callId && knownCallId \? callId === knownCallId : null;/.test(offerBranch)
    && /sameCall === true \|\| \(sameCall === null && this\.pc\?\.remoteDescription\)/.test(offerBranch)
);
ok(
  "the busy verdict is only reachable for a genuinely idle engine",
  offerBranch.indexOf('sameCall === true || (sameCall === null && this.pc?.remoteDescription)') <
    offerBranch.indexOf('event: "busy"')
);
ok(
  "a restart offer is not allowed to skip the accept path",
  offerBranch.indexOf("if (this.awaitingOffer && this.state.status") < offerBranch.indexOf("signal.payload?.restart &&")
);
ok("busy only ends a dial that is still ringing", /if \(this\.state\.status !== "outgoing" \|\| !this\.belongsToCurrentCall\(busyCallId\)\)/.test(engine));
ok("decline only ends a dial that is still ringing", /if \(this\.state\.status !== "outgoing" \|\| !this\.belongsToCurrentCall\(declineCallId\)\)/.test(engine));
ok("an end for another call cannot hang up this one", /if \(!this\.belongsToCurrentCall\(endCallId\)\)/.test(engine));
ok(
  "call-id mismatches are an explicit decision, not a string compare in passing",
  /private belongsToCurrentCall\(callId: string \| null \| undefined\): boolean/.test(engine)
);
ok("a caller stops re-offering the moment the answer lands", /pc\.signalingState !== "have-local-offer"/.test(engine));
ok(
  "accept marks the call answered before the answer goes out",
  /this\.answered = true;\s*this\.setStatus\("connecting"\);/.test(engine) && /accept: answering, callId =/.test(engine)
);
ok(
  "a double tap cannot build a second peer connection under the first",
  /private answering = false;/.test(engine) && /if \(this\.answering\) return;/.test(engine)
);
ok("a ring cancelled mid-accept does not tear down the call being built", /cancelRing[\s\S]{0,600}if \(this\.answering\) return;/.test(engine));
ok(
  "the log channel does not read 'answered' as an ending",
  /if \(row\.status === "answered"\) \{/.test(engine) && /log: peer picked up \(row answered\)/.test(engine)
);
ok(
  "phantom cleanup refuses to run while a call is live",
  /forceClearPhantom[\s\S]{0,900}if \(this\.state\.status !== "idle"\) return;/.test(engine)
);
ok(
  "the connect budget is measured from the answer, with a restart inside it",
  /CONNECT_TIMEOUT_MS = 25_000/.test(engine) && /CONNECT_RESTART_MS = 12_000/.test(engine)
);
ok(
  "ICE 'failed' restarts once and then ends, instead of retrying forever",
  /if \(!this\.iceRestarted && this\.state\.status !== "idle"\) \{\s*this\.iceRestarted = true;/.test(engine)
);
ok("an ICE restart carries the call id it belongs to", /payload: \{ sdp: offer\.sdp, restart: true, callId: restartCallId \?\? undefined \}/.test(engine));

/* ------------------------------------------------------------------------- */
console.log("answered calls minimize to the top pill");
/* ------------------------------------------------------------------------- */

ok("accepting collapses the call into the pill", /this\.state\.minimized = true;/.test(engine) && /this\.setStatus\("connecting"\);/.test(engine));
ok("the pill can be expanded again", /onMinimize/.test(sheet) && /onExpand/.test(pill) && /setMinimized/.test(engine));
ok("the pill carries the call controls", ["onToggleMute", "onHangUp", "call-pill-end", "formatCallDuration"].every((needle) => pill.includes(needle)));
ok("the pill floats over every route from the provider, not the chat page", /<InCallPill/.test(provider) && /call-pill-layer/.test(css) && /\.call-pill-layer \{[\s\S]{0,200}position: fixed/.test(css));
ok("the pill sits above page chrome but below an incoming ring", /z-index: 68;/.test(css) && /z-\[70\]/.test(overlay));

/* ------------------------------------------------------------------------- */
console.log("call surfaces keep their contrast in the light theme");
/* ------------------------------------------------------------------------- */

ok("the generic dialog surface rule still paints popovers", /\[role="dialog"\], \[role="alertdialog"\] \{\s*background-color:var\(--theme-surface-solid\);/.test(css));
ok("call surfaces opt out of it by class", /\[role="dialog"\]\.call-surface \{/.test(css) && /\.call-surface,[\s\S]{0,120}background-color: #07130f;/.test(css));
ok("the opt-out pins a dark palette and colour-scheme", /\.call-surface,[\s\S]{0,200}color-scheme: dark;/.test(css));
ok("the ring, the sheet and the pill all carry the opt-out", /className="call-surface fixed/.test(overlay) && /className="call-surface fixed/.test(sheet) && /call-pill call-surface/.test(pill));
/* Every legible label on a call surface is at least 60% white on the dark
   island — 7:1 or better. The one deliberate exception is the disabled speaker
   placeholder, which is aria-hidden and meant to read as "not a control". */
const callTextAlphas = `${overlay}\n${sheet}`
  .split("\n")
  .filter((line) => /text-white\/\d+/.test(line) && !line.includes("aria-hidden"))
  .flatMap((line) => [...line.matchAll(/text-white\/(\d+)/g)].map((match) => Number(match[1])));
ok("no call text sits below 60% white", callTextAlphas.length > 0 && callTextAlphas.every((alpha) => alpha >= 60));

/* ------------------------------------------------------------------------- */
console.log("the ring reaches an app that is already open");
/* ------------------------------------------------------------------------- */

const [ringMigration, lifecycleMigration, pushFn] = await Promise.all([
  read("supabase/migrations/202609110002_incoming_call_ring_in_app.sql"),
  read("supabase/migrations/202609100006_call_lifecycle.sql"),
  read("supabase/functions/notify-on-notification/index.ts"),
]);

/* The `notifications` row typed 'call' is both the push payload and the event
   the open app renders the overlay from, so gating it on the global push
   switch also silenced in-app ringing. The row is now gated on the
   call-specific preference alone; delivery still re-checks the global one. */
/* Comments stripped: the block's own note explains the change using the words
   `push_notifications`, and a guard that matches prose is not a guard. */
const insertBlock = ringMigration
  .slice(ringMigration.indexOf("Incoming-call alert for the callee"), ringMigration.indexOf("returning id into v_ring_id;"))
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
ok("start_call_log is re-created by the new migration", /create or replace function public\.start_call_log/.test(ringMigration));
ok("the ring row is no longer gated on the global push switch", !/push_notifications/.test(insertBlock));
ok("the call-specific preference still removes the ring", /p\.notify_calls is distinct from false/.test(insertBlock));
ok("the old gate is the one being replaced", /and p\.push_notifications is distinct from false\s*\n\s*and p\.notify_calls/.test(lifecycleMigration));
ok("push delivery still honours the global switch", /profile\?\.push_notifications === false/.test(pushFn));
ok("the migration is transactional and re-runnable", /^begin;/m.test(ringMigration) && /^commit;/m.test(ringMigration));

/* ------------------------------------------------------------------------- */
console.log("a call that never connected is not a call");
/* ------------------------------------------------------------------------- */

/* The bug this section exists for: `answered` (a person picked up) and
   `connected` (media is flowing) were one flag, so two people behind carrier
   NAT who both pressed Accept and then sat on "Connecting…" for 25 seconds
   produced a call_logs row reading `completed` with a duration — a log of a
   conversation that never carried a word. */
ok("picking up and connecting are separate facts",
  /private connected = false;/.test(engine) && /this\.connected = true;/.test(engine));
ok("the connect is what flips it, not the accept",
  /private markConnected\(\) \{[\s\S]{0,400}?this\.connected = true;/.test(engine));
ok("a teardown forgets the connection, so the next call starts honest",
  /this\.answered = false;\s*this\.connected = false;/.test(engine));
ok("the ending keys on the connection, not the pick-up",
  /this\.connected\s*\? "completed"\s*: this\.answered\s*\? "failed"/.test(engine));
ok("the peer's hang-up sentence says which kind of ending it was",
  /const wasConnected = this\.connected;/.test(engine)
    && /wasConnected \? "Call ended\." : "Call ended before it connected\."/.test(engine));
ok("a picked-up call that never got an offer ends as failed, not canceled",
  /this\.settleCall\(this\.connected \? "completed" : "failed"\);/.test(engine));
ok("the timeline refuses to print a duration for a failed call",
  /if \(entry\.status === "failed"\) \{\s*return \{ label: "Couldn't connect", direction, tone: "danger", duration: null/.test(format));
ok("talk time is measured from the pick-up, not from the ring",
  /const pickedUp = entry\.answered_at \? Date\.parse\(entry\.answered_at\) : started;/.test(format));
ok("a failed call offers a call back",
  /"missed", "expired", "canceled", "declined", "failed"/.test(format));
ok("the server has somewhere to put the new outcome",
  /'completed','busy','failed'/.test(outcomesMigration)
    && /and p_outcome in \('completed', 'failed'\) then p_outcome/.test(outcomesMigration));
ok("answering stamps the moment the call was taken",
  /answered_at = case when v_next = 'answered'/.test(outcomesMigration));

/* ------------------------------------------------------------------------- */
console.log('"Connecting…" has a way out');
/* ------------------------------------------------------------------------- */

/* The other half of the same report. With no TURN relay the peer connection
   has nothing to fall back on, and two phones behind carrier NAT cannot reach
   each other at all — the route used to answer `iceServers: []` whenever two
   env vars were unset, which is to say by default. */
ok("the relay route supplies a relay unless an operator switches it off",
  /PUBLIC_FALLBACK_ICE_SERVERS/.test(turnRoute) && /fallbackAllowed\(\)/.test(turnRoute));
ok("an operator's own relay wins over the fallback",
  /staticIceServers\(\)/.test(turnRoute)
    && turnRoute.indexOf("staticIceServers()") < turnRoute.indexOf("PUBLIC_FALLBACK_ICE_SERVERS,"));
ok("the client says so out loud when it ends up STUN-only",
  /no TURN relay available/.test(ice) && /includes\("turn:"\)/.test(ice));
ok("a lost answer is retried instead of stranding both sides",
  /ANSWER_RETRANSMITS/.test(engine) && /private retransmitAnswer\(/.test(engine)
    && /this\.retransmitAnswer\(pc\);/.test(engine));
ok("a call that never connected does not make the user permanently busy",
  /v_live_window interval := interval '4 hours'/.test(outcomesMigration)
    && /and cl\.started_at > now\(\) - v_live_window/.test(outcomesMigration));
ok("and the sweep closes what a dead device left open",
  /set status = 'failed', ended_at = now\(\)\s*where status = 'answered'/.test(outcomesMigration));

console.log("\nCALL SESSION + WORD WALL GUARDS PASSED");
