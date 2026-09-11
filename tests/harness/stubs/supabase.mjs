/**
 * Double for lib/supabase/client.ts.
 *
 * The call engine and the signaling manager talk to Supabase through exactly
 * four surfaces: `rpc()`, `channel()`, `removeChannel()` and `auth.getSession()`.
 * This implements all four, and routes them to the harness parent, which plays
 * the server: it owns the call_logs table, the start/end transition RPCs, and
 * the realtime broadcast bus that carries signals between the two devices.
 *
 * Nothing here decides whether a call succeeds. It moves bytes, the way the
 * real client does.
 */
import { parentPort } from "node:worker_threads";

const USER_ID = globalThis.__harnessUserId ?? "user-a";

let nextRequestId = 1;
const pendingRpc = new Map();

parentPort.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.kind === "rpc-result") {
    const settle = pendingRpc.get(message.reqId);
    if (settle) {
      pendingRpc.delete(message.reqId);
      settle({ data: message.data ?? null, error: message.error ?? null });
    }
    return;
  }
  if (message.kind === "inbound") {
    for (const handler of broadcastHandlers.get(message.channelId) ?? []) {
      handler({ payload: message.payload });
    }
    return;
  }
  if (message.kind === "log-update") {
    for (const handler of logHandlers.values()) handler({ new: message.row, old: message.row });
  }
});

/** channelId -> broadcast callbacks (matches how supabase-js keys a channel). */
const broadcastHandlers = new Map();
/** channelId -> postgres_changes callbacks. */
const logHandlers = new Map();

let channelSeq = 0;

class FakeChannel {
  constructor(topic) {
    this.topic = topic;
    this.id = `${USER_ID}:${topic}#${++channelSeq}`;
    this.joined = false;
  }

  on(kind, filter, callback) {
    if (kind === "broadcast") {
      const list = broadcastHandlers.get(this.id) ?? new Set();
      list.add(callback);
      broadcastHandlers.set(this.id, list);
    } else if (kind === "postgres_changes") {
      logHandlers.set(this.id, callback);
    }
    return this;
  }

  subscribe() {
    this.joined = true;
    parentPort.postMessage({ kind: "channel-join", channelId: this.id, topic: this.topic });
    return this;
  }

  async send(payload) {
    parentPort.postMessage({
      kind: "broadcast",
      channelId: this.id,
      topic: this.topic,
      payload: payload?.payload ?? null,
      event: payload?.event ?? null,
    });
    return "ok";
  }
}

const channels = new Map();

export const supabase = {
  rpc(fn, args) {
    const reqId = nextRequestId++;
    return new Promise((resolve) => {
      pendingRpc.set(reqId, resolve);
      parentPort.postMessage({ kind: "rpc", reqId, fn, args: args ?? {} });
    });
  },

  channel(topic) {
    const channel = new FakeChannel(topic);
    channels.set(channel.id, channel);
    return channel;
  },

  removeChannel(channel) {
    if (!channel) return;
    channels.delete(channel.id);
    broadcastHandlers.delete(channel.id);
    logHandlers.delete(channel.id);
    parentPort.postMessage({ kind: "channel-leave", channelId: channel.id, topic: channel.topic });
  },

  from(table) {
    /* Only the pre-0005 legacy write paths use this; the harness server
       records them so a test can assert the engine did NOT fall back. */
    const call = { table, method: null, payload: null, filters: [] };
    const builder = {
      insert(payload) {
        call.method = "insert";
        call.payload = payload;
        return builder;
      },
      update(payload) {
        call.method = "update";
        call.payload = payload;
        return builder;
      },
      select() {
        return builder;
      },
      eq(column, value) {
        call.filters.push([column, value]);
        return builder;
      },
      then(resolve, reject) {
        const reqId = nextRequestId++;
        const promise = new Promise((settle) => {
          pendingRpc.set(reqId, settle);
          parentPort.postMessage({ kind: "table-write", reqId, call });
        });
        return promise.then(resolve, reject);
      },
    };
    return builder;
  },

  auth: {
    async getSession() {
      return { data: { session: { access_token: `token-${USER_ID}`, user: { id: USER_ID } } } };
    },
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe() {} } } };
    },
  },
};

export default supabase;
