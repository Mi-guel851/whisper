import InCallManager from "react-native-incall-manager";
import {
  MediaStream,
  RTCPeerConnection,
  mediaDevices,
} from "react-native-webrtc";

/** The wire shape of an ICE candidate, as both sides of the signaling speak it. */
type NativeCandidateInit = {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
};

import { callSignaling, type CallSignal, type CallSignalPayload } from "./signaling";
import { getIceServers, type NativeIceServer } from "./iceServers";
import { startRingTone, stopRingTone } from "./ringTone";
import { supabase } from "@/lib/supabase";

/**
 * The 1:1 voice call — one engine, owned by nobody in particular.
 *
 * A port of the web app's `lib/calls/callSession.ts`, protocol-identical: a
 * native caller and a web callee shake hands through the same broadcast
 * channel, the same SDP/ICE shapes, the same retransmission cadences, and the
 * same server bookkeeping (`start_call_log` / `end_call_log` / the call-logs
 * realtime channel). The only platform differences are the media layer —
 * react-native-webrtc in place of the browser's WebRTC — and the audio
 * routing, which InCallManager owns (earpiece by default, speaker on toggle).
 *
 * THE WEB MODULE'S ARCHITECTURE, KEPT INTACT
 *
 * A framework-free state machine instantiated once, mirrored into React
 * through `subscribe`/`getSnapshot` (useSyncExternalStore in the provider).
 * The call survives navigation: minimizing collapses it into the pill and the
 * handshake channel stays open because the call holds its own reference to it.
 *
 * The late-callee machinery is load-bearing and ported whole: the offer is
 * re-broadcast every 2s while ringing, our ICE candidates are buffered and
 * replayed on answer, the answer itself is retransmitted three times, and the
 * pickup race (a retransmitted offer arriving mid-answer) is disarmed the same
 * three ways. All timing constants are the web's.
 *
 * WHAT THE UI RENDERS FROM
 *
 * `CallSnapshot` — the web's shape plus one field: `remoteStreamUrl`, the
 * `toURL()` handle a hidden `<RTCView>` renders from. React Native's WebRTC
 * only moves remote audio onto the hardware when the stream is attached to a
 * view, so the provider mounts a 1×1 (effectively invisible) RTCView for it —
 * the native equivalent of the web's hidden `<audio autoplay>` element.
 */

export type CallStatus = "idle" | "outgoing" | "incoming" | "connecting" | "in_call";

/** What the UI renders from. Immutable between publishes. */
export type CallSnapshot = {
  status: CallStatus;
  direction: "incoming" | "outgoing" | null;
  conversationId: string | null;
  peerId: string | null;
  /** call_logs.call_id of the current attempt. */
  callId: string | null;
  /** ms epoch the call connected, for the duration readout. */
  startedAt: number | null;
  muted: boolean;
  speakerSupported: boolean;
  speakerOn: boolean;
  /** Collapsed into the floating top pill instead of taking the screen. */
  minimized: boolean;
  /** Prefetched peer display for instant call screen (push caller_name/avatar). */
  peerName: string | null;
  peerAvatar: string | null;
  /** The remote stream handle a hidden RTCView renders from (native only). */
  remoteStreamUrl: string | null;
};

/** A ring handed over from a `notifications` row or a push tap. */
export type IncomingRing = {
  conversationId: string;
  callerId: string;
  callId: string | null;
  /**
   * The `notifications` row this ring came from, when it came from one.
   * A row-derived ring is already gated on `is_read = false`; a ring with no
   * row (a push tap, an offer that arrived first) is verified against
   * `call_logs` in `beginIncomingRing` instead.
   */
  rowId?: string | null;
  /** ms epoch, from the row. Used to keep a stale ring from taking the screen. */
  createdAt?: number;
  callerName?: string | null;
  callerAvatar?: string | null;
};

/** Terminal states, in the server's words (call_logs.status). */
const TERMINAL_CALL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "canceled",
  "declined",
  "missed",
  "expired",
  "busy",
  "failed",
]);

/** A conversation the app is currently looking at, so it can hear a ring. */
export type AttachedThread = {
  conversationId: string;
  peerId: string;
  /** Calls exist only between accepted friends; outside that, no channel. */
  enabled: boolean;
};

/** No answer in 45 seconds is a missed call, the way a phone gives up. */
const OUTGOING_TIMEOUT_MS = 45_000;
/** Matches the server's ring window (`expire_stale_calls`). */
const RING_WINDOW_MS = 60_000;
/** How long "disconnected" may linger before an ICE restart is attempted. */
const ICE_DISCONNECT_GRACE_MS = 2_500;
/** How often a ringing caller re-sends its offer to whoever subscribes late. */
const OFFER_RETRANSMIT_MS = 2_000;
/** How long an accepted-but-offer-less callee waits for that retransmission. */
const OFFER_WAIT_MS = 15_000;
/** The answer is re-sent, backed off, up to three times — see retransmitAnswer. */
const ANSWER_RETRANSMIT_MS = 1_500;
const ANSWER_RETRANSMITS = 3;
/** First watchdog restart comes early; the deadline is measured from the answer. */
const CONNECT_RESTART_MS = 12_000;
const CONNECT_TIMEOUT_MS = 25_000;

const IDLE: CallSnapshot = {
  status: "idle",
  direction: null,
  conversationId: null,
  peerId: null,
  callId: null,
  startedAt: null,
  muted: false,
  speakerSupported: true,
  speakerOn: false,
  minimized: false,
  peerName: null,
  peerAvatar: null,
  remoteStreamUrl: null,
};

type Attachment = {
  conversationId: string;
  peerId: string;
  unsubscribe: () => void;
  removeLogChannel: () => void;
};

class CallSession {
  private state: CallSnapshot = { ...IDLE };
  private snapshot: CallSnapshot = this.state;
  private listeners = new Set<() => void>();
  private noticeListeners = new Set<(message: string) => void>();

  private myId: string | null = null;
  private attachments = new Map<string, Attachment>();

  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private pendingOfferSdp: string | null = null;
  /** ICE from the peer that landed before the remote description was set. */
  private queuedRemoteCandidates: RTCIceCandidateInit[] = [];
  /** Our own ICE, kept so a late peer can be handed the whole set on answer. */
  private sentCandidates: RTCIceCandidateInit[] = [];
  private callLogId: string | null = null;
  /** For the CALLEE: the call_id carried by the live offer. */
  private incomingCallId: string | null = null;
  private finalized = false;
  private answered = false;
  /** Media is actually flowing. NOT the same as `answered` — see the web module. */
  private connected = false;
  /** Set while Accept is building the peer connection. */
  private answering = false;
  /** Set when Accept was pressed before any offer arrived. */
  private awaitingOffer = false;
  private iceRestarted = false;
  private prewarmedIce: Promise<NativeIceServer[]> | null = null;
  private pendingPeerName: string | null = null;
  private pendingPeerAvatar: string | null = null;

  private ringingTimeout: ReturnType<typeof setTimeout> | null = null;
  private ringExpiryTimeout: ReturnType<typeof setTimeout> | null = null;
  private vibrationTimer: ReturnType<typeof setInterval> | null = null;
  private iceRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private iceDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retransmitTimer: ReturnType<typeof setInterval> | null = null;
  private answerRetransmitTimer: ReturnType<typeof setTimeout> | null = null;
  private offerWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private connectWatchdog: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    /* The native stack routes audio through the OS audio session, and
       InCallManager can always move it between earpiece and speaker — so the
       speaker button is real here, where the web's `setSinkId` check hides it
       on most mobile browsers. */
    this.state.speakerSupported = true;
  }

  /* ------------------------------------------------------------------ */
  /* Store plumbing                                                      */
  /* ------------------------------------------------------------------ */

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): CallSnapshot => this.snapshot;

  /**
   * Does a control signal belong to the call this device is handling? A
   * straggler `busy`/`decline`/`end` from an earlier attempt must never take
   * down the call that just connected.
   */
  private belongsToCurrentCall(callId: string | null | undefined): boolean {
    if (!callId) return true;
    const mine = this.incomingCallId ?? this.state.callId;
    if (!mine) return true;
    return mine === callId;
  }

  private isIdle(): boolean {
    return this.state.status === "idle";
  }

  /** Toasts. Wired once by the provider to the app's toast host. */
  onNotice = (listener: (message: string) => void) => {
    this.noticeListeners.add(listener);
    return () => {
      this.noticeListeners.delete(listener);
    };
  };

  private publish() {
    this.snapshot = { ...this.state };
    for (const listener of this.listeners) listener();
  }

  private notice(message: string) {
    for (const listener of this.noticeListeners) listener(message);
  }

  private setStatus(next: CallStatus) {
    this.state.status = next;
    this.publish();
  }

  /** The signed-in user. The provider owns auth; the engine only needs the id. */
  setIdentity(userId: string | null) {
    if (this.myId === userId) return;
    this.myId = userId;
    /* Channels are authorized per user: a resolved session opens whatever the
       app already asked for, a lost one closes everything. */
    this.syncChannels();
    if (!userId && this.state.status !== "idle") {
      this.teardownMedia();
      this.releaseCallAttachment();
      this.resetState();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Conversation attachments                                            */
  /* ------------------------------------------------------------------ */

  private wanted = new Map<string, { peerId: string; refs: Set<string> }>();

  private requestChannel(conversationId: string, peerId: string, ref: string) {
    const entry = this.wanted.get(conversationId);
    if (entry) {
      entry.refs.add(ref);
      entry.peerId = peerId;
    } else {
      this.wanted.set(conversationId, { peerId, refs: new Set([ref]) });
    }
    this.syncChannels();
  }

  private releaseChannel(conversationId: string, ref: string) {
    const entry = this.wanted.get(conversationId);
    if (!entry) return;
    entry.refs.delete(ref);
    if (entry.refs.size === 0) this.wanted.delete(conversationId);
    this.syncChannels();
  }

  /**
   * Reconcile the open channels with what is wanted right now. Declarative
   * rather than attach/detach pairs because the identity arrives
   * asynchronously (see the web module).
   */
  private syncChannels() {
    if (!this.myId) {
      for (const conversationId of [...this.attachments.keys()]) this.closeChannel(conversationId);
      return;
    }
    for (const conversationId of [...this.attachments.keys()]) {
      if (!this.wanted.has(conversationId)) this.closeChannel(conversationId);
    }
    for (const [conversationId, entry] of this.wanted) {
      const existing = this.attachments.get(conversationId);
      if (existing) {
        existing.peerId = entry.peerId;
        continue;
      }
      this.openChannel(conversationId, entry.peerId);
    }
  }

  private openChannel(conversationId: string, peerId: string) {
    const unsubscribe = callSignaling.subscribe(conversationId, this.myId ?? "", (signal) =>
      this.handleSignal(signal, conversationId, peerId)
    );

    /* Stale-ring convergence: call_logs is in the realtime publication and
       readable by participants, so when ANY device of either party settles
       the row, every surface here stands down too. `answered` is not an
       ending — it is the opposite (the DB commit can beat the answer
       broadcast); only a terminal status stands the surface down. */
    const logChannel = supabase
      .channel(`call-logs-${conversationId}-${this.myId ?? "anon"}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "call_logs",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as { status?: string };
          if (
            (this.state.status === "incoming" || this.state.status === "outgoing") &&
            this.state.conversationId === conversationId &&
            row.status &&
            row.status !== "ringing"
          ) {
            if (row.status === "answered") return;
            this.stopIncomingVibration();
            if (!this.answered) {
              this.notice(
                row.status === "missed" || row.status === "expired"
                  ? "The call timed out."
                  : "Call ended before it connected."
              );
              this.endLocalCall(false);
            }
          }
        }
      )
      .subscribe();

    this.attachments.set(conversationId, {
      conversationId,
      peerId,
      unsubscribe,
      removeLogChannel: () => {
        supabase.removeChannel(logChannel);
      },
    });
  }

  private closeChannel(conversationId: string) {
    const attachment = this.attachments.get(conversationId);
    if (!attachment) return;
    attachment.unsubscribe();
    attachment.removeLogChannel();
    this.attachments.delete(conversationId);
  }

  /** The chat screen's hook-in: "I am looking at this thread, it can ring." */
  attachThread = ({ conversationId, peerId, enabled }: AttachedThread) => {
    const ref = `thread:${conversationId}`;
    if (!enabled || !conversationId || !peerId) {
      this.releaseChannel(conversationId, ref);
      return () => {};
    }
    this.requestChannel(conversationId, peerId, ref);
    return () => this.releaseChannel(conversationId, ref);
  };

  private attachForCall(conversationId: string, peerId: string) {
    this.requestChannel(conversationId, peerId, `call:${conversationId}`);
  }

  private releaseCallAttachment() {
    const conversationId = this.state.conversationId;
    if (conversationId) this.releaseChannel(conversationId, `call:${conversationId}`);
  }

  /* ------------------------------------------------------------------ */
  /* Server bookkeeping                                                  */
  /* ------------------------------------------------------------------ */

  /** A call_id for the current attempt: the idempotency key every transition
      is addressed by. Hermes has no crypto.randomUUID; the fallback keeps the
      uuid shape (call_logs.call_id is a uuid column). */
  private mintCallId(): string {
    const rand = () => Math.floor((1 + Math.random()) * 0x100000000).toString(16).slice(1);
    return `${rand()}${rand()}-4${rand().slice(1)}-a${rand().slice(1)}-${rand()}${rand()}${rand()}`;
  }

  /**
   * Report an outcome to the server state machine. `end_call_log` is the ONLY
   * supported transition; a database without the migration falls back to the
   * legacy direct update. The report is retried once, because its loss is the
   * visible bug (an open `answered` row tells the next caller "they're busy").
   */
  private reportOutcome = (
    outcome: "answered" | "declined" | "busy" | "canceled" | "missed" | "completed" | "failed"
  ) => {
    const callId = this.state.callId;
    if (!callId) return;
    if (outcome !== "answered") {
      if (this.finalized) return;
      this.finalized = true;
    }

    const attempt = (retry: boolean) => {
      void Promise.resolve(
        supabase.rpc("end_call_log", { p_call_id: callId, p_outcome: outcome })
      )
        .then(({ error }) => {
          if (!error) return;
          const missing =
            error.code === "PGRST202" || error.code === "42883" || /does not exist/i.test(error.message ?? "");
          if (missing && outcome !== "answered") {
            void Promise.resolve(
              supabase
                .from("call_logs")
                .update({ ended_at: new Date().toISOString(), missed: outcome === "missed" })
                .eq("id", this.callLogId)
            ).catch(() => {});
            return;
          }
          if (retry) {
            setTimeout(() => attempt(false), 1_500);
          }
        })
        .catch(() => {
          if (retry) setTimeout(() => attempt(false), 1_500);
        });
    };
    attempt(true);
  };

  /** Pre-0005 databases only: a bare update against the row id. */
  private legacyFinalize = (missed: boolean) => {
    if (!this.callLogId || this.finalized) return;
    this.finalized = true;
    void Promise.resolve(
      supabase
        .from("call_logs")
        .update({ ended_at: new Date().toISOString(), missed })
        .eq("id", this.callLogId)
    ).catch(() => {});
  };

  /** The one entry point every end/answer/decline uses. */
  private settleCall = (
    outcome: "answered" | "declined" | "busy" | "canceled" | "missed" | "completed" | "failed"
  ) => {
    if (this.state.callId || outcome !== "answered") {
      this.reportOutcome(outcome);
      if (this.state.callId) return;
    }
    if (outcome === "missed") this.legacyFinalize(true);
    else if (outcome === "canceled" || outcome === "completed") this.legacyFinalize(false);
  };

  /* ------------------------------------------------------------------ */
  /* Timers, media, teardown                                             */
  /* ------------------------------------------------------------------ */

  private clearTimers() {
    for (const field of [
      "ringingTimeout",
      "ringExpiryTimeout",
      "iceRestartTimer",
      "iceDisconnectTimer",
      "offerWaitTimer",
      "connectWatchdog",
      "answerRetransmitTimer",
    ] as const) {
      const timer = this[field];
      if (timer) clearTimeout(timer);
      this[field] = null;
    }
    if (this.retransmitTimer) {
      clearInterval(this.retransmitTimer);
      this.retransmitTimer = null;
    }
    if (this.vibrationTimer) {
      clearInterval(this.vibrationTimer);
      this.vibrationTimer = null;
    }
  }

  private stopIncomingVibration() {
    if (this.vibrationTimer) {
      clearInterval(this.vibrationTimer);
      this.vibrationTimer = null;
    }
    try {
      InCallManager.vibrate = false;
    } catch {}
  }

  private startIncomingVibration() {
    this.stopIncomingVibration();
    /* InCallManager's own vibration cadence plus the app's haptics triple
       pulse — felt as much as heard, the same as the web's interval. */
    try {
      InCallManager.vibrate = true;
    } catch {}
    this.vibrationTimer = setInterval(() => {
      try {
        InCallManager.vibrate = true;
      } catch {}
    }, 3_000);
  }

  private stopAudioRouting() {
    try {
      InCallManager.stopProximitySensor();
    } catch {}
    try {
      InCallManager.stop();
    } catch {}
  }

  private startAudioRouting() {
    try {
      InCallManager.start({ media: "audio", auto: true });
      InCallManager.setSpeakerphoneOn(this.state.speakerOn);
      InCallManager.setForceSpeakerphoneOn(this.state.speakerOn);
      InCallManager.startProximitySensor();
    } catch {
      /* Routing is best-effort; the call continues on the default route. */
    }
  }

  /** Media + peer-connection teardown. No signaling, no state change. */
  private teardownMedia() {
    stopRingTone();
    this.stopIncomingVibration();
    this.clearTimers();
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.oniceconnectionstatechange = null;
      this.pc.ontrack = null;
      this.pc.onconnectionstatechange = null;
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    this.stopAudioRouting();
    this.pendingOfferSdp = null;
    this.queuedRemoteCandidates = [];
    this.sentCandidates = [];
    this.callLogId = null;
    this.state.callId = null;
    this.incomingCallId = null;
    this.finalized = false;
    this.answered = false;
    this.connected = false;
    this.answering = false;
    this.awaitingOffer = false;
    this.iceRestarted = false;
    this.state.muted = false;
    this.state.speakerOn = false;
    this.state.startedAt = null;
    this.state.peerName = null;
    this.state.peerAvatar = null;
    this.state.remoteStreamUrl = null;
    this.prewarmedIce = null;
    this.pendingPeerName = null;
    this.pendingPeerAvatar = null;
  }

  private resetState() {
    this.state.direction = null;
    this.state.conversationId = null;
    this.state.peerId = null;
    this.state.callId = null;
    this.state.minimized = false;
    this.state.peerName = null;
    this.state.peerAvatar = null;
    this.setStatus("idle");
  }

  /** Every local ending goes through here. */
  private endLocalCall(releaseAttachment: boolean) {
    stopRingTone();
    this.teardownMedia();
    if (releaseAttachment) this.releaseCallAttachment();
    this.resetState();
  }

  /* ------------------------------------------------------------------ */
  /* The peer connection                                                 */
  /* ------------------------------------------------------------------ */

  /** The call connected. Both sides land here exactly once. */
  private markConnected() {
    if (this.state.status !== "outgoing" && this.state.status !== "connecting") return;
    this.answered = true;
    this.connected = true;
    stopRingTone();
    if (this.connectWatchdog) {
      clearTimeout(this.connectWatchdog);
      this.connectWatchdog = null;
    }
    this.state.startedAt = Date.now();
    this.setStatus("in_call");
  }

  /**
   * "Connecting…" must not be a permanent address. One restart attempt early,
   * one last chance at the deadline; the budget runs from the ANSWER, not the
   * dial — the web module's hard-won timing, kept.
   */
  private armConnectWatchdog() {
    if (this.connectWatchdog) clearTimeout(this.connectWatchdog);
    this.connectWatchdog = setTimeout(() => {
      this.connectWatchdog = null;
      if (this.state.status === "in_call" || this.state.status === "idle") return;
      if (!this.iceRestarted && this.pc) {
        this.iceRestarted = true;
        this.attemptIceRestart(this.pc);
        this.connectWatchdog = setTimeout(() => {
          this.connectWatchdog = null;
          if (this.state.status === "in_call" || this.state.status === "idle") return;
          this.hangUp("We couldn't connect. Check your connection and try again.");
        }, Math.max(5_000, CONNECT_TIMEOUT_MS - CONNECT_RESTART_MS));
        return;
      }
      this.hangUp("We couldn't connect. Check your connection and try again.");
    }, CONNECT_RESTART_MS);
  }

  private attemptIceRestart = (pc: RTCPeerConnection) => {
    if (this.state.status === "idle") return;
    (async () => {
      try {
        const offer = (await pc.createOffer({ iceRestart: true })) as RTCSessionDescription;
        await pc.setLocalDescription(offer);
        /* The restart flag is load-bearing: a mid-call offer from a peer the
           receiver sees as "idle" must not hijack the call. */
        const restartCallId = this.incomingCallId ?? this.state.callId;
        void callSignaling.broadcast(this.state.conversationId ?? "", {
          event: "offer",
          user_id: this.myId ?? "",
          payload: { sdp: offer.sdp, restart: true, callId: restartCallId ?? undefined },
        });
      } catch {
        this.hangUp("Call ended. Check your connection and try again.");
      }
    })();
  };

  private wirePeerConnection(pc: RTCPeerConnection) {
    pc.onicecandidate = (event: { candidate?: NativeCandidateInit | null }) => {
      const candidate = event.candidate as RTCIceCandidateInit | null;
      if (!candidate) return;
      const init: RTCIceCandidateInit = {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      };
      /* Kept as well as sent: a callee that subscribed after our gathering
         finished never saw these, and replaying them on their answer is the
         difference between a call that connects and one stuck connecting. */
      this.sentCandidates.push(init);
      if (!this.state.conversationId || !this.myId) return;
      void callSignaling.broadcast(this.state.conversationId, {
        event: "ice",
        user_id: this.myId,
        payload: { candidate: init },
      });
    };

    pc.ontrack = (event: { track?: import("react-native-webrtc").MediaStreamTrack; streams?: MediaStream[] }) => {
      const stream = (event.streams && event.streams[0]) || null;
      const remote = stream ?? new MediaStream([event.track!]);
      /* React Native only routes remote audio to the hardware when the stream
         is attached to an RTCView; the provider mounts a 1×1 view from this
         handle — the native twin of the web's hidden `<audio autoplay>`. */
      try {
        this.state.remoteStreamUrl = remote.toURL();
        this.publish();
      } catch {}
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      /* "completed" counts as connected: some builds report only `completed`. */
      if (state === "connected" || state === "completed") {
        this.markConnected();
        return;
      }
      if (state === "checking" && this.state.status === "in_call") return;
      if (state === "disconnected" && (this.state.status === "connecting" || this.state.status === "in_call")) {
        if (!this.iceDisconnectTimer) {
          this.iceDisconnectTimer = setTimeout(() => {
            this.iceDisconnectTimer = null;
            if (pc.iceConnectionState === "disconnected" && this.state.status !== "idle") {
              this.attemptIceRestart(pc);
            }
          }, ICE_DISCONNECT_GRACE_MS);
        }
        return;
      }
      if (state === "failed") {
        if (!this.iceRestarted && this.state.status !== "idle") {
          this.iceRestarted = true;
          this.attemptIceRestart(pc);
        } else if (this.state.status !== "idle") {
          this.hangUp("Call ended. Check your connection and try again.");
        }
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        this.markConnected();
        return;
      }
      if (pc.connectionState === "failed" && this.state.status !== "idle") {
        this.hangUp("Call ended. Check your connection and try again.");
      }
    };
  }

  private async acquireMedia(): Promise<MediaStream | null> {
    try {
      /* The native module honours the standard audio constraints even though
         this copy of its MediaTrackConstraints type predates them — the cast
         documents that, the runtime keeps the processing. */
      const stream = (await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      } as never)) as MediaStream;
      return stream;
    } catch {
      this.notice("Microphone unavailable. Check the device's microphone permission and try again.");
      return null;
    }
  }

  private broadcast(signal: Omit<CallSignal, "user_id"> & { payload?: CallSignalPayload | null }) {
    const conversationId = this.state.conversationId;
    const myId = this.myId;
    if (!conversationId || !myId) return;
    void callSignaling.broadcast(conversationId, { ...signal, user_id: myId } as CallSignal);
  }

  /** Hand a late peer every candidate we gathered while they were absent. */
  private replayCandidates() {
    for (const candidate of this.sentCandidates) {
      this.broadcast({ event: "ice", payload: { candidate } });
    }
  }

  /**
   * Re-send the callee's answer while the call is still setting up — backed
   * off (1.5s, 3s, 4.5s) and self-cancelling. A caller that already applied
   * the first answer rejects the duplicate and carries on.
   */
  private retransmitAnswer(pc: RTCPeerConnection, attempt = 1) {
    if (this.answerRetransmitTimer) {
      clearTimeout(this.answerRetransmitTimer);
      this.answerRetransmitTimer = null;
    }
    if (attempt > ANSWER_RETRANSMITS) return;
    this.answerRetransmitTimer = setTimeout(() => {
      this.answerRetransmitTimer = null;
      if (this.state.status !== "connecting" || this.connected) return;
      const sdp = pc.localDescription?.sdp;
      if (!sdp) return;
      this.broadcast({
        event: "answer",
        payload: { sdp, callId: this.incomingCallId ?? undefined },
      });
      this.retransmitAnswer(pc, attempt + 1);
    }, ANSWER_RETRANSMIT_MS * attempt);
  }

  /* ------------------------------------------------------------------ */
  /* Inbound signaling                                                   */
  /* ------------------------------------------------------------------ */

  private handleSignal = (signal: CallSignal, conversationId: string, peerId: string) => {
    if (!signal || signal.user_id !== peerId) return;
    if (this.state.conversationId && this.state.conversationId !== conversationId) return;

    switch (signal.event) {
      case "offer": {
        const sdp = signal.payload?.sdp ?? null;
        const callId = typeof signal.payload?.callId === "string" ? signal.payload.callId : null;

        /* Answered from the global ring before any offer existed: this IS the
           offer we were waiting for — even a `restart` one. */
        if (this.awaitingOffer && this.state.status === "connecting") {
          this.pendingOfferSdp = sdp;
          if (callId) this.incomingCallId = callId;
          void this.answerPendingOffer();
          return;
        }

        if (signal.payload?.restart && (this.state.status === "connecting" || this.state.status === "in_call")) {
          if (!this.belongsToCurrentCall(callId)) return;
          const pc = this.pc;
          if (pc) {
            (async () => {
              try {
                await pc.setRemoteDescription({ type: "offer", sdp: signal.payload!.sdp! });
                const answer = (await pc.createAnswer()) as RTCSessionDescription;
                await pc.setLocalDescription(answer);
                this.broadcast({ event: "answer", payload: { sdp: pc.localDescription?.sdp ?? "" } });
              } catch {
                /* A failed renegotiation is the old path; ICE state decides. */
              }
            })();
          }
          return;
        }

        /* Already ringing: a retransmission refreshes the SDP; a DIFFERENT
           call gets its busy verdict here, from the device itself. */
        if (this.state.status === "incoming") {
          const sameRing = !callId || !this.incomingCallId || callId === this.incomingCallId;
          if (!sameRing) {
            this.broadcast({
              event: "busy",
              payload: callId ? { callId } : null,
            });
            return;
          }
          if (sdp) this.pendingOfferSdp = sdp;
          if (callId && !this.incomingCallId) this.incomingCallId = callId;
          return;
        }

        /* THE PICKUP RACE — a retransmission arriving while Accept's handshake
           is in flight is not a second call. Recognised the same three ways
           the web recognises it; only a genuinely different concurrent call
           reaches the busy verdict below. */
        if (this.state.status === "connecting" || this.state.status === "in_call") {
          const knownCallId = this.incomingCallId ?? this.state.callId;
          const sameCall = callId && knownCallId ? callId === knownCallId : null;
          if (sameCall === true || (sameCall === null && this.pc?.remoteDescription)) {
            return;
          }
        }

        if (this.state.status !== "idle") {
          this.broadcast({
            event: "busy",
            payload: typeof signal.payload?.callId === "string" ? { callId: signal.payload.callId } : null,
          });
          return;
        }

        /* The SDP is kept only if the ring actually started. */
        void this.beginIncomingRing({
          conversationId,
          callerId: peerId,
          callId,
          createdAt: Date.now(),
        }).then((started) => {
          if (started && sdp) this.pendingOfferSdp = sdp;
        });
        return;
      }

      case "answer": {
        const pc = this.pc;
        const answerCallId = typeof signal.payload?.callId === "string" ? signal.payload.callId : null;
        if (!this.belongsToCurrentCall(answerCallId)) return;
        if (pc && (this.state.status === "outgoing" || this.state.status === "connecting")) {
          void pc
            .setRemoteDescription({ type: "answer", sdp: signal.payload?.sdp ?? "" })
            .then(async () => {
              this.answered = true;
              if (this.state.status === "outgoing") {
                stopRingTone();
                this.setStatus("connecting");
              }
              this.armConnectWatchdog();
              this.replayCandidates();
              await this.flushQueuedCandidates(pc);
            })
            .catch(() => {});
        }
        return;
      }

      case "ice": {
        const candidate = signal.payload?.candidate;
        if (!candidate) return;
        const pc = this.pc;
        if (!pc || !pc.remoteDescription) {
          this.queuedRemoteCandidates.push(candidate);
          return;
        }
        void pc.addIceCandidate(candidate as RTCIceCandidateInit).catch(() => {});
        return;
      }

      case "end": {
        const endCallId = typeof signal.payload?.callId === "string" ? signal.payload.callId : null;
        if (!this.belongsToCurrentCall(endCallId)) return;
        const wasConnected = this.connected;
        this.settleCall(wasConnected ? "completed" : this.answered ? "failed" : "canceled");
        this.endLocalCall(true);
        this.notice(wasConnected ? "Call ended." : "Call ended before it connected.");
        return;
      }

      case "busy": {
        const busyCallId = typeof signal.payload?.callId === "string" ? signal.payload.callId : null;
        if (this.state.status !== "outgoing" || !this.belongsToCurrentCall(busyCallId)) return;
        this.settleCall("canceled");
        this.endLocalCall(true);
        this.notice("They're on another call right now.");
        return;
      }

      case "decline": {
        const declineCallId = typeof signal.payload?.callId === "string" ? signal.payload.callId : null;
        if (this.state.status !== "outgoing" || !this.belongsToCurrentCall(declineCallId)) return;
        this.settleCall("canceled");
        this.endLocalCall(true);
        this.notice("Call declined.");
        return;
      }
    }
  };

  private async flushQueuedCandidates(pc: RTCPeerConnection) {
    const queued = this.queuedRemoteCandidates;
    this.queuedRemoteCandidates = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate as RTCIceCandidateInit);
      } catch {
        /* One bad candidate is not a dead call; ICE keeps the rest. */
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Inbound call                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * A ring, from anywhere: the live offer on an attached thread, a
   * `notifications` row landing while the app is open, or a push tap.
   * Idempotent by call_id. A ring with no row of its own is verified against
   * the server before it takes the screen.
   */
  async beginIncomingRing(ring: IncomingRing): Promise<boolean> {
    if (!ring.conversationId || !ring.callerId) return false;
    if (typeof ring.createdAt === "number" && Date.now() - ring.createdAt > RING_WINDOW_MS) return false;

    if (ring.callId && !ring.rowId) {
      const { data: row } = await supabase
        .from("call_logs")
        .select("status,started_at")
        .eq("call_id", ring.callId)
        .maybeSingle();
      if (!row) return false;
      const rowStatus = (row as { status?: string; started_at?: string }).status;
      if (TERMINAL_CALL_STATUSES.has(rowStatus as string)) return false;
      if (rowStatus === "ringing") {
        const startedAt: string | undefined = (row as { started_at?: string }).started_at;
        const startedMs = typeof startedAt === "string" ? Date.parse(startedAt) : NaN;
        if (Number.isFinite(startedMs) && Date.now() - startedMs > RING_WINDOW_MS) return false;
      }
    }

    if (ring.callerName) this.pendingPeerName = ring.callerName;
    if (ring.callerAvatar) this.pendingPeerAvatar = ring.callerAvatar;
    /* Pre-warm ICE servers so accept() doesn't wait on network. */
    if (!this.prewarmedIce) {
      this.prewarmedIce = getIceServers().catch(() => []);
    }

    const current = this.state;
    if (current.status !== "idle") {
      /* Same call, second delivery: keep ringing, take the id if we had none. */
      if (
        current.status === "incoming" &&
        current.conversationId === ring.conversationId &&
        ((!current.callId && ring.callId) || current.callId === ring.callId)
      ) {
        if (!current.callId) {
          this.state.callId = ring.callId;
          this.incomingCallId = ring.callId;
          this.publish();
        }
        return true;
      }
      return false;
    }

    this.state.conversationId = ring.conversationId;
    this.state.peerId = ring.callerId;
    this.state.direction = "incoming";
    this.state.callId = ring.callId;
    this.incomingCallId = ring.callId;
    this.state.peerName = ring.callerName ?? this.pendingPeerName ?? null;
    this.state.peerAvatar = ring.callerAvatar ?? this.pendingPeerAvatar ?? null;
    this.state.minimized = false;
    this.attachForCall(ring.conversationId, ring.callerId);
    this.setStatus("incoming");
    startRingTone();
    this.startIncomingVibration();

    /* The server expires a ring at 60s even if this device dies; the overlay
       should not outlive the row it came from. */
    const elapsed = typeof ring.createdAt === "number" ? Date.now() - ring.createdAt : 0;
    this.ringExpiryTimeout = setTimeout(() => {
      if (this.state.status !== "incoming") return;
      this.endLocalCall(true);
      this.notice("Missed call.");
    }, Math.max(0, RING_WINDOW_MS - elapsed));
    return true;
  }

  /** Stand the ring down because its row is gone — silent on purpose. */
  cancelRing = (callId: string | null) => {
    if (this.state.status !== "incoming") return;
    /* The user has already pressed Accept and media is still being set up:
       this ring is no longer the caller's to withdraw. */
    if (this.answering) return;
    if (callId && this.state.callId && this.state.callId !== callId) return;
    this.endLocalCall(true);
  };

  /**
   * Accept. On the chat screen the offer is already in hand and the answer
   * goes out immediately; anywhere else the ring came from a notification
   * row, the media comes up, and the caller's retransmitted offer — within
   * ~2s — is what gets answered.
   */
  accept = async () => {
    if (this.state.status !== "incoming") return;
    /* Double-tap must not build a second peer connection under the first. */
    if (this.answering) return;
    this.answering = true;
    stopRingTone();
    this.stopIncomingVibration();
    if (this.ringExpiryTimeout) {
      clearTimeout(this.ringExpiryTimeout);
      this.ringExpiryTimeout = null;
    }

    const stream = await this.acquireMedia();
    if (!stream) {
      /* Decline by failing: tell the caller, and drop back to idle. */
      this.answering = false;
      this.broadcast({ event: "decline" });
      this.settleCall("declined");
      this.endLocalCall(true);
      return;
    }

    const iceServers = await (this.prewarmedIce ?? getIceServers());
    this.prewarmedIce = null;

    /* The waits above are long: the mic prompt can sit on screen for seconds,
       and the ring can end under it. */
    if (this.isIdle()) {
      stream.getTracks().forEach((track) => track.stop());
      this.answering = false;
      return;
    }

    const pc = new RTCPeerConnection({
      iceServers: iceServers as never,
      iceCandidatePoolSize: 2,
    });
    this.pc = pc;
    this.localStream = stream;
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
    this.wirePeerConnection(pc);
    this.startAudioRouting();

    /* Answering collapses the full-screen ring into the pill. */
    this.state.minimized = true;
    /* ANSWERED, from this instant — not from when the answer signal returns.
       See the web module for the two bugs this killed. */
    this.answered = true;
    this.setStatus("connecting");

    if (this.pendingOfferSdp) {
      await this.answerPendingOffer();
      return;
    }

    this.awaitingOffer = true;
    if (this.state.conversationId && this.state.peerId) {
      this.attachForCall(this.state.conversationId, this.state.peerId);
    }
    this.offerWaitTimer = setTimeout(() => {
      if (!this.awaitingOffer) return;
      this.awaitingOffer = false;
      /* This person picked up and no offer ever arrived: the row already says
         `answered`, so the honest ending is FAILED, not CANCELED. */
      this.settleCall(this.connected ? "completed" : "failed");
      this.broadcast({ event: "end" });
      this.endLocalCall(true);
      this.notice("The call ended before it connected.");
    }, OFFER_WAIT_MS);
  };

  /** The callee's answer, from whichever path delivered the offer. */
  private async answerPendingOffer() {
    const pc = this.pc;
    const sdp = this.pendingOfferSdp;
    if (!pc || !sdp) return;
    this.awaitingOffer = false;
    if (this.offerWaitTimer) {
      clearTimeout(this.offerWaitTimer);
      this.offerWaitTimer = null;
    }

    try {
      await pc.setRemoteDescription({ type: "offer", sdp });
      const answer = (await pc.createAnswer()) as RTCSessionDescription;
      await pc.setLocalDescription(answer);
    } catch {
      this.settleCall("declined");
      this.broadcast({ event: "decline" });
      this.endLocalCall(true);
      this.notice("Couldn't start the call.");
      return;
    }

    this.broadcast({
      event: "answer",
      payload: { sdp: pc.localDescription?.sdp ?? "", callId: this.incomingCallId ?? undefined },
    });
    this.retransmitAnswer(pc);
    this.replayCandidates();
    await this.flushQueuedCandidates(pc);
    this.armConnectWatchdog();

    /* Answering is a server transition, not just a media state: it closes the
       callee's "ringing" leg, marks the incoming-call notification read, and
       cancels the ringing banner on every device this person owns. A PUSH
       NEVER AUTHORIZES THE CALL — end_call_log re-checks the recipient. */
    if (this.incomingCallId) {
      const prior = this.state.callId;
      this.state.callId = this.incomingCallId;
      this.reportOutcome("answered");
      this.state.callId = prior ?? this.incomingCallId;
      this.publish();
      this.finalized = false; // the call is now LIVE; its end still has to be reported
    }
  }

  decline = () => {
    if (this.state.status !== "incoming") return;
    stopRingTone();
    this.stopIncomingVibration();
    this.broadcast({
      event: "decline",
      payload: this.incomingCallId ? { callId: this.incomingCallId } : null,
    });
    /* Declined is its own outcome, never a miss. */
    if (this.incomingCallId) {
      if (!this.state.callId) this.state.callId = this.incomingCallId;
      this.reportOutcome("declined");
    }
    this.endLocalCall(true);
  };

  /* ------------------------------------------------------------------ */
  /* Outbound call                                                       */
  /* ------------------------------------------------------------------ */

  startCall = async ({ conversationId, peerId }: { conversationId: string; peerId: string }) => {
    if (!this.myId || !conversationId || !peerId) return;
    if (this.state.status !== "idle") return;

    /* Reserve the call with the SERVER first (start_call_log): identity/
       friendship/block checks happen before any microphone opens, the row
       exists before the offer is broadcast, and the busy verdict comes from
       the same query. On a pre-0005 database the RPC is missing; fall through
       to the legacy table insert so the app never loses calls to a pending
       migration. */
    const callId = this.mintCallId();
    let serverBusy = false;
    let legacyInsert = false;
    try {
      const { data, error } = await supabase.rpc("start_call_log", {
        p_call_id: callId,
        p_conversation_id: conversationId,
        p_force_clear_stale: true,
      });
      if (error) {
        legacyInsert =
          error.code === "PGRST202" ||
          error.code === "42883" ||
          /does not exist/i.test(error.message ?? "");
        if (!legacyInsert) {
          this.notice(error.message || "Couldn't start the call.");
          return;
        }
      } else {
        const receipt = (data ?? {}) as { status?: string; id?: string };
        if (receipt.status === "busy") {
          serverBusy = true;
        } else {
          this.state.callId = callId;
          this.callLogId = receipt.id ?? null;
        }
      }
    } catch {
      legacyInsert = true;
    }
    if (serverBusy) {
      this.notice("They're on another call right now.");
      return;
    }

    this.state.conversationId = conversationId;
    this.state.peerId = peerId;
    this.state.direction = "outgoing";
    this.state.minimized = false;
    this.attachForCall(conversationId, peerId);

    /* Ringing starts BEFORE the microphone is opened — the permission prompt
       is a tap the user may take seconds to make, and the callee was not
       being called yet anyway. */
    this.answered = false;
    this.setStatus("outgoing");
    startRingTone();

    const stream = await this.acquireMedia();
    if (!stream) {
      /* Mic refused AFTER the server accepted: close the ringing row. */
      stopRingTone();
      this.settleCall("canceled");
      this.endLocalCall(true);
      return;
    }

    const iceServers = await getIceServers();

    /* A STUN-only dial is a coin flip on carrier networks — say so while the
       ring is still going, not after 25 seconds of "Connecting…". */
    if (!iceServers.some((server) => String(server.urls ?? "").includes("turn:"))) {
      this.notice(
        "No call relay is configured on this server, so this call may not connect across different networks."
      );
    }

    /* The sheet is on screen from the first ring, so End is tappable while
       the mic prompt is up. */
    if (this.isIdle()) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const pc = new RTCPeerConnection({
      iceServers: iceServers as never,
      iceCandidatePoolSize: 2,
    });
    this.pc = pc;
    this.localStream = stream;
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
    this.wirePeerConnection(pc);
    this.startAudioRouting();

    /* The clock runs from the first ring, not from the permission tap. */
    if (this.ringingTimeout) clearTimeout(this.ringingTimeout);
    this.ringingTimeout = setTimeout(() => {
      if (this.state.status === "outgoing") this.hangUp(null, "timeout");
    }, OUTGOING_TIMEOUT_MS);

    let offerSdp = "";
    try {
      const offer = (await pc.createOffer()) as RTCSessionDescription;
      await pc.setLocalDescription(offer);
      offerSdp = pc.localDescription?.sdp ?? "";
    } catch {
      this.settleCall("canceled");
      this.endLocalCall(true);
      this.notice("Couldn't start the call.");
      return;
    }

    /* The call_id rides the offer so the callee can finalize THE SAME row. */
    this.broadcast({
      event: "offer",
      payload: { sdp: offerSdp, callId: legacyInsert ? undefined : callId },
    });

    /* And then it keeps riding it: a callee who is not on this chat screen is
       not subscribed to this topic yet. */
    this.retransmitTimer = setInterval(() => {
      if (this.retransmitTimer && this.state.status !== "outgoing") {
        clearInterval(this.retransmitTimer);
        this.retransmitTimer = null;
        return;
      }
      /* As soon as the peer's answer is applied the signaling state leaves
         `have-local-offer`, and re-sending past that point is what reaches a
         callee who has just accepted and makes them answer busy to the call
         they are already in. */
      if (pc.signalingState !== "have-local-offer") {
        if (this.retransmitTimer) clearInterval(this.retransmitTimer);
        this.retransmitTimer = null;
        return;
      }
      this.broadcast({
        event: "offer",
        payload: { sdp: pc.localDescription?.sdp ?? offerSdp, callId: legacyInsert ? undefined : callId },
      });
    }, OFFER_RETRANSMIT_MS);

    if (legacyInsert) {
      void Promise.resolve(
        supabase
          .from("call_logs")
          .insert({
            conversation_id: conversationId,
            caller_id: this.myId,
            callee_id: peerId,
          })
          .select("id")
      )
        .then(({ data }) => {
          this.callLogId = (data?.[0] as { id?: string } | undefined)?.id ?? null;
        })
        .catch(() => {});
    }
  };

  /* ------------------------------------------------------------------ */
  /* Controls                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * The app came back to the foreground. A backgrounded native app can kill
   * the transport without a final state change, exactly like a paused
   * WebView — judge the pipe before the pill keeps counting over a ghost.
   */
  checkHealth = () => {
    if (this.state.status !== "in_call" && this.state.status !== "connecting") return;
    const pc = this.pc;
    if (!pc) return;
    if (pc.connectionState === "failed" || pc.iceConnectionState === "failed") {
      this.hangUp("Call ended.");
      return;
    }
    if (pc.iceConnectionState === "disconnected" && !this.iceDisconnectTimer) {
      this.iceDisconnectTimer = setTimeout(() => {
        this.iceDisconnectTimer = null;
        if (pc.iceConnectionState === "disconnected" && this.state.status !== "idle") {
          this.attemptIceRestart(pc);
        }
      }, ICE_DISCONNECT_GRACE_MS);
    }
  };

  /**
   * The local-side hangup. A 45-second give-up is MISSED; hanging up first is
   * CANCELED; picked-up-but-never-carried-media is FAILED — the outcome keys
   * on `connected`, not `answered`.
   */
  hangUp = (notify: string | null = "Call ended.", reason: "timeout" | "user" = "user") => {
    if (this.state.status === "idle") return;
    const outcome: "completed" | "failed" | "missed" | "canceled" = this.connected
      ? "completed"
      : this.answered
        ? "failed"
        : reason === "timeout" && this.state.status === "outgoing"
          ? "missed"
          : "canceled";
    this.settleCall(outcome);
    this.broadcast({
      event: "end",
      payload: this.state.callId ? { callId: this.state.callId } : null,
    });
    this.endLocalCall(true);
    if (notify) this.notice(notify);
  };

  toggleMute = () => {
    const stream = this.localStream;
    if (!stream || this.state.status === "idle") return;
    const nextEnabled = this.state.muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = nextEnabled;
    });
    this.state.muted = !nextEnabled;
    this.publish();
  };

  /** Earpiece ⇄ speaker, through the OS audio session. */
  toggleSpeaker = async () => {
    const next = !this.state.speakerOn;
    try {
      InCallManager.setSpeakerphoneOn(next);
      InCallManager.setForceSpeakerphoneOn(next);
    } catch {
      /* Routing refused: the call continues on whatever output it had. A
         speaker toggle must never kill a live call. */
      return;
    }
    this.state.speakerOn = next;
    this.publish();
  };

  /** Collapse into the top pill, or expand back over the screen. */
  setMinimized = (minimized: boolean) => {
    if (this.state.status === "idle" || this.state.minimized === minimized) return;
    this.state.minimized = minimized;
    this.publish();
  };

  /**
   * Force-clear phantom ringing/answered rows for the current user — called
   * on app resume while idle. The RPC cancels EVERY non-terminal row the user
   * is part of; without it, backgrounding the app mid-ring leaves a row the
   * next startCall reads as busy.
   */
  forceClearPhantom = async () => {
    const uid = this.myId;
    if (!uid) return;
    if (this.state.status !== "idle") return;
    try {
      await supabase.rpc("force_clear_my_calls", { p_user_id: uid });
    } catch {}
  };
}

export const callSession = new CallSession();
