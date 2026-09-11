"use client";

import { callSignaling, type CallSignal } from "./signaling";
import { getIceServers } from "./iceServers";
import { startRingTone, stopRingTone } from "./ringTone";
import { requireOnline } from "@/lib/offline";
import { vibrate, HAPTIC } from "@/lib/haptics";
import { supabase } from "@/lib/supabase/client";

/**
 * The 1:1 voice call — one engine, owned by nobody in particular.
 *
 * WHY THIS IS A MODULE AND NOT A HOOK
 *
 * It used to be `useVoiceCall`, called by the chat page. That was the wrong
 * owner: a hook's life is its component's life, so the call died the moment the
 * user navigated — and a call that cannot survive leaving the chat screen also
 * cannot be *answered* anywhere else, because answering means holding the peer
 * connection while the chat page is not mounted. The incoming-call overlay that
 * used to appear on the dashboard therefore had no honest accept path: it
 * navigated to the chat page and hoped the offer was still in the air.
 *
 * So the call moved out here: a framework-free state machine, instantiated once,
 * mirrored into React through `subscribe`/`getSnapshot`. The provider in
 * components/calls/CallSessionProvider.tsx renders its surfaces; the chat page
 * only starts calls and reads state. Navigating away is now a view change, not a
 * hang-up — the call keeps running behind the minimized pill.
 *
 * MEDIA PATH
 *
 * The Opus audio flows device-to-device over WebRTC. Nothing about it — no
 * frame, no chunk, no recording — ever touches Supabase or Cloudinary. What
 * crosses the realtime channel is the handshake (SDP, ICE, and the four control
 * words), and what crosses Postgres is a single log row (started/ended/missed).
 * That separation is the product promise: "no call recording" is true because
 * there is nowhere to record to.
 *
 * ANSWERING FROM ANYWHERE (the part that needed new signaling)
 *
 * A broadcast is not a queue: a callee who is on the dashboard when the call
 * starts is not subscribed to the conversation's call topic, so the one offer
 * the caller sent is gone by the time they tap Accept. Two changes close that
 * gap, both on the caller side:
 *
 *   1. the offer is RE-BROADCAST every `OFFER_RETRANSMIT_MS` while the call is
 *      ringing. A late callee answers the freshest copy, within one interval.
 *   2. the caller's ICE candidates are BUFFERED and replayed the moment an
 *      answer lands, because a callee who subscribed late missed them all —
 *      which is exactly the "Connecting…" that never became a call.
 *
 * The callee side matches: an offer that arrives while already ringing is a
 * retransmission, not a second call, so it refreshes the pending SDP instead of
 * answering "busy" to itself.
 *
 * ALL MUTABLE STATE LIVES ON THE INSTANCE
 *
 * Signaling and ICE events arrive asynchronously, often several in one tick.
 * Every handler reads status from `this.state` synchronously — never from a
 * closure captured a render ago, which is how a busy call used to be able to
 * answer its own renegotiation. React sees an immutable snapshot per change.
 */

export type CallStatus = "idle" | "outgoing" | "incoming" | "connecting" | "in_call";

/** What the UI renders from. Immutable between publishes. */
export type CallSnapshot = {
  status: CallStatus;
  /** Which side we are on, or null while idle. */
  direction: "incoming" | "outgoing" | null;
  conversationId: string | null;
  peerId: string | null;
  /** call_logs.call_id of the current attempt; every server transition keys on it. */
  callId: string | null;
  /** ms epoch the call connected, for the duration readout. */
  startedAt: number | null;
  muted: boolean;
  speakerSupported: boolean;
  speakerOn: boolean;
  /** Collapsed into the floating top pill instead of taking the screen. */
  minimized: boolean;
};

/** A ring handed over from a `notifications` row or a push tap. */
export type IncomingRing = {
  conversationId: string;
  callerId: string;
  callId: string | null;
  /** ms epoch, from the row. Used to keep a stale ring from taking the screen. */
  createdAt?: number;
};

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
/** How long "Connecting…" may last before ICE is restarted, then abandoned. */
const CONNECT_TIMEOUT_MS = 15_000;

const IDLE: CallSnapshot = {
  status: "idle",
  direction: null,
  conversationId: null,
  peerId: null,
  callId: null,
  startedAt: null,
  muted: false,
  speakerSupported: false,
  speakerOn: false,
  minimized: false,
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
  private remoteAudio: HTMLAudioElement | null = null;
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
  /** Set when Accept was pressed before any offer arrived. */
  private awaitingOffer = false;
  private iceRestarted = false;

  private ringingTimeout: ReturnType<typeof setTimeout> | null = null;
  private ringExpiryTimeout: ReturnType<typeof setTimeout> | null = null;
  private vibrationTimer: ReturnType<typeof setInterval> | null = null;
  private iceRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private retransmitTimer: ReturnType<typeof setInterval> | null = null;
  private offerWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private connectWatchdog: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    /* setSinkId (output-device switching) is desktop-Chrome-only; mobile
       WebViews route WebRTC audio through the OS audio session and expose no
       web API for it. The call surfaces hide the speaker button when this is
       false rather than show one that cannot do its job. */
    this.state.speakerSupported =
      typeof window !== "undefined" &&
      typeof HTMLMediaElement !== "undefined" &&
      "setSinkId" in HTMLMediaElement.prototype;
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
      /* Signed out mid-call: there is nobody to bill the row to and no channel
         authorization left, so the call ends locally and quietly. */
      this.teardownMedia();
      this.releaseCallAttachment();
      this.resetState();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Conversation attachments                                            */
  /* ------------------------------------------------------------------ */

  /**
   * The conversations this device wants a call channel for, by reason.
   *
   * Two reasons, independently: `thread:<id>` is the chat page saying "I am
   * looking at this thread, it can ring", and `call:<id>` is a live call or ring
   * that must keep its handshake channel even after the user navigates away
   * from the thread that started it. A conversation stays attached while
   * anything still wants it.
   */
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
   * Reconcile the open channels with what is wanted right now.
   *
   * Declarative rather than attach/detach pairs because the identity arrives
   * asynchronously: the chat page registers its thread on mount, which is often
   * BEFORE `supabase.auth.getSession()` has answered, and an imperative attach
   * at that moment would silently open nothing — the user would then never hear
   * a ring on the very screen the call is for. Every input (a thread mounting, a
   * call starting, the session resolving) simply re-runs this.
   */
  private syncChannels() {
    if (!this.myId) {
      /* No session, no authorization to any topic. The requests stay on the
         list; the moment the identity lands this runs again and opens them. */
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

    /* Stale-ring convergence (server-side, not timer-side): call_logs is in
       the realtime publication and readable by participants, so when ANY
       device of either party settles the row — answered elsewhere, declined,
       or the expiry sweep closed it — every surface here stands down too.
       Without it, the overlay on the other device would offer "Accept" for a
       call that no longer exists. */
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
            this.dismissIncomingAlerts();
            /* Only an un-answered leg is torn down by a remote finalization;
               a live call (answered) keeps running no matter what the log
               says — its own media/ICE state decides when it ends. */
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

  /** The chat page's hook-in: "I am looking at this thread, it can ring." */
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
      (`answered`, `declined`, `missed`, …) is addressed by. */
  private mintCallId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    /* Entropy-free fallback for ancient WebViews; uniqueness only needs to be
       good enough that one person's two attempts differ, and `uuid` type means
       the shape must parse. */
    const rand = () => Math.floor((1 + Math.random()) * 0x100000000).toString(16).slice(1);
    return `${rand()}${rand()}-${rand()}-4${rand().slice(1)}-a${rand().slice(1)}-${rand()}${rand()}${rand()}`;
  }

  /**
   * Report an outcome to the server state machine (202609100006).
   *
   * `end_call_log` is the ONLY supported transition: it re-checks identity,
   * rejects illegal moves (a row already answered on another device cannot be
   * "declined" again) and fires missed-call notification/cancellation from
   * inside the same transaction. An illegal transition returns
   * `{ignored:true}` rather than an error — the machine working, not a fault.
   *
   * A database without the migration falls back to the legacy direct update
   * (one-shot, exactly like the old finalizeCallLog) so an un-migrated server
   * keeps the pre-0005 behavior instead of losing call bookkeeping entirely.
   */
  private reportOutcome = (
    outcome: "answered" | "declined" | "busy" | "canceled" | "missed" | "completed"
  ) => {
    const callId = this.state.callId;
    if (!callId) return;
    if (outcome !== "answered") {
      if (this.finalized) return;
      this.finalized = true;
    }
    void Promise.resolve(supabase.rpc("end_call_log", { p_call_id: callId, p_outcome: outcome }))
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
        /* Anything else (a rejected transition, a transient error) is not
           worth the user's attention: the server sweep and the other side's
           own transition converge the row; a notification that cannot ride a
           dead network is a missed notification, not a broken call. */
      })
      .catch(() => {});
  };

  /** Pre-0005 databases only: a bare update against the row id, kept as the
      degraded path so an un-migrated server still records call ends the way it
      always did. With the migration applied, `reportOutcome` never reaches it
      (the RPC exists), and rows are keyed by call_id instead. */
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

  /** The one entry point every end/answer/decline uses: the server transition
      table when it exists, the legacy update when the RPC is missing. */
  private settleCall = (
    outcome: "answered" | "declined" | "busy" | "canceled" | "missed" | "completed"
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
      "offerWaitTimer",
      "connectWatchdog",
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
  }

  private startIncomingVibration() {
    this.stopIncomingVibration();
    /* A triple pulse now, then on a 3s cadence for the life of the ring —
       the haptics module applies the user's vibration setting and the
       native/web fallback. Felt as much as heard. */
    vibrate([300, 250, 300]);
    this.vibrationTimer = setInterval(() => vibrate([300, 250, 300]), 3_000);
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
      this.pc.close();
      this.pc = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
      this.remoteAudio = null;
    }
    this.pendingOfferSdp = null;
    this.queuedRemoteCandidates = [];
    this.sentCandidates = [];
    this.callLogId = null;
    this.state.callId = null;
    this.incomingCallId = null;
    this.finalized = false;
    this.answered = false;
    this.awaitingOffer = false;
    this.iceRestarted = false;
    this.state.muted = false;
    this.state.speakerOn = false;
    this.state.startedAt = null;
  }

  private resetState() {
    this.state.direction = null;
    this.state.conversationId = null;
    this.state.peerId = null;
    this.state.callId = null;
    this.state.minimized = false;
    this.setStatus("idle");
  }

  /**
   * Every local ending goes through here: tear the media down, tell nobody
   * (the caller does that), release the call's channel and drop to idle.
   */
  private endLocalCall(releaseAttachment: boolean) {
    stopRingTone();
    this.teardownMedia();
    if (releaseAttachment) this.releaseCallAttachment();
    this.resetState();
  }

  /** Retire any system-level "Incoming call" banner this browser still shows
      (web push path: the notification is tagged `call-<callId>` by the
      service worker). The server fires the FCM-side cancel for native
      devices; this covers the web, where no FCM is involved and the tab that
      received the push is the only place a stale banner could linger. */
  private dismissIncomingAlerts() {
    const callId = this.incomingCallId;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.ready
      .then((registration) => {
        registration.active?.postMessage({
          type: "dismiss-notifications",
          tags: [callId ? `call-${callId}` : null].filter(Boolean),
        });
      })
      .catch(() => {});
  }

  /* ------------------------------------------------------------------ */
  /* The peer connection                                                 */
  /* ------------------------------------------------------------------ */

  private ensureRemoteAudio(): HTMLAudioElement {
    if (!this.remoteAudio) {
      const el = new Audio();
      el.autoplay = true;
      /* `playsInline` is honoured by the mobile WebViews and absent from
         some TS DOM lib versions — set it through a cast so the runtime
         behaviour is kept without depending on the type definition. */
      (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      this.remoteAudio = el;
    }
    return this.remoteAudio;
  }

  /** The call connected. Both sides land here exactly once. */
  private markConnected() {
    if (this.state.status !== "outgoing" && this.state.status !== "connecting") return;
    this.answered = true;
    stopRingTone();
    if (this.connectWatchdog) {
      clearTimeout(this.connectWatchdog);
      this.connectWatchdog = null;
    }
    this.state.startedAt = Date.now();
    this.setStatus("in_call");
    vibrate(HAPTIC.success);
  }

  /**
   * "Connecting…" must not be a permanent address.
   *
   * ICE fails quietly on symmetric NATs with no usable TURN, and the only
   * symptom is a spinner — which is precisely the bug this replaced. One
   * restart attempt at the first timeout, and if that does not rescue it the
   * call ends with a sentence instead of hanging there until the user gives up.
   */
  private armConnectWatchdog() {
    if (this.connectWatchdog) clearTimeout(this.connectWatchdog);
    this.connectWatchdog = setTimeout(() => {
      this.connectWatchdog = null;
      if (this.state.status === "in_call" || this.state.status === "idle") return;
      if (!this.iceRestarted && this.pc) {
        this.iceRestarted = true;
        this.attemptIceRestart(this.pc);
        this.armConnectWatchdog();
        return;
      }
      this.hangUp("We couldn't connect. Check your connection and try again.");
    }, CONNECT_TIMEOUT_MS);
  }

  private attemptIceRestart = (pc: RTCPeerConnection) => {
    if (this.state.status === "idle") return;
    (async () => {
      try {
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        /* The restart flag is load-bearing: a mid-call offer from a peer
           the receiver sees as "idle" must not hijack the call (see
           signaling). */
        void callSignaling.broadcast(this.state.conversationId ?? "", {
          event: "offer",
          user_id: this.myId ?? "",
          payload: { sdp: offer.sdp, restart: true },
        });
      } catch {
        this.hangUp("Call ended. Check your connection and try again.");
      }
    })();
  };

  private wirePeerConnection(pc: RTCPeerConnection) {
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const candidate = event.candidate.toJSON();
      /* Kept as well as sent. A callee that subscribed after our gathering
         finished never saw these, and re-sending them when their answer
         arrives is the difference between a call that connects and one that
         sits on "Connecting…" until someone hangs up. */
      this.sentCandidates.push(candidate);
      if (!this.state.conversationId || !this.myId) return;
      void callSignaling.broadcast(this.state.conversationId, {
        event: "ice",
        user_id: this.myId,
        payload: { candidate },
      });
    };

    pc.ontrack = (event) => {
      const audio = this.ensureRemoteAudio();
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio.play().catch(() => {
        /* Autoplay blocked: the user is looking at a call surface and has
           their finger on the screen — any tap resumes the context. */
      });
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      /* "completed" counts as connected. Chrome reports `connected` then
         `completed` once every pair is checked, and some builds — Firefox on
         some networks, the Android WebView among them — report only
         `completed`. Waiting for the word "connected" alone is how a working
         call stayed stuck on "Connecting…". */
      if (state === "connected" || state === "completed") {
        this.markConnected();
        return;
      }
      if (state === "disconnected" && (this.state.status === "connecting" || this.state.status === "in_call")) {
        /* A momentary "disconnected" usually heals on its own; give it the
           grace, then restart ICE rather than strand the call. */
        if (!this.iceRestartTimer) {
          this.iceRestartTimer = setTimeout(() => {
            this.iceRestartTimer = null;
            if (pc.iceConnectionState === "disconnected" && this.state.status !== "idle") {
              this.attemptIceRestart(pc);
            }
          }, ICE_DISCONNECT_GRACE_MS);
        }
        return;
      }
      if (state === "failed") {
        this.attemptIceRestart(pc);
      }
    };

    pc.onconnectionstatechange = () => {
      /* The aggregate state is the second opinion: a transport that reaches
         `connected` did so even if the ICE event was missed. */
      if (pc.connectionState === "connected") {
        this.markConnected();
        return;
      }
      if (pc.connectionState === "failed" && this.state.status !== "idle") {
        /* ICE restart ran and did not save it: end cleanly, with the log
           row closed, instead of leaving both sides ringing forever. */
        this.hangUp("Call ended. Check your connection and try again.");
      }
    };
  }

  private async acquireMedia(): Promise<MediaStream | null> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      this.notice("Microphone unavailable. Check the device's microphone permission and try again.");
      return null;
    }
  }

  private broadcast(signal: Omit<CallSignal, "user_id"> & { payload?: CallSignal["payload"] }) {
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

        if (
          signal.payload?.restart &&
          (this.state.status === "connecting" || this.state.status === "in_call")
        ) {
          const pc = this.pc;
          if (pc) {
            (async () => {
              try {
                await pc.setRemoteDescription({ type: "offer", sdp: signal.payload!.sdp! });
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this.broadcast({ event: "answer", payload: { sdp: pc.localDescription?.sdp ?? "" } });
              } catch {
                /* A failed renegotiation is the old path; the next ICE
                   state will either heal it or end the call. */
              }
            })();
          }
          return;
        }

        /* Answered from the global ring before any offer existed: this IS the
           offer we were waiting for. */
        if (this.awaitingOffer && this.state.status === "connecting") {
          this.pendingOfferSdp = sdp;
          if (callId) this.incomingCallId = callId;
          void this.answerPendingOffer();
          return;
        }

        /* Already ringing for this call: the caller's retransmission. Refresh
           the SDP (the newest one has the fullest candidate list) and keep
           ringing — treating it as a second call would answer "busy" to the
           one call we are actually ringing for. */
        if (this.state.status === "incoming") {
          if (sdp) this.pendingOfferSdp = sdp;
          if (callId && !this.incomingCallId) this.incomingCallId = callId;
          return;
        }

        if (this.state.status !== "idle") {
          this.broadcast({
            event: "busy",
            payload: typeof signal.payload?.callId === "string" ? { callId: signal.payload.callId } : null,
          });
          return;
        }

        this.beginIncomingRing({
          conversationId,
          callerId: peerId,
          callId,
          createdAt: Date.now(),
        });
        this.pendingOfferSdp = sdp;
        return;
      }

      case "answer": {
        const pc = this.pc;
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
              /* They subscribed late, so they missed our gathering. */
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
          /* Arrived ahead of the handshake. Dropping it costs a slow start or
             a failed connect, so it waits in a queue that is flushed the
             moment the remote description is set. */
          this.queuedRemoteCandidates.push(candidate);
          return;
        }
        void pc.addIceCandidate(candidate).catch(() => {});
        return;
      }

      case "end": {
        /* The other side hung up. A live call completes; an unanswered one
           the peer walked away from is recorded CANCELED by whoever reaches
           the server first (the transition table drops the loser's write),
           never MISSED — "they left" is not "they missed it". */
        this.settleCall(this.answered ? "completed" : "canceled");
        /* A callee receiving `end` while still ringing: the system banner is
           retired from the same place the server retires it (data-only FCM
           via notify-on-notification), but a browser without a service
           worker still needs the local close. */
        if (this.state.status === "incoming") this.dismissIncomingAlerts();
        this.endLocalCall(true);
        this.notice("Call ended.");
        return;
      }

      case "busy": {
        /* Busy is not missed: the callee's device answered the signaling by
           refusing it. Record the attempt, skip the missed alert. */
        this.settleCall("canceled");
        this.endLocalCall(true);
        this.notice("They're on another call right now.");
        return;
      }

      case "decline": {
        /* Declined ≠ missed. The callee's own `declined` (0005) writes the
           row when it can; this caller-side call covers legacy peers, and is
           ignored when the row is already final either way. */
        this.settleCall("canceled");
        if (this.state.status === "incoming") this.dismissIncomingAlerts();
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
        await pc.addIceCandidate(candidate);
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
   *
   * Idempotent by call_id, because the same call routinely arrives twice —
   * the offer over broadcast and the row over postgres_changes — and a ring
   * that restarts its own tone halfway through is a bug people hear.
   */
  beginIncomingRing(ring: IncomingRing) {
    if (!ring.conversationId || !ring.callerId) return;
    if (typeof ring.createdAt === "number" && Date.now() - ring.createdAt > RING_WINDOW_MS) return;

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
        return;
      }
      /* A different call, while one is already ringing or live. The server's
         busy check is what tells the other side; nothing to render here. */
      return;
    }

    this.state.conversationId = ring.conversationId;
    this.state.peerId = ring.callerId;
    this.state.direction = "incoming";
    this.state.callId = ring.callId;
    this.incomingCallId = ring.callId;
    this.state.minimized = false;
    this.attachForCall(ring.conversationId, ring.callerId);
    this.setStatus("incoming");
    startRingTone();
    this.startIncomingVibration();

    /* The server expires a ring at 60s even if this tab dies; the overlay
       should not outlive the row it came from. */
    const elapsed = typeof ring.createdAt === "number" ? Date.now() - ring.createdAt : 0;
    this.ringExpiryTimeout = setTimeout(() => {
      if (this.state.status !== "incoming") return;
      this.endLocalCall(true);
      this.notice("Missed call.");
    }, Math.max(0, RING_WINDOW_MS - elapsed));
  }

  /**
   * Stand the ring down because its row is gone: marked read or deleted by
   * another device (answered on the phone in the other hand), declined there,
   * or retired by the server's expiry sweep.
   *
   * Silent on purpose. The user did not miss anything — they were the one who
   * acted, on another screen — and a toast explaining a screen that just
   * closed is noise.
   */
  cancelRing = (callId: string | null) => {
    if (this.state.status !== "incoming") return;
    if (callId && this.state.callId && this.state.callId !== callId) return;
    this.dismissIncomingAlerts();
    this.endLocalCall(true);
  };

  /**
   * Accept.
   *
   * Two shapes, one method. On the chat page the offer is already in hand and
   * the answer goes out immediately. Anywhere else the ring came from a
   * notification row, so there is no offer yet: the media comes up, the
   * conversation's channel is attached, and the caller's retransmitted offer —
   * within ~2s — is what gets answered. That wait is why `OFFER_WAIT_MS`
   * exists, and why the caller retransmits at all.
   */
  accept = async () => {
    if (this.state.status !== "incoming") return;
    stopRingTone();
    this.stopIncomingVibration();
    if (this.ringExpiryTimeout) {
      clearTimeout(this.ringExpiryTimeout);
      this.ringExpiryTimeout = null;
    }

    const stream = await this.acquireMedia();
    if (!stream) {
      /* Decline by failing: tell the caller, and drop back to idle. */
      this.broadcast({ event: "decline" });
      this.settleCall("declined");
      this.endLocalCall(true);
      return;
    }

    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;
    this.localStream = stream;
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
    this.wirePeerConnection(pc);

    /* Answering collapses the full-screen ring into the pill at the top of the
       screen: the call is live, and the app the user was already in is still
       theirs to use. Expanding is one tap on the pill. */
    this.state.minimized = true;
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
      this.settleCall("canceled");
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
      const answer = await pc.createAnswer();
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
    /* Their gathering happened while we were elsewhere. */
    this.replayCandidates();
    await this.flushQueuedCandidates(pc);
    this.armConnectWatchdog();

    /* Answering is a server transition, not just a media state: it closes the
       callee's "ringing" leg (status -> answered), marks the incoming-call
       notification read, and cancels the ringing banner on every device this
       person owns. A PUSH NEVER AUTHORIZES THE CALL — this only lands for the
       user the row was addressed to (end_call_log re-checks), and it only
       changes state because they pressed Accept in a live, channel-authorized
       session. */
    if (this.incomingCallId) {
      const prior = this.state.callId;
      this.state.callId = this.incomingCallId;
      this.reportOutcome("answered");
      this.state.callId = prior ?? this.incomingCallId;
      this.publish();
      this.finalized = false; // the call is now LIVE; its end still has to be reported
      this.dismissIncomingAlerts();
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
    /* Declined is its own outcome, never a miss: the server writes
       `declined`, and the caller sees "Call declined" rather than "No
       answer". */
    if (this.incomingCallId) {
      if (!this.state.callId) this.state.callId = this.incomingCallId;
      this.reportOutcome("declined");
    }
    this.dismissIncomingAlerts();
    this.endLocalCall(true);
    vibrate(HAPTIC.warning);
  };

  /* ------------------------------------------------------------------ */
  /* Outbound call                                                       */
  /* ------------------------------------------------------------------ */

  startCall = async ({ conversationId, peerId }: { conversationId: string; peerId: string }) => {
    if (!this.myId || !conversationId || !peerId) return;
    if (this.state.status !== "idle") return;
    if (!requireOnline((message) => this.notice(message), "Calling")) return;

    /* ------------------------------------------------------------------
       Reserve the call with the SERVER first (start_call_log, 0005).
       ------------------------------------------------------------------
       Order matters three times over:
         * identity/friendship/block/ban checks happen before any microphone
           is opened, so a call that will be refused never blinks the recording
           indicator;
         * the row is created BEFORE the offer is broadcast, so the callee's
           push alert exists for a caller who navigates away one millisecond
           later — and it exists only for a call the server actually accepted;
         * the busy verdict comes from the same query, so the "They're busy"
           path needs no second round trip and no log entry at all.
       On a pre-0005 database the RPC is missing; fall through to the legacy
       table insert (same as before this change) so the app never loses calls
       to a pending migration. */
    const callId = this.mintCallId();
    let serverBusy = false;
    let legacyInsert = false;
    try {
      const { data, error } = await supabase.rpc("start_call_log", {
        p_call_id: callId,
        p_conversation_id: conversationId,
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

    const stream = await this.acquireMedia();
    if (!stream) {
      /* Mic refused AFTER the server accepted: the ringing row exists, so it
         has to be closed, not orphaned. */
      this.settleCall("canceled");
      this.endLocalCall(true);
      return;
    }

    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;
    this.localStream = stream;
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
    this.wirePeerConnection(pc);

    this.answered = false;
    this.setStatus("outgoing");
    startRingTone();

    let offerSdp = "";
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      offerSdp = pc.localDescription?.sdp ?? "";
    } catch {
      this.settleCall("canceled");
      this.endLocalCall(true);
      this.notice("Couldn't start the call.");
      return;
    }

    /* The call_id rides the offer so the callee can finalize THE SAME row on
       decline/answer instead of guessing by conversation. */
    this.broadcast({
      event: "offer",
      payload: { sdp: offerSdp, callId: legacyInsert ? undefined : callId },
    });

    /* And then it keeps riding it. A callee who is not on this chat page is
       not subscribed to this topic yet, so the single offer above would be
       the whole call for them — re-sent every two seconds, the newest copy is
       waiting whenever they tap Accept. */
    this.retransmitTimer = setInterval(() => {
      if (this.state.status !== "outgoing") {
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
      /* Pre-0005 fallback, kept exactly as it behaved before: the row exists
         from the first ring, not from the connect. */
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

    /* A phone gives up eventually. Forty-five unanswered seconds is a
       missed call, not a dial tone forever. The server's sweep is the backstop
       if THIS timer never fires (tab killed, phone rebooted). */
    this.ringingTimeout = setTimeout(() => {
      if (this.state.status === "outgoing") this.hangUp(null, "timeout");
    }, OUTGOING_TIMEOUT_MS);
  };

  /* ------------------------------------------------------------------ */
  /* Controls                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * The local-side hangup. `notify` is shown to the local user; the peer
   * is told via the "end" signal.
   * `reason` distinguishes the two no-answer endings the server needs apart:
   * a 45-second give-up is MISSED (the callee gets the chat entry + alert);
   * hanging up first is CANCELED (chat entry only — a caller who changes
   * their mind is not a missed call). An answered call that ends is always
   * COMPLETED.
   */
  hangUp = (notify: string | null = "Call ended.", reason: "timeout" | "user" = "user") => {
    if (this.state.status === "idle") return;
    const outcome: "completed" | "missed" | "canceled" = this.answered
      ? "completed"
      : reason === "timeout" && this.state.status === "outgoing"
        ? "missed"
        : "canceled";
    /* The transition table in end_call_log ignores anything illegal, so a
       callee pressing this (or a double hangup) converges on the server
       instead of fighting it. */
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
    vibrate(HAPTIC.tap);
  };

  toggleSpeaker = async () => {
    const audio = this.remoteAudio;
    if (!audio || !("setSinkId" in audio)) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter((d) => d.kind === "audiooutput" && d.deviceId);
      if (outputs.length <= 1) return;
      const defaultDevice =
        outputs.find((d) => /default/i.test(d.label)) ?? outputs[0];
      /* Speaker off: the default output. Speaker on: the first non-default
         one (headphones plugged in become "default" and this stays sane —
         the toggle always means "the other one"). */
      const target = this.state.speakerOn
        ? defaultDevice
        : outputs.find((d) => d.deviceId !== defaultDevice.deviceId) ?? defaultDevice;
      await audio.setSinkId(target.deviceId);
      this.state.speakerOn = !this.state.speakerOn;
      this.publish();
      vibrate(HAPTIC.tap);
    } catch {
      /* Device vanished or policy denied: the call continues on whatever
         output it had. A speaker toggle must never kill a live call. */
    }
  };

  /** Collapse into the top pill, or expand back over the screen. */
  setMinimized = (minimized: boolean) => {
    if (this.state.status === "idle" || this.state.minimized === minimized) return;
    this.state.minimized = minimized;
    this.publish();
    vibrate(HAPTIC.tap);
  };
}

export const callSession = new CallSession();
