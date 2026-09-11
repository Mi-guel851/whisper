/**
 * One user's device, in a worker thread.
 *
 * The point of running the engine here rather than in the test process is that
 * a call has TWO owners and neither one is in charge: the caller's engine and
 * the callee's engine are separate instances in separate module graphs, joined
 * only by the signaling bus and the peer connection — exactly like two phones.
 * The test drives both and watches what they do to each other.
 *
 * What is faked, and how faithfully:
 *
 *   RTCPeerConnection — a state machine with the real surface the engine uses
 *     (createOffer/createAnswer/setLocal/setRemote/addIceCandidate/addTrack,
 *     plus the four event handlers). It reports ICE readiness only when it
 *     genuinely has a local description, a remote description AND a remote
 *     candidate, so a dropped answer or a dropped candidate shows up here as a
 *     call that never connects — the bug under test — rather than as a pass.
 *
 *   MediaStream / Audio / navigator / window — the minimum the engine touches.
 *
 * Everything imported from lib/ is the shipped code.
 */
import { parentPort } from "node:worker_threads";
import { register } from "node:module";

/* The `@/` alias and extensionless TypeScript imports are a bundler feature;
   this is what teaches Node about them (see tests/harness/hooks.mjs). */
register("./hooks.mjs", import.meta.url);

const USER_ID = process.env.HARNESS_USER_ID ?? "user-a";
globalThis.__harnessUserId = USER_ID;

/* ------------------------------------------------------------------ */
/* Time dilation                                                       */
/* ------------------------------------------------------------------ */

/**
 * The connect watchdog is 25 seconds of wall clock. Observing it in a test
 * would make the suite slower than the bug it is watching for, so delays
 * inside a configured band are scaled down — only scaled, never reordered,
 * so what the test sees is the real sequence at 100x.
 */
if (process.env.HARNESS_DILATE) {
  const [min, max, factor] = process.env.HARNESS_DILATE.split(",").map(Number);
  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  const scale = (ms) =>
    typeof ms === "number" && ms >= min && ms < max ? Math.max(1, Math.round(ms / factor)) : ms;
  globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, scale(ms), ...args);
  globalThis.setInterval = (fn, ms, ...args) => realSetInterval(fn, scale(ms), ...args);
}

/* ------------------------------------------------------------------ */
/* The TURN credentials route                                          */
/* ------------------------------------------------------------------ */

/**
 * lib/calls/iceServers.ts asks /api/calls/turn-credentials for a relay. The
 * harness answers with what that route answers: a minted relay, or — with
 * HARNESS_NO_TURN, i.e. the operator has configured nothing — the empty list
 * that leaves the peer connection STUN-only.
 */
const NO_TURN = process.env.HARNESS_NO_TURN === "1";

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
  };
}

globalThis.fetch = async (url) => {
  if (String(url).includes("/api/calls/turn-credentials")) {
    if (NO_TURN) return jsonResponse({ iceServers: [], turnConfigured: false });
    return jsonResponse({
      iceServers: [
        {
          urls: ["turn:relay.whisper.test:3478?transport=udp"],
          username: "whisper-harness",
          credential: "harness-credential",
        },
      ],
      turnConfigured: true,
      expiresInSeconds: 1800,
    });
  }
  throw new Error(`unexpected fetch in call harness: ${url}`);
};

/* ------------------------------------------------------------------ */
/* Media fakes                                                         */
/* ------------------------------------------------------------------ */

let trackSeq = 0;

class FakeMediaStreamTrack {
  constructor(kind = "audio") {
    this.kind = kind;
    this.id = `track-${++trackSeq}`;
    this.enabled = true;
    this.readyState = "live";
  }
  stop() {
    this.readyState = "ended";
  }
}

class FakeMediaStream {
  constructor(tracks = [new FakeMediaStreamTrack()]) {
    this._tracks = tracks;
  }
  getTracks() {
    return this._tracks;
  }
  getAudioTracks() {
    return this._tracks.filter((track) => track.kind === "audio");
  }
  addTrack(track) {
    this._tracks.push(track);
  }
}

class FakeAudio {
  constructor() {
    this.srcObject = null;
    this.autoplay = false;
    this.played = 0;
    this.sinkId = null;
  }
  async play() {
    this.played += 1;
    return undefined;
  }
  async setSinkId(id) {
    this.sinkId = id;
  }
}

/* ------------------------------------------------------------------ */
/* RTCPeerConnection                                                   */
/* ------------------------------------------------------------------ */

const peers = new Map();
let pcSeq = 0;

class FakeRTCPeerConnection {
  constructor(config = {}) {
    this.id = `${USER_ID}-pc${++pcSeq}`;
    this.config = config;
    this.iceServers = config.iceServers ?? [];
    this.localDescription = null;
    this.remoteDescription = null;
    this.signalingState = "stable";
    this.iceConnectionState = "new";
    this.iceGatheringState = "new";
    this.connectionState = "new";
    this.remoteCandidates = [];
    this.localCandidates = [];
    this.sentTracks = [];
    this.onicecandidate = null;
    this.ontrack = null;
    this.oniceconnectionstatechange = null;
    this.onconnectionstatechange = null;
    this.closed = false;
    this.readyReported = false;
    peers.set(this.id, this);
  }

  /** A TURN server in the config is what makes a relay candidate possible. */
  get hasRelay() {
    return this.iceServers.some((server) => String(server.urls ?? server.url ?? "").includes("turn:"));
  }

  addTrack(track, stream) {
    this.sentTracks.push({ track, stream });
  }

  async createOffer(options = {}) {
    this._offerOptions = options;
    return {
      type: "offer",
      sdp: `v=0\r\no=- ${this.id} 1 IN IP4 127.0.0.1\r\na=offerer:${this.id}\r\n`,
    };
  }

  async createAnswer() {
    const offerer = (this.remoteDescription?.sdp.match(/a=offerer:(\S+)/) ?? [])[1] ?? "unknown";
    return {
      type: "answer",
      sdp: `v=0\r\no=- ${this.id} 1 IN IP4 127.0.0.1\r\na=offerer:${offerer}\r\na=answerer:${this.id}\r\n`,
    };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
    this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
    /* Both sides gather. A real answerer starts trickle-gathering the moment
       it sets its local description, and a harness that only gathered for the
       offerer would hide exactly the class of bug under test here. */
    this._gather();
  }

  async setRemoteDescription(description) {
    this.remoteDescription = description;
    this.signalingState = description.type === "answer" ? "stable" : "have-remote-offer";
    this._reportReady();
  }

  async addIceCandidate(candidate) {
    if (!candidate) return;
    this.remoteCandidates.push(candidate);
    this._reportReady();
  }

  close() {
    this.closed = true;
    this.iceConnectionState = "closed";
    this.connectionState = "closed";
    this.onicecandidate = null;
    this.ontrack = null;
    this.oniceconnectionstatechange = null;
    this.onconnectionstatechange = null;
    peers.delete(this.id);
  }

  /** Gather the way a real browser does: a trickle, then a null terminator. */
  _gather() {
    if (this.gathered) return;
    this.gathered = true;
    const kinds = this.hasRelay ? ["host", "srflx", "relay"] : ["host", "srflx"];
    kinds.forEach((kind, index) => {
      setTimeout(() => {
        if (this.closed) return;
        const candidate = {
          candidate: `candidate:${index} 1 udp 2113937151 192.168.1.${index + 2} 5${index}000 typ ${kind}`,
          sdpMid: "0",
          sdpMLineIndex: 0,
          usernameFragment: "abcd",
        };
        this.localCandidates.push(candidate);
        this.onicecandidate?.({ candidate: { toJSON: () => ({ ...candidate }) } });
      }, index);
    });
    setTimeout(() => {
      if (this.closed) return;
      this.iceGatheringState = "complete";
      this.onicecandidate?.({ candidate: null });
    }, kinds.length);
  }

  /**
   * "I could connect, if the other side is ready too." A real peer connection
   * starts connectivity checks once it has a remote description and at least
   * one remote candidate; the parent decides whether the pair actually
   * completes, because that depends on the network, not on this device.
   */
  _reportReady() {
    if (this.readyReported || this.closed) return;
    if (!this.localDescription || !this.remoteDescription) return;
    if (this.remoteCandidates.length === 0) return;
    this.readyReported = true;
    const sdp = this.remoteDescription.sdp;
    /* Whoever wrote the other half of this description is the peer. */
    const peerId =
      (sdp.match(/a=answerer:(\S+)/) ?? [])[1] ?? (sdp.match(/a=offerer:(\S+)/) ?? [])[1] ?? null;
    parentPort.postMessage({
      kind: "ice-ready",
      pcId: this.id,
      peerPcId: peerId,
      hasRelay: this.hasRelay,
    });
  }

  /** Driven by the parent: the network let the pair through. */
  _connect() {
    if (this.closed) return;
    this.ontrack?.({
      streams: [new FakeMediaStream()],
      track: new FakeMediaStreamTrack(),
    });
    this.iceConnectionState = "connected";
    this.connectionState = "connected";
    this.oniceconnectionstatechange?.();
    this.onconnectionstatechange?.();
  }

  _fail() {
    if (this.closed) return;
    this.iceConnectionState = "failed";
    this.connectionState = "failed";
    this.oniceconnectionstatechange?.();
    this.onconnectionstatechange?.();
  }
}

/* ------------------------------------------------------------------ */
/* Browser globals                                                     */
/* ------------------------------------------------------------------ */

const store = new Map();

globalThis.RTCPeerConnection = FakeRTCPeerConnection;
globalThis.MediaStream = FakeMediaStream;
globalThis.Audio = FakeAudio;
/* Node 22 ships its own read-only `navigator`; replace it by definition. */
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  writable: true,
  value: {
    onLine: true,
    userAgent: "harness",
    mediaDevices: {
      async getUserMedia() {
        return new FakeMediaStream();
      },
      async enumerateDevices() {
        return [
          { kind: "audiooutput", deviceId: "default", label: "Default" },
          { kind: "audiooutput", deviceId: "speaker", label: "Speaker" },
        ];
      },
    },
    vibrate() {
      return true;
    },
  },
});
globalThis.window = {
  localStorage: {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
  addEventListener() {},
  removeEventListener() {},
  AudioContext: undefined,
};
globalThis.document = {
  visibilityState: "visible",
  addEventListener() {},
  removeEventListener() {},
};

/* ------------------------------------------------------------------ */
/* The real engine                                                     */
/* ------------------------------------------------------------------ */

const { callSession } = await import("@/lib/calls/callSession");

const notices = [];
callSession.onNotice((message) => {
  notices.push(message);
  parentPort.postMessage({ kind: "notice", message });
});

callSession.subscribe(() => {
  parentPort.postMessage({ kind: "state", snapshot: { ...callSession.getSnapshot() } });
});

/* ------------------------------------------------------------------ */
/* Commands from the test                                              */
/* ------------------------------------------------------------------ */

const actions = {
  setIdentity: (args) => callSession.setIdentity(args.userId ?? USER_ID),
  attachThread: (args) => {
    const detach = callSession.attachThread(args);
    return typeof detach === "function" ? "attached" : "detached";
  },
  startCall: async (args) => {
    await callSession.startCall(args);
    return "started";
  },
  accept: async () => {
    await callSession.accept();
    return "accepted";
  },
  decline: () => callSession.decline(),
  hangUp: (args = {}) => callSession.hangUp(args.notify ?? "Call ended.", args.reason ?? "user"),
  toggleMute: () => callSession.toggleMute(),
  toggleSpeaker: async () => callSession.toggleSpeaker(),
  setMinimized: (args) => callSession.setMinimized(Boolean(args.minimized)),
  forceClearPhantom: async () => callSession.forceClearPhantom(),
  beginIncomingRing: (args) => callSession.beginIncomingRing(args),
  snapshot: () => ({ ...callSession.getSnapshot() }),
  notices: () => notices.slice(),
  iceConnect: () => {
    for (const pc of peers.values()) pc._connect();
    return "connected";
  },
  iceFail: () => {
    for (const pc of peers.values()) pc._fail();
    return "failed";
  },
  peerStats: () =>
    [...peers.values()].map((pc) => ({
      id: pc.id,
      hasRelay: pc.hasRelay,
      signalingState: pc.signalingState,
      iceConnectionState: pc.iceConnectionState,
      connectionState: pc.connectionState,
      localCandidates: pc.localCandidates.length,
      remoteCandidates: pc.remoteCandidates.length,
      sentTracks: pc.sentTracks.length,
      closed: pc.closed,
    })),
};

parentPort.on("message", async (message) => {
  if (!message || message.kind !== "cmd") return;
  const handler = actions[message.name];
  if (!handler) {
    parentPort.postMessage({ kind: "cmd-result", reqId: message.reqId, error: `unknown ${message.name}` });
    return;
  }
  try {
    const value = await handler(message.args ?? {});
    parentPort.postMessage({ kind: "cmd-result", reqId: message.reqId, value });
  } catch (error) {
    parentPort.postMessage({
      kind: "cmd-result",
      reqId: message.reqId,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
});

parentPort.postMessage({ kind: "ready", userId: USER_ID });
