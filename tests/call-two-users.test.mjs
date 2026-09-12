/**
 * Two users, one call, end to end — executed, not inspected.
 *
 * Every other test in tests/ reads source text and asserts that a line is
 * there. That catches a deletion; it cannot catch a call that never connects.
 * This file runs the shipped call engine twice, as two different signed-in
 * users in two worker threads, and wires them together the way the product
 * does: signals over the whisper-call broadcast topic, bookkeeping through
 * start_call_log / end_call_log, media over a peer connection that only
 * completes when both sides actually finished the handshake.
 *
 * The scenarios are the ones from the bug report:
 *
 *   1. a call between two users connects, and the log says so honestly;
 *   2. a callee who answers from the ring overlay (no chat page, no offer in
 *      hand) still connects — the path a push notification takes;
 *   3. the offer the caller re-sends while the callee is answering is not
 *      mistaken for a second call;
 *   4. a pair with no route between them (carrier NAT, no TURN relay) fails
 *      fast and honestly, instead of sitting on "Connecting…" and then
 *      writing a call log that claims the call lasted 25 seconds;
 *   5. declines, cancellations and a live hang-up each leave the row in the
 *      state the chat timeline reads back.
 *
 * Run: node tests/call-two-users.test.mjs
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import {
  CallHarness,
  CALLER_ID,
  CALLEE_ID,
  CONVERSATION_ID,
  sleep,
} from "./harness/callHarness.mjs";

/* So the test can also read what the chat timeline would render — the same
   formatter the chat page uses, not a copy of it. */
register("./harness/hooks.mjs", import.meta.url);
const { describeCallEntry } = await import("@/lib/calls/callFormat");

let failures = 0;

function ok(name, check) {
  assert.ok(check, name);
  console.log(`  ok   ${name}`);
}

async function scenario(name, options, body) {
  console.log(`\n${name}`);
  const harness = await CallHarness.start(options);
  try {
    await body(harness);
  } finally {
    await harness.stop();
  }
}

/** Both users are looking at the thread, which is what the chat page does. */
async function openThread(harness) {
  await harness.cmd("caller", "attachThread", {
    conversationId: CONVERSATION_ID,
    peerId: CALLEE_ID,
    enabled: true,
  });
  await harness.cmd("callee", "attachThread", {
    conversationId: CONVERSATION_ID,
    peerId: CALLER_ID,
    enabled: true,
  });
}

/** Place the call and wait for the callee's ring. */
async function dial(harness) {
  await harness.cmd("caller", "startCall", { conversationId: CONVERSATION_ID, peerId: CALLEE_ID });
  await harness.waitFor("the callee's phone to ring", () => harness.status("callee") === "incoming");
  return harness.snapshot("callee").callId;
}

/**
 * Place a call at a callee who has no channel open — the shape of a real push.
 * The offer goes nowhere; what rings the phone is the `notifications` row the
 * server wrote, and the only thing that can save the call afterwards is the
 * caller's offer retransmission.
 */
async function dialCold(harness) {
  await harness.cmd("caller", "startCall", { conversationId: CONVERSATION_ID, peerId: CALLEE_ID });
  const note = await harness.waitFor("the server to write the incoming-call row", () =>
    harness.notifications.find((row) => row.type === "call")
  );
  return note.metadata.call_id;
}

/** The callee picks up and both sides wait for media. */
async function answer(harness) {
  await harness.cmd("callee", "accept");
  await harness.waitFor("both users to be on the call", () =>
    harness.status("caller") === "in_call" && harness.status("callee") === "in_call"
  );
}

/* ------------------------------------------------------------------------- */

try {
  await scenario(
    "1. two users call each other and it actually connects",
    { nat: "open" },
    async (harness) => {
      await openThread(harness);
      const callId = await dial(harness);

      ok("the callee sees who is calling", harness.snapshot("callee").peerId === CALLER_ID);
      ok("the caller is ringing, not yet connected", harness.status("caller") === "outgoing");
      ok("the server reserved the call before the offer flew", Boolean(callId));
      ok("the row started as ringing", harness.row(callId)?.status === "ringing");

      await answer(harness);

      ok("the callee's engine reports the call live", harness.snapshot("callee").status === "in_call");
      ok("the caller's engine reports the call live", harness.snapshot("caller").status === "in_call");
      ok("the callee's ring collapsed into the pill", harness.snapshot("callee").minimized === true);
      ok("the call clock started when media connected", typeof harness.snapshot("caller").startedAt === "number");

      const row = harness.row(callId);
      ok("the server row moved ringing -> answered", row.status === "answered");
      ok("answering stamped answered_at, not ended_at", row.answered_at !== null && row.ended_at === null);

      /* The answer must have been applied on the caller's side; without it
         there is no media session at all, whatever the status says. */
      const callerPeers = await harness.cmd("caller", "peerStats");
      const calleePeers = await harness.cmd("callee", "peerStats");
      ok("the caller exchanged SDP both ways", callerPeers[0].signalingState === "stable");
      ok("the callee exchanged SDP both ways", calleePeers[0].signalingState === "stable");
      ok("the caller received the callee's ICE candidates", callerPeers[0].remoteCandidates > 0);
      ok("the callee received the caller's ICE candidates", calleePeers[0].remoteCandidates > 0);
      ok("both peers report the transport connected",
        callerPeers[0].connectionState === "connected" && calleePeers[0].connectionState === "connected");
      ok("each side is sending its own audio track", callerPeers[0].sentTracks === 1 && calleePeers[0].sentTracks === 1);

      /* Hang up, and the log must read as a call that happened. */
      await harness.cmd("caller", "hangUp", { notify: "Call ended." });
      await harness.waitFor("the callee to see the call end", () => harness.status("callee") === "idle");
      ok("the caller is idle again", harness.status("caller") === "idle");
      ok("the callee was told", harness.users.get("callee").notices.includes("Call ended."));

      const ended = harness.row(callId);
      ok("the row is completed", ended.status === "completed");
      ok("the row carries an end time", ended.ended_at !== null);
      const spoken = Date.parse(ended.ended_at) - Date.parse(ended.answered_at);
      const logged = Date.parse(ended.ended_at) - Date.parse(ended.started_at);
      ok(
        "the duration the timeline shows is the time they talked, not the ring",
        spoken >= 0 && spoken <= logged && ended.answered_at !== null
      );
      ok("the engine reported the outcome once", harness.signalsOf("end").length === 1);

      const rendered = describeCallEntry(
        { ...ended, callee_id: ended.callee_id },
        CALLER_ID,
        Date.parse(ended.ended_at) + 1000
      );
      ok("the timeline calls it a voice call", /^Voice call/.test(rendered.label));
      ok("and shows a duration", typeof rendered.duration === "string");
    }
  );

  /* --------------------------------------------------------------------- */

  await scenario(
    "2. a callee with no chat page open answers from the ring overlay",
    { nat: "open" },
    async (harness) => {
      /* Only the caller is on the thread. The callee's ring arrives the way a
         push does: through beginIncomingRing, with no offer in hand. */
      await harness.cmd("caller", "attachThread", {
        conversationId: CONVERSATION_ID,
        peerId: CALLEE_ID,
        enabled: true,
      });
      const callId = await dialCold(harness);

      await harness.cmd("callee", "beginIncomingRing", {
        conversationId: CONVERSATION_ID,
        callerId: CALLER_ID,
        callId,
        createdAt: Date.now(),
      });
      ok("the overlay is up", harness.status("callee") === "incoming");

      /* Accept lands before the caller's next retransmission, so the callee
         has to wait for an offer it has not seen yet. */
      await harness.cmd("callee", "accept");
      ok("answering puts the callee into connecting", harness.status("callee") === "connecting");

      await harness.waitFor("the retransmitted offer to be answered", () =>
        harness.status("caller") === "in_call" && harness.status("callee") === "in_call"
      );
      ok("a late callee is on the call", harness.status("callee") === "in_call");
      ok("the caller heard the answer", harness.status("caller") === "in_call");
      ok("the row is answered", harness.row(callId).status === "answered");
      ok(
        "the callee's candidates reached a caller who had already gathered",
        (await harness.cmd("caller", "peerStats"))[0].remoteCandidates > 0
      );
      ok(
        "the caller's replayed candidates reached the callee",
        (await harness.cmd("callee", "peerStats"))[0].remoteCandidates > 0
      );
    }
  );

  /* --------------------------------------------------------------------- */

  await scenario(
    "3. the offer a caller re-sends mid-accept is not a second call",
    { nat: "open" },
    async (harness) => {
      await openThread(harness);
      const callId = await dial(harness);
      await harness.cmd("callee", "accept");

      /* Replay the caller's offer by hand, at the exact moment the bug lived:
         after Accept, while the answer is still in flight. */
      const offer = harness.signalsOf("offer").at(-1);
      ok("there was an offer to re-send", Boolean(offer?.payload?.sdp));
      for (const user of harness.users.values()) {
        if (user.name !== "callee") continue;
        for (const [channelId, topic] of user.channels) {
          if (!topic.startsWith("whisper-call:")) continue;
          user.worker.postMessage({
            kind: "inbound",
            channelId,
            payload: { event: "offer", user_id: CALLER_ID, payload: offer.payload },
          });
        }
      }

      await harness.waitFor("the call to survive its own retransmission", () =>
        harness.status("caller") === "in_call" && harness.status("callee") === "in_call"
      );
      ok("the call is still up", harness.status("caller") === "in_call");
      ok("the callee never answered busy to itself", harness.signalsOf("busy").length === 0);
      ok("the row was not canceled by the race", harness.row(callId).status === "answered");
    }
  );

  /* --------------------------------------------------------------------- */

  await scenario(
    "4. two users behind carrier NAT connect, through the relay",
    /* The default network shape for two phones: no direct UDP path between
       them, so the only thing that can connect this pair is a TURN relay —
       which is exactly what the credentials route now always supplies. */
    { nat: "symmetric" },
    async (harness) => {
      await openThread(harness);
      const callId = await dial(harness);
      await answer(harness);

      const callerPeers = await harness.cmd("caller", "peerStats");
      const calleePeers = await harness.cmd("callee", "peerStats");
      ok("the pair had a relay to connect through", callerPeers[0].hasRelay || calleePeers[0].hasRelay);
      ok("both users are on the call", harness.status("caller") === "in_call");
      ok("the transport is up on both sides",
        callerPeers[0].connectionState === "connected" && calleePeers[0].connectionState === "connected");
      ok("the log records a call that happened", harness.row(callId).status === "answered");
    }
  );

  /* --------------------------------------------------------------------- */

  await scenario(
    "5. a lost answer does not strand the caller on Connecting",
    { nat: "open", dropSignals: { answer: 1 } },
    async (harness) => {
      await openThread(harness);
      const callId = await dial(harness);
      await harness.cmd("callee", "accept");

      await harness.waitFor("the retried answer to land", () =>
        harness.status("caller") === "in_call" && harness.status("callee") === "in_call",
        { timeout: 15_000 }
      );
      ok("the first answer really was dropped", harness.dropped.length === 1);
      ok("the caller is on the call anyway", harness.status("caller") === "in_call");
      ok("and so is the callee", harness.status("callee") === "in_call");
      ok("the row says answered, not failed", harness.row(callId).status === "answered");
    }
  );

  /* --------------------------------------------------------------------- */

  await scenario(
    "6. no route between the two users: it fails honestly, not silently",
    /* Carrier-grade NAT on both sides and no TURN relay: the pair cannot be
       connected by any amount of waiting. Time is dilated so the watchdog can
       be observed in milliseconds instead of 25 seconds. */
    { nat: "symmetric", noTurn: true, dilate: { min: 5_000, max: 40_000, factor: 100 } },
    async (harness) => {
      await openThread(harness);
      const callId = await dial(harness);
      await harness.cmd("callee", "accept");

      await harness.waitFor("the caller to give up on a route that does not exist", () =>
        harness.status("caller") === "idle",
        { timeout: 10_000 }
      );
      await harness.waitFor("the callee to end too", () => harness.status("callee") === "idle", {
        timeout: 10_000,
      });

      const notices = harness.allNotices().join(" | ");
      ok("both users were told the call did not connect", /connect/i.test(notices));

      const row = harness.row(callId);
      ok("the row is terminal", ["failed", "canceled"].includes(row.status));
      ok("the row is not lying about a completed call", row.status !== "completed");
      ok("a picked-up call that never connected is recorded as failed", row.status === "failed");

      /* The half of the bug report the UI cannot show: what the chat
         timeline prints for a call that never carried audio. */
      const rendered = describeCallEntry(row, CALLER_ID, Date.parse(row.ended_at) + 1000);
      ok("the timeline does not print a duration for it", rendered.duration === null);
      ok("the timeline says it did not connect", /connect/i.test(rendered.label));
      ok("and it is not counted as a missed call", rendered.label !== "Missed voice call");
    }
  );

  /* --------------------------------------------------------------------- */

  await scenario(
    "7. declines, cancellations and hang-ups land on the right row state",
    { nat: "open" },
    async (harness) => {
      await openThread(harness);

      /* A decline. */
      const declinedId = await dial(harness);
      await harness.cmd("callee", "decline");
      await harness.waitFor("the caller to see the decline", () => harness.status("caller") === "idle");
      ok("the caller was told it was declined", harness.users.get("caller").notices.includes("Call declined."));
      ok("the row says declined, not missed", harness.row(declinedId).status === "declined");
      ok("a decline is not a missed call", harness.row(declinedId).missed === false);

      /* A caller who changes their mind. */
      const canceledId = await dial(harness);
      await harness.cmd("caller", "hangUp", { notify: "Call ended." });
      await harness.waitFor("the callee's ring to stop", () => harness.status("callee") === "idle");
      ok("the row says canceled", harness.row(canceledId).status === "canceled");
      ok("a cancellation is not a missed call either", harness.row(canceledId).missed === false);

      /* A live call that ends is completed. */
      const completedId = await dial(harness);
      await answer(harness);
      await harness.cmd("callee", "hangUp", { notify: "Call ended." });
      await harness.waitFor("the caller to see the hang-up", () => harness.status("caller") === "idle");
      ok("a call that connected and ended is completed", harness.row(completedId).status === "completed");

      /* And the engine is reusable: the next call must start from clean. */
      const againId = await dial(harness);
      ok("a second call gets its own row", againId !== completedId);
      ok("the second row is ringing", harness.row(againId).status === "ringing");
      await answer(harness);
      ok("and it connects too", harness.status("caller") === "in_call");
    }
  );

  /* --------------------------------------------------------------------- */

  await scenario(
    "8. a callee who never picks up leaves the ring to the server",
    { nat: "open", dilate: { min: 40_000, max: 70_000, factor: 100 } },
    async (harness) => {
      await openThread(harness);
      const callId = await dial(harness);
      await harness.waitFor("the caller to give up after the ring window", () => harness.status("caller") === "idle", {
        timeout: 10_000,
      });
      ok("the row records a miss", ["missed", "expired"].includes(harness.row(callId).status));
      ok("and marks it missed for the callee", harness.row(callId).missed === true);
    }
  );

  /* --------------------------------------------------------------------- */

  await scenario(
    "9. a second call cannot be placed while one is live",
    { nat: "open" },
    async (harness) => {
      await openThread(harness);
      await dial(harness);
      await answer(harness);

      /* The callee's device tries to dial back mid-call. */
      await harness.cmd("callee", "startCall", { conversationId: CONVERSATION_ID, peerId: CALLER_ID });
      await sleep(50);
      ok("the live call survives the attempt", harness.status("callee") === "in_call");
      ok("no second row was opened", harness.rows.filter((row) => row.status === "ringing").length === 0);
    }
  );

  await scenario(
    "10. a user whose last call died is still callable",
    { nat: "open" },
    async (harness) => {
      await openThread(harness);
      const deadId = await dial(harness);
      await answer(harness);

      /* The callee's device dies mid-call: no hang-up, no end_call_log, just
         a row left `answered` with no end. Before 202609120003 that row made
         this user permanently busy — every friend was told "They're on
         another call right now", forever, with nothing to sweep it.

         The engines are closed quietly here (a real dead device would simply
         stop existing); what is left behind is the row it never wrote. */
      await harness.cmd("caller", "hangUp", { notify: null });
      await harness.cmd("callee", "hangUp", { notify: null });
      const dead = harness.row(deadId);
      dead.status = "answered";
      dead.started_at = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      dead.ended_at = null;

      const nextId = await dial(harness);
      ok("the next call is not refused as busy", nextId !== deadId);
      ok("a fresh row was opened", harness.row(nextId).status === "ringing");
      ok("the orphan was closed as failed", harness.row(deadId).status === "failed");
      await answer(harness);
      ok("and the two users are talking", harness.status("caller") === "in_call");
    }
  );

  /* --------------------------------------------------------------------- */

  await scenario(
    "11. an eleven-minute-old orphan no longer reads as busy",
    { nat: "open" },
    async (harness) => {
      await openThread(harness);
      const deadId = await dial(harness);
      await answer(harness);

      /* The same death as scenario 10, but the orphan is young: eleven
         minutes old. Inside the four-hour window 202609120003 shipped, this
         user was still "on another call" to everyone; the window is now ten
         minutes, so the lazy sweep inside start_call_log closes the orphan
         in the very call that used to be refused. */
      await harness.cmd("caller", "hangUp", { notify: null });
      await harness.cmd("callee", "hangUp", { notify: null });
      const dead = harness.row(deadId);
      dead.status = "answered";
      dead.started_at = new Date(Date.now() - 11 * 60 * 1000).toISOString();
      dead.ended_at = null;

      const nextId = await dial(harness);
      ok("an eleven-minute-old orphan does not block the next call", nextId !== deadId);
      ok("a fresh row was opened", harness.row(nextId).status === "ringing");
      ok("the orphan was closed as failed", harness.row(deadId).status === "failed");
      await answer(harness);
      ok("and the two users are talking", harness.status("caller") === "in_call");
    }
  );

  /* --------------------------------------------------------------------- */

  await scenario(
    "12. a call that ended cannot ring again",
    { nat: "open" },
    async (harness) => {
      await openThread(harness);
      const callId = await dial(harness);
      await harness.waitFor("the callee's ring", () => harness.status("callee") === "incoming");

      /* The caller gives up: the call is over, server-side. */
      await harness.cmd("caller", "hangUp", { notify: "Call ended." });
      await harness.waitFor("the callee's ring to stop", () => harness.status("callee") === "idle");
      ok("the row is canceled", harness.row(callId).status === "canceled");

      /* The server retires the ring row on the terminal transition — this is
         what a cold start looks for (unread 'call' rows inside the window),
         and the UPDATE is what stands down a ring still on screen. */
      const ringRow = harness.notifications.find(
        (note) => note.type === "call" && note.metadata?.call_id === callId
      );
      ok("the ring row was marked read when the call ended", ringRow?.is_read === true);

      /* A tap on the (stale) notification arrives AFTER the end. The payload
         ring carries no row, so the engine verifies the call is still alive
         before it takes the screen — the check that used to not exist, and
         the reason an ended call would ring again. */
      await harness.cmd("callee", "beginIncomingRing", {
        conversationId: CONVERSATION_ID,
        callerId: CALLER_ID,
        callId,
        createdAt: Date.now(),
      });
      await sleep(100);
      ok("a stale tap does not ring a call that is over", harness.status("callee") === "idle");
      await harness.settleFor("the overlay must not come up late", () => harness.status("callee") === "incoming", 600);

      /* And the live path still rings: a fresh call, fresh row, fresh tap. */
      const liveId = await dial(harness);
      await harness.cmd("callee", "beginIncomingRing", {
        conversationId: CONVERSATION_ID,
        callerId: CALLER_ID,
        callId: liveId,
        createdAt: Date.now(),
      });
      await harness.waitFor("a live call to ring", () => harness.status("callee") === "incoming");
      ok("a live call still rings from the same path", harness.status("callee") === "incoming");
      await harness.cmd("callee", "accept");
      await harness.waitFor("the answer to connect", () => harness.status("caller") === "in_call");
      ok("and it connects", harness.status("callee") === "in_call");
    }
  );

  console.log("\nTWO-USER CALL FLOW PASSED");
} catch (error) {
  failures += 1;
  console.error(`\nFAIL ${error.message}`);
  if (error.stack) console.error(error.stack.split("\n").slice(1, 4).join("\n"));
  process.exitCode = 1;
}

process.exit(failures ? 1 : 0);
