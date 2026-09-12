/**
 * Two devices, one bus, one server — the shape of a real call.
 *
 * `CallHarness.start()` boots two worker threads (tests/harness/device.mjs),
 * each running the app's real call engine as a separate user, and then plays
 * the two roles the devices cannot play for themselves:
 *
 *   THE SERVER — an in-memory `call_logs` table plus start_call_log /
 *     end_call_log, mirroring the transition table in
 *     supabase/migrations/202609100006 (+ the later call migrations) line for
 *     line, including the notifications row and the postgres_changes UPDATE
 *     the devices watch. A test can read `harness.rows` to see what the log
 *     actually says, which is the half of the bug report the UI cannot show.
 *
 *   THE NETWORK — routes whisper-call:<conversation> broadcasts between the
 *     two devices, and decides whether ICE can complete. `nat: "symmetric"`
 *     (the default) means no direct UDP path exists, so a pair connects only
 *     if at least one side has a TURN relay — the condition a carrier network
 *     puts two phones in, and the one the bug report describes.
 */
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const CALLER_ID = "11111111-1111-4111-8111-111111111111";
export const CALLEE_ID = "22222222-2222-4222-8222-222222222222";
export const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";

const TERMINAL = ["completed", "canceled", "declined", "missed", "expired", "busy", "failed"];

/** Mirrors `v_live_window` in 202609120004: ten minutes, not four hours. */
const LIVE_WINDOW_MS = 10 * 60 * 1000;

export class CallHarness {
  constructor({
    nat = "symmetric",
    missingRpc = null,
    log = false,
    noTurn = false,
    dilate = null,
    dropSignals = null,
  } = {}) {
    this.nat = nat;
    this.noTurn = noTurn;
    this.dilate = dilate;
    /** `{ answer: 1 }` swallows the first N of that event — a lossy link. */
    this.dropSignals = { ...(dropSignals ?? {}) };
    this.dropped = [];
    /** Simulate a database without the lifecycle migration (legacy path). */
    this.missingRpc = missingRpc;
    this.log = log;
    this.users = new Map();
    this.rows = [];
    this.notifications = [];
    this.signals = [];
    this.tableWrites = [];
    this.writes = [];
    this.readyPairs = new Map();
    this.connected = [];
    this.requests = new Map();
    this.nextRequestId = 1;
  }

  static async start(options) {
    const harness = new CallHarness(options);
    await harness._boot();
    return harness;
  }

  async _boot() {
    for (const [name, userId] of [
      ["caller", CALLER_ID],
      ["callee", CALLEE_ID],
    ]) {
      const worker = new Worker(path.join(HERE, "device.mjs"), {
        /* The app's .ts files carry no package "type"; that warning is noise
           in a test log, and adding "type":"module" to package.json would
           break the Next.js build to silence it. */
        execArgv: ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"],
        env: {
          ...process.env,
          HARNESS_USER_ID: userId,
          HARNESS_NO_TURN: this.noTurn ? "1" : "",
          HARNESS_DILATE: this.dilate ? `${this.dilate.min},${this.dilate.max},${this.dilate.factor}` : "",
        },
      });
      const user = {
        name,
        userId,
        worker,
        snapshot: { status: "idle" },
        notices: [],
        states: [],
        channels: new Map(),
      };
      this.users.set(name, user);
      worker.on("message", (message) => this._onMessage(user, message));
      worker.on("error", (error) => {
        this.writes.push({ kind: "worker-error", name, error: String(error) });
      });
    }
    for (const user of this.users.values()) {
      await this._waitForRaw(user, "ready", 15_000);
      await this.cmd(user.name, "setIdentity", { userId: user.userId });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Test-facing API                                                   */
  /* ---------------------------------------------------------------- */

  cmd(name, action, args) {
    const user = this.users.get(name);
    if (!user) throw new Error(`unknown user ${name}`);
    const reqId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(reqId);
        reject(new Error(`${name}.${action} timed out`));
      }, 20_000);
      this.requests.set(reqId, { resolve, reject, timer });
      user.worker.postMessage({ kind: "cmd", reqId, name: action, args });
    });
  }

  status(name) {
    return this.users.get(name).snapshot.status;
  }

  snapshot(name) {
    return this.users.get(name).snapshot;
  }

  /** Poll until `predicate` holds. Fails with the last state it saw. */
  async waitFor(label, predicate, { timeout = 8_000, interval = 10 } = {}) {
    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
      last = predicate();
      if (last) return last;
      await sleep(interval);
    }
    const detail = [...this.users.values()]
      .map((user) => `${user.name}=${JSON.stringify(user.snapshot)}`)
      .join("  ");
    throw new Error(`timed out waiting for ${label}\n  last: ${detail}\n  notices: ${JSON.stringify(this.allNotices())}`);
  }

  /** Poll until `predicate` is still false after `settle` ms — the "did not happen" check. */
  async settleFor(label, predicate, settle = 400) {
    const deadline = Date.now() + settle;
    while (Date.now() < deadline) {
      if (predicate()) {
        throw new Error(`${label} was expected NOT to happen, but it did`);
      }
      await sleep(20);
    }
    return true;
  }

  allNotices() {
    return [...this.users.values()].flatMap((user) => user.notices.map((message) => `${user.name}: ${message}`));
  }

  row(callId) {
    return this.rows.find((row) => row.call_id === callId) ?? this.rows.at(-1) ?? null;
  }

  signalsOf(event) {
    return this.signals.filter((signal) => signal.event === event);
  }

  async stop() {
    for (const user of this.users.values()) await user.worker.terminate();
    this.users.clear();
  }

  /* ---------------------------------------------------------------- */
  /* Worker plumbing                                                   */
  /* ---------------------------------------------------------------- */

  _onMessage(user, message) {
    if (!message || typeof message !== "object") return;
    if (this.log) console.log(`  [${user.name}]`, message.kind, JSON.stringify(message).slice(0, 220));

    switch (message.kind) {
      case "ready": {
        this._settleRaw(user, "ready");
        return;
      }
      case "cmd-result": {
        const request = this.requests.get(message.reqId);
        if (!request) return;
        this.requests.delete(message.reqId);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(`${user.name}: ${message.error}`));
        else request.resolve(message.value);
        return;
      }
      case "state": {
        user.snapshot = message.snapshot;
        user.states.push(message.snapshot);
        return;
      }
      case "notice": {
        user.notices.push(message.message);
        return;
      }
      case "rpc": {
        const result = this._rpc(user, message.fn, message.args);
        user.worker.postMessage({ kind: "rpc-result", reqId: message.reqId, ...result });
        return;
      }
      case "table-write": {
        this.tableWrites.push({ user: user.name, ...message.call });
        user.worker.postMessage({ kind: "rpc-result", reqId: message.reqId, data: [], error: null });
        return;
      }
      case "table-read": {
        user.worker.postMessage({ kind: "rpc-result", reqId: message.reqId, data: this._tableRead(message.call), error: null });
        return;
      }
      case "channel-join": {
        user.channels.set(message.channelId, message.topic);
        return;
      }
      case "channel-leave": {
        user.channels.delete(message.channelId);
        return;
      }
      case "broadcast": {
        this._routeBroadcast(user, message);
        return;
      }
      case "ice-ready": {
        this._noteIceReady(user, message);
        return;
      }
      default:
        return;
    }
  }

  _waitForRaw(user, kind, timeout) {
    if (user[`__${kind}Done`]) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${user.name} never became ${kind}`)), timeout);
      user[`__${kind}`] = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  _settleRaw(user, kind) {
    /* The worker can report before the test asks: remember it either way. */
    user[`__${kind}Done`] = true;
    user[`__${kind}`]?.();
  }

  /* ---------------------------------------------------------------- */
  /* The network                                                       */
  /* ---------------------------------------------------------------- */

  _routeBroadcast(from, message) {
    const signal = message.payload;
    const eventName = signal?.event ?? message.event;
    if ((this.dropSignals[eventName] ?? 0) > 0) {
      this.dropSignals[eventName] -= 1;
      this.dropped.push({ from: from.name, event: eventName });
      return;
    }
    /* Recorded in the shape the app uses: the event, who sent it, and the
       payload proper — not the broadcast envelope around them. */
    this.signals.push({
      from: from.name,
      event: signal?.event ?? message.event,
      user_id: signal?.user_id ?? null,
      payload: signal?.payload ?? null,
      at: Date.now(),
    });
    for (const user of this.users.values()) {
      if (user === from) continue;
      for (const [channelId, topic] of user.channels) {
        if (topic !== message.topic) continue;
        user.worker.postMessage({ kind: "inbound", channelId, payload: signal });
      }
    }
  }

  /**
   * A pair of peer connections is only connectable when BOTH sides have
   * finished the handshake and exchanged candidates. Whether the network then
   * lets it through is the harness's call: with `nat: "symmetric"` there is no
   * direct path, so the pair needs a relay on at least one side — which is the
   * real-world condition behind "it sits on Connecting… forever".
   */
  _noteIceReady(user, message) {
    this.readyPairs.set(message.pcId, { user, ...message });
    const peer = this.readyPairs.get(message.peerPcId);
    if (!peer || peer.paired) return;
    peer.paired = true;
    const mine = this.readyPairs.get(message.pcId);
    mine.paired = true;

    const directPath = this.nat === "open";
    const relay = peer.hasRelay || mine.hasRelay;
    this.connected.push({ pair: [peer.pcId, mine.pcId], directPath, relay });
    if (directPath || relay) {
      peer.user.worker.postMessage({ kind: "cmd", reqId: `ice-${peer.pcId}`, name: "iceConnect" });
      mine.user.worker.postMessage({ kind: "cmd", reqId: `ice-${mine.pcId}`, name: "iceConnect" });
    }
  }

  /* ---------------------------------------------------------------- */
  /* The server: call_logs + the transition RPCs                       */
  /* ---------------------------------------------------------------- */

  _rpc(user, fn, args) {
    if (this.missingRpc === fn || this.missingRpc === "*") {
      return { data: null, error: { code: "42883", message: `function public.${fn} does not exist` } };
    }

    if (fn === "start_call_log") {
      const callId = args.p_call_id;
      const conversationId = args.p_conversation_id;
      if (args.p_force_clear_stale) {
        for (const row of this.rows) {
          if (row.status === "ringing" && (row.caller_id === user.userId || row.callee_id === user.userId)) {
            row.status = "canceled";
            row.ended_at = row.ended_at ?? new Date().toISOString();
            this._publishLogUpdate(row);
          }
        }
      }
      const peerId = user.userId === CALLER_ID ? CALLEE_ID : CALLER_ID;

      /* Lazy expiry, both parties, exactly like the SQL. */
      for (const row of this.rows) {
        if (row.status === "ringing" && Date.now() - Date.parse(row.started_at) > 60_000) {
          row.status = "expired";
          row.ended_at = row.ended_at ?? new Date().toISOString();
          row.missed = true;
          this._publishLogUpdate(row);
        }
        /* The orphan sweep from 202609120003: an `answered` row nobody ever
           closed came from a device that died, and left open it made that
           user unreachable forever. */
        if (
          row.status === "answered" &&
          row.ended_at === null &&
          Date.now() - Date.parse(row.started_at) > LIVE_WINDOW_MS
        ) {
          row.status = "failed";
          row.ended_at = new Date().toISOString();
          this._publishLogUpdate(row);
        }
      }

      /* Busy is a live call, and only a live call. */
      const busy = this.rows.some(
        (row) =>
          row.status === "answered" &&
          (row.caller_id === peerId || row.callee_id === peerId) &&
          row.ended_at === null &&
          Date.now() - Date.parse(row.started_at) < LIVE_WINDOW_MS
      );
      if (busy) return { data: { status: "busy" }, error: null };

      const row = {
        id: `log-${this.rows.length + 1}`,
        call_id: callId,
        conversation_id: conversationId,
        caller_id: user.userId,
        callee_id: peerId,
        started_at: new Date().toISOString(),
        ended_at: null,
        answered_at: null,
        missed: false,
        status: "ringing",
      };
      this.rows.push(row);
      this._publishLogUpdate(row);
      this.notifications.push({
        user_id: peerId,
        type: "call",
        source_id: row.id,
        is_read: false,
        metadata: {
          type: "call",
          call_id: callId,
          conversation_id: conversationId,
          caller_id: user.userId,
        },
      });
      return {
        data: {
          status: "ringing",
          id: row.id,
          call_id: row.call_id,
          started_at: row.started_at,
          conversation_id: conversationId,
          callee_id: peerId,
          alerted: true,
        },
        error: null,
      };
    }

    if (fn === "end_call_log") {
      const row = this.rows.find((r) => r.call_id === args.p_call_id);
      if (!row) return { data: null, error: { code: "P0002", message: "Call not found" } };
      const me = user.userId;
      const outcome = args.p_outcome;

      const next =
        me === row.caller_id && row.status === "ringing" && ["canceled", "missed"].includes(outcome)
          ? outcome
          : row.status === "answered" && ["completed", "failed"].includes(outcome)
            ? outcome
            : me === row.callee_id && row.status === "ringing" && ["answered", "declined", "busy"].includes(outcome)
              ? outcome
              : me === row.caller_id && row.status === "ringing" && outcome === "failed"
                ? "failed"
                : null;

      if (!next) {
        return { data: { status: row.status, ignored: true, id: row.id, call_id: row.call_id }, error: null };
      }

      row.status = next;
      row.missed = ["missed", "expired"].includes(next);
      if (next === "answered") {
        row.answered_at = row.answered_at ?? new Date().toISOString();
      } else {
        row.ended_at = new Date().toISOString();
      }
      /* 202609120004: EVERY legal transition retires the callee's ring row —
         answered elsewhere, declined, canceled by the caller, missed, failed,
         completed. An unread 'call' row inside the window is what a cold
         start (and a tap on the stale push) rings from, so a call that is
         over must never be able to ring again. */
      for (const note of this.notifications) {
        if (note.type === "call" && note.user_id === row.callee_id) note.is_read = true;
      }
      this._publishLogUpdate(row);
      return { data: { status: next, id: row.id, call_id: row.call_id }, error: null };
    }

    if (fn === "force_clear_my_calls") {
      let updated = 0;
      for (const row of this.rows) {
        if (
          ["ringing", "answered"].includes(row.status) &&
          (row.caller_id === user.userId || row.callee_id === user.userId)
        ) {
          row.status = "canceled";
          row.ended_at = row.ended_at ?? new Date().toISOString();
          this._publishLogUpdate(row);
          updated += 1;
        }
      }
      return { data: updated, error: null };
    }

    return { data: null, error: { code: "42883", message: `function public.${fn} does not exist` } };
  }

  _publishLogUpdate(row) {
    for (const user of this.users.values()) {
      for (const [channelId, topic] of user.channels) {
        if (!topic.startsWith("call-logs-")) continue;
        user.worker.postMessage({ kind: "log-update", channelId, row: { ...row } });
      }
    }
  }

  /** The read half of the supabase stub: the only select the engine issues is
      beginIncomingRing's verification against call_logs, keyed by call_id. */
  _tableRead(call) {
    if (call.table !== "call_logs") return null;
    const [column, value] = call.filters.find(([, v]) => v != null) ?? [];
    const row = this.rows.find((r) => column && r[column] === value) ?? null;
    if (!row) return null;
    const out = {};
    for (const key of (call.columns ?? "").split(",").map((c) => c.trim()).filter(Boolean)) {
      out[key] = row[key];
    }
    return out;
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const isTerminal = (status) => TERMINAL.includes(status);
