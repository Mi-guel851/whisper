"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { callSignaling, type CallSignal } from "./signaling";
import { getIceServers } from "./iceServers";
import { startRingTone, stopRingTone } from "./ringTone";
import { requireOnline } from "@/lib/offline";
import { vibrate, HAPTIC } from "@/lib/haptics";
import { supabase } from "@/lib/supabase/client";

/**
 * The 1:1 voice call, client side.
 *
 * ONE HOOK OWNS EVERYTHING CALL-RELATED
 *
 * RTCPeerConnection, getUserMedia, the mute/speaker controls, the ring
 * tone, the vibration, the ICE restart, and the call_log row. The chat page
 * renders the overlay/sheet from the returned state and calls the returned
 * actions — it holds no call state itself, so navigating away cannot strand
 * a half-torn-down connection: the unmount cleanup ends the call and tells
 * the other side.
 *
 * MEDIA PATH
 *
 * The Opus audio flows device-to-device over the WebRTC data channel.
 * Nothing about it — no frame, no chunk, no recording — ever touches
 * Supabase or Cloudinary. What crosses the realtime channel is the
 * handshake (SDP, ICE, and the four control words), and what crosses
 * Postgres is a single log row (started/ended/missed). That separation is
 * the product promise: "no call recording" is true because there is
 * nowhere to record to.
 *
 * AUDIO CODEC
 *
 * Opus, by construction: every modern browser (and the Android WebView and
 * iOS WKWebView) negotiates Opus as the default audio codec in an
 * RTCPeerConnection, so nothing is forced — forcing it would just add a
 * negotiation path that can fail. What IS forced is the capture chain:
 * echo cancellation, noise suppression and auto gain on, which is the
 * difference between a voice call and a recording of a voice call.
 *
 * ALL MUTABLE STATE LIVES IN REFS
 *
 * Signaling and ICE events arrive asynchronously from channels and from the
 * peer connection itself, often several in one tick. The handlers therefore
 * read status from a ref, not from a hook closure that is one render stale —
 * a stale "idle" reading is exactly how a busy call answers its own
 * renegotiation or a hangup revives a dead call. React state mirrors the ref
 * purely for rendering. Every helper is a useCallback over those refs (and
 * the stable setters), so the dependency graph is the honest one: nothing
 * here is "missing" a dependency, nothing is captured by accident.
 */

export type CallStatus = "idle" | "outgoing" | "incoming" | "connecting" | "in_call";

type UseVoiceCallParams = {
  conversationId: string;
  myId: string;
  otherUserId: string;
  /**
   * Calls exist only between accepted friends (the call button renders
   * nowhere else), and the hook must be fully inert outside that: no
   * channel, no media, nothing to leak.
   */
  enabled: boolean;
  /** "Busy", "declined", "call ended", "mic unavailable" — the page's toast. */
  onNotice: (message: string) => void;
};

/** No answer in 45 seconds is a missed call, the way a phone gives up. */
const OUTGOING_TIMEOUT_MS = 45_000;
/** How long "disconnected" may linger before an ICE restart is attempted. */
const ICE_DISCONNECT_GRACE_MS = 2_500;

export function useVoiceCall({ conversationId, myId, otherUserId, enabled, onNotice }: UseVoiceCallParams) {
  const [status, setStatusState] = useState<CallStatus>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);

  /* setSinkId (output-device switching) is desktop-Chrome-only; mobile
     WebViews route WebRTC audio through the OS audio session and expose no
     web API for it. The sheet hides the speaker button when this is false
     rather than show one that cannot do its job. */
  const [speakerSupported] = useState<boolean>(
    () => typeof window !== "undefined" && "setSinkId" in HTMLMediaElement.prototype
  );

  const statusRef = useRef<CallStatus>("idle");
  const mutedRef = useRef(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingOfferSdpRef = useRef<string | null>(null);
  const callLogIdRef = useRef<string | null>(null);
  /** call_logs.call_id of the current attempt (mine as caller, the peer's as
      callee — taken from the offer payload). Server transitions key on this. */
  const callIdRef = useRef<string | null>(null);
  /** For the CALLEE: the call_id carried by the live offer. Decline/answer
      address the caller's row through it; without it (legacy caller) the
      callee just tears down locally, exactly as before 0005. */
  const incomingCallIdRef = useRef<string | null>(null);
  const callFinalizedRef = useRef(false);
  const answeredRef = useRef(false);
  const ringingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vibrationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iceRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onNoticeRef = useRef(onNotice);
  const conversationIdRef = useRef(conversationId);
  const myIdRef = useRef(myId);
  const otherUserIdRef = useRef(otherUserId);

  useEffect(() => {
    onNoticeRef.current = onNotice;
    conversationIdRef.current = conversationId;
    myIdRef.current = myId;
    otherUserIdRef.current = otherUserId;
  });

  function setStatus(next: CallStatus) {
    statusRef.current = next;
    setStatusState(next);
  }

  /* ------------------------------------------------------------------ */
  /* Teardown and bookkeeping                                            */
  /* ------------------------------------------------------------------ */

  const stopIncomingVibration = useCallback(() => {
    if (vibrationTimerRef.current) {
      clearInterval(vibrationTimerRef.current);
      vibrationTimerRef.current = null;
    }
  }, []);

  const startIncomingVibration = useCallback(() => {
    stopIncomingVibration();
    /* A triple pulse now, then on a 3s cadence for the life of the ring —
       the haptics module applies the user's vibration setting and the
       native/web fallback. Felt as much as heard. */
    vibrate([300, 250, 300]);
    vibrationTimerRef.current = setInterval(() => vibrate([300, 250, 300]), 3_000);
  }, [stopIncomingVibration]);

  /** A call_id for the current attempt. Minted here and handed to the server
      as the idempotency key; the caller's uuid is what every transition
      (`answered`, `declined`, `missed`, …) is addressed by. */
  function mintCallId(): string {
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
  const reportOutcome = useCallback(
    (outcome: "answered" | "declined" | "busy" | "canceled" | "missed" | "completed") => {
      const callId = callIdRef.current;
      if (!callId) return;
      if (outcome !== "answered") {
        if (callFinalizedRef.current) return;
        callFinalizedRef.current = true;
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
                .eq("id", callLogIdRef.current)
            ).catch(() => {});
            return;
          }
          /* Anything else (a rejected transition, a transient error) is not
             worth the user's attention: the server sweep and the other side's
             own transition converge the row; a notification that cannot ride a
             dead network is a missed notification, not a broken call. */
        })
        .catch(() => {});
    },
    []
  );

  /** Pre-0005 databases only: a bare update against the row id, kept as the
      degraded path so an un-migrated server still records call ends the way it
      always did. With the migration applied, `reportOutcome` never reaches it
      (the RPC exists), and rows are keyed by call_id instead. */
  const legacyFinalize = useCallback(
    (missed: boolean) => {
      if (!callLogIdRef.current || callFinalizedRef.current) return;
      callFinalizedRef.current = true;
      void Promise.resolve(
        supabase
          .from("call_logs")
          .update({ ended_at: new Date().toISOString(), missed })
          .eq("id", callLogIdRef.current)
      ).catch(() => {});
    },
    []
  );

  /** The one entry point every end/answer/decline uses: the server transition
      table when it exists, the legacy update when the RPC is missing. */
  const settleCall = useCallback(
    (outcome: "answered" | "declined" | "busy" | "canceled" | "missed" | "completed") => {
      if (callIdRef.current || outcome !== "answered") {
        reportOutcome(outcome);
        if (callIdRef.current) return;
      }
      if (outcome === "missed") legacyFinalize(true);
      else if (outcome === "canceled" || outcome === "completed") legacyFinalize(false);
    },
    [legacyFinalize, reportOutcome]
  );

  const clearCallTimers = useCallback(() => {
    if (ringingTimeoutRef.current) {
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }
    if (iceRestartTimerRef.current) {
      clearTimeout(iceRestartTimerRef.current);
      iceRestartTimerRef.current = null;
    }
  }, []);

  /** Media + peer-connection teardown, no signaling, no state change. */
  const teardownMedia = useCallback(() => {
    stopRingTone();
    stopIncomingVibration();
    clearCallTimers();
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }
    pendingOfferSdpRef.current = null;
    callLogIdRef.current = null;
    callIdRef.current = null;
    incomingCallIdRef.current = null;
    callFinalizedRef.current = false;
    answeredRef.current = false;
    mutedRef.current = false;
    setMuted(false);
    setSpeakerOn(false);
    setStartedAt(null);
  }, [clearCallTimers, stopIncomingVibration]);

  /** Retire any system-level "Incoming call" banner this browser still shows
      (web push path: the notification is tagged `call-<callId>` by the
      service worker). The server fires the FCM-side cancel for native
      devices; this covers the web, where no FCM is involved and the tab that
      received the push is the only place a stale banner could linger. */
  const dismissIncomingAlerts = useCallback(() => {
    const callId = incomingCallIdRef.current;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.ready
      .then((registration) => {
        registration.active?.postMessage({
          type: "dismiss-notifications",
          tags: [callId ? `call-${callId}` : null].filter(Boolean),
        });
      })
      .catch(() => {});
  }, []);

  /** The local-side hangup. `notify` is shown to the local user; the peer
      is told via the "end" signal.
      `reason` distinguishes the two no-answer endings the server needs apart:
      a 45-second give-up is MISSED (the callee gets the chat entry + alert);
      hanging up first is CANCELED (chat entry only — a caller who changes
      their mind is not a missed call). An answered call that ends is always
      COMPLETED. The callee side never ends on hangUp; decline is its own
      action, and a bare navigation-away while incoming is reported busy-
      equivalent by leaving the row for the caller's timeout / server sweep. */
  const hangUp = useCallback(
    (notify: string | null, reason: "timeout" | "user" = "user") => {
      if (statusRef.current === "idle") return;
      const outcome: "completed" | "missed" | "canceled" = answeredRef.current
        ? "completed"
        : reason === "timeout" && statusRef.current === "outgoing"
        ? "missed"
        : "canceled";
      /* The transition table in end_call_log ignores anything illegal, so a
         callee pressing this (or a double hangup) converges on the server
         instead of fighting it. */
      settleCall(outcome);
      void callSignaling.broadcast(conversationIdRef.current, {
        event: "end",
        user_id: myIdRef.current,
        payload: callIdRef.current ? { callId: callIdRef.current } : null,
      });
      teardownMedia();
      setStatus("idle");
      if (notify) onNoticeRef.current(notify);
    },
    [settleCall, teardownMedia]
  );

  /* ------------------------------------------------------------------ */
  /* The peer connection itself                                          */
  /* ------------------------------------------------------------------ */

  const ensureRemoteAudio = useCallback((): HTMLAudioElement => {
    if (!remoteAudioRef.current) {
      const el = new Audio();
      el.autoplay = true;
      /* `playsInline` is honoured by the mobile WebViews and absent from
         some TS DOM lib versions — set it through a cast so the runtime
         behaviour is kept without depending on the type definition. */
      (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      remoteAudioRef.current = el;
    }
    return remoteAudioRef.current;
  }, []);

  const attemptIceRestart = useCallback(
    (pc: RTCPeerConnection) => {
      if (statusRef.current === "idle") return;
      (async () => {
        try {
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
          /* The restart flag is load-bearing: a mid-call offer from a peer
             the receiver sees as "idle" must not hijack the call (see
             signaling). */
          void callSignaling.broadcast(conversationIdRef.current, {
            event: "offer",
            user_id: myIdRef.current,
            payload: { sdp: offer.sdp, restart: true },
          });
        } catch {
          hangUp("Call ended. Check your connection and try again.");
        }
      })();
    },
    [hangUp]
  );

  const wirePeerConnection = useCallback(
    (pc: RTCPeerConnection) => {
      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        void callSignaling.broadcast(conversationIdRef.current, {
          event: "ice",
          user_id: myIdRef.current,
          payload: { candidate: event.candidate.toJSON() },
        });
      };

      pc.ontrack = (event) => {
        const audio = ensureRemoteAudio();
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio.play().catch(() => {
          /* Autoplay blocked: the user is looking at the in-call sheet and
             has their finger on the screen — any tap resumes the context. */
        });
      };

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        if (state === "connected") {
          if (statusRef.current === "outgoing" || statusRef.current === "connecting") {
            answeredRef.current = true;
            if (statusRef.current === "outgoing") stopRingTone();
            setStatus("in_call");
            setStartedAt(Date.now());
            vibrate(HAPTIC.success);
          }
          return;
        }
        if (state === "disconnected" && (statusRef.current === "connecting" || statusRef.current === "in_call")) {
          /* A momentary "disconnected" usually heals on its own; give it the
             grace, then restart ICE rather than strand the call. */
          if (!iceRestartTimerRef.current) {
            iceRestartTimerRef.current = setTimeout(() => {
              iceRestartTimerRef.current = null;
              if (pc.iceConnectionState === "disconnected" && statusRef.current !== "idle") {
                attemptIceRestart(pc);
              }
            }, ICE_DISCONNECT_GRACE_MS);
          }
          return;
        }
        if (state === "failed") {
          attemptIceRestart(pc);
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" && statusRef.current !== "idle") {
          /* ICE restart ran and did not save it: end cleanly, with the log
             row closed, instead of leaving both sides ringing forever. */
          hangUp("Call ended. Check your connection and try again.");
        }
      };
    },
    [attemptIceRestart, ensureRemoteAudio, hangUp]
  );

  const acquireMedia = useCallback(async (): Promise<MediaStream | null> => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      onNoticeRef.current(
        "Microphone unavailable. Check the device's microphone permission and try again."
      );
      return null;
    }
  }, []);

  /* ------------------------------------------------------------------ */
  /* Outbound call                                                       */
  /* ------------------------------------------------------------------ */

  const startCall = useCallback(async () => {
    if (!enabled || !myIdRef.current || !otherUserIdRef.current) return;
    if (statusRef.current !== "idle") return;
    if (!requireOnline(onNoticeRef.current, "Calling")) return;

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
    const callId = mintCallId();
    let serverBusy = false;
    let legacyInsert = false;
    try {
      const { data, error } = await supabase.rpc("start_call_log", {
        p_call_id: callId,
        p_conversation_id: conversationIdRef.current,
      });
      if (error) {
        legacyInsert =
          error.code === "PGRST202" ||
          error.code === "42883" ||
          /does not exist/i.test(error.message ?? "");
        if (!legacyInsert) {
          onNoticeRef.current(error.message || "Couldn't start the call.");
          return;
        }
      } else {
        const receipt = (data ?? {}) as { status?: string; id?: string };
        if (receipt.status === "busy") {
          serverBusy = true;
        } else {
          callIdRef.current = callId;
          callLogIdRef.current = receipt.id ?? null;
        }
      }
    } catch {
      legacyInsert = true;
    }
    if (serverBusy) {
      onNoticeRef.current("They're on another call right now.");
      return;
    }

    const stream = await acquireMedia();
    if (!stream) {
      /* Mic refused AFTER the server accepted: the ringing row exists, so it
         has to be closed, not orphaned. */
      settleCall("canceled");
      callIdRef.current = null;
      return;
    }

    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;
    localStreamRef.current = stream;
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
    wirePeerConnection(pc);

    setStatus("outgoing");
    answeredRef.current = false;
    startRingTone();

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
    } catch {
      settleCall("canceled");
      teardownMedia();
      setStatus("idle");
      onNoticeRef.current("Couldn't start the call.");
      return;
    }

    /* The call_id rides the offer so the callee can finalize THE SAME row on
       decline/answer instead of guessing by conversation. */
    void callSignaling.broadcast(conversationIdRef.current, {
      event: "offer",
      user_id: myIdRef.current,
      payload: { sdp: pc.localDescription?.sdp ?? "", callId: legacyInsert ? undefined : callId },
    });

    if (legacyInsert) {
      /* Pre-0005 fallback, kept exactly as it behaved before: the row exists
         from the first ring, not from the connect. */
      void Promise.resolve(
        supabase
          .from("call_logs")
          .insert({
            conversation_id: conversationIdRef.current,
            caller_id: myIdRef.current,
            callee_id: otherUserIdRef.current,
          })
          .select("id")
      )
        .then(({ data }) => {
          callLogIdRef.current = (data?.[0] as { id?: string } | undefined)?.id ?? null;
        })
        .catch(() => {});
    }

    /* A phone gives up eventually. Forty-five unanswered seconds is a
       missed call, not a dial tone forever. The server's sweep is the backstop
       if THIS timer never fires (tab killed, phone rebooted). */
    ringingTimeoutRef.current = setTimeout(() => {
      if (statusRef.current === "outgoing") hangUp(null, "timeout");
    }, OUTGOING_TIMEOUT_MS);
  }, [acquireMedia, enabled, hangUp, settleCall, teardownMedia, wirePeerConnection]);

  /* ------------------------------------------------------------------ */
  /* Inbound call                                                        */
  /* ------------------------------------------------------------------ */

  const acceptIncoming = useCallback(async () => {
    if (statusRef.current !== "incoming") return;
    stopRingTone();
    stopIncomingVibration();

    const stream = await acquireMedia();
    if (!stream) {
      /* Decline by failing: tell the caller, and drop back to idle. */
      void callSignaling.broadcast(conversationIdRef.current, {
        event: "decline",
        user_id: myIdRef.current,
      });
      teardownMedia();
      setStatus("idle");
      return;
    }

    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;
    localStreamRef.current = stream;
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
    wirePeerConnection(pc);

    const sdp = pendingOfferSdpRef.current;
    if (!sdp) {
      teardownMedia();
      setStatus("idle");
      return;
    }

    setStatus("connecting");
    try {
      await pc.setRemoteDescription({ type: "offer", sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
    } catch {
      teardownMedia();
      setStatus("idle");
      return;
    }

    void callSignaling.broadcast(conversationIdRef.current, {
      event: "answer",
      user_id: myIdRef.current,
      payload: { sdp: pc.localDescription?.sdp ?? "", callId: incomingCallIdRef.current ?? undefined },
    });

    /* Answering is a server transition, not just a media state: it closes the
       callee's "ringing" leg (status -> answered), marks the incoming-call
       notification read, and cancels the ringing banner on every device this
       person owns. A PUSH NEVER AUTHORIZES THE CALL — this call only lands
       for the user the row was addressed to (end_call_log re-checks), and it
       only changes state because they pressed Accept in a live,
       channel-authorized session. */
    if (incomingCallIdRef.current) {
      const prior = callIdRef.current;
      callIdRef.current = incomingCallIdRef.current;
      reportOutcome("answered");
      callIdRef.current = prior ?? incomingCallIdRef.current;
      callFinalizedRef.current = false; // the call is now LIVE; its end still has to be reported
      dismissIncomingAlerts();
    }
  }, [acquireMedia, dismissIncomingAlerts, reportOutcome, stopIncomingVibration, teardownMedia, wirePeerConnection]);

  const declineIncoming = useCallback(() => {
    if (statusRef.current !== "incoming") return;
    stopRingTone();
    stopIncomingVibration();
    void callSignaling.broadcast(conversationIdRef.current, {
      event: "decline",
      user_id: myIdRef.current,
      payload: incomingCallIdRef.current ? { callId: incomingCallIdRef.current } : null,
    });
    /* The decline writes the row as `declined` (no missed push — they heard it
       and said no) and cancels the ringing notification on this device's
       peers. */
    if (incomingCallIdRef.current) {
      callIdRef.current = incomingCallIdRef.current;
      reportOutcome("declined");
    }
    teardownMedia();
    setStatus("idle");
    vibrate(HAPTIC.warning);
  }, [reportOutcome, stopIncomingVibration, teardownMedia]);

  /* ------------------------------------------------------------------ */
  /* Controls                                                            */
  /* ------------------------------------------------------------------ */

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream || statusRef.current === "idle") return;
    const nextEnabled = mutedRef.current;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = nextEnabled;
    });
    mutedRef.current = !nextEnabled;
    setMuted(!nextEnabled);
    vibrate(HAPTIC.tap);
  }, []);

  const toggleSpeaker = useCallback(async () => {
    const audio = remoteAudioRef.current;
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
      const target = speakerOn ? defaultDevice : outputs.find((d) => d.deviceId !== defaultDevice.deviceId) ?? defaultDevice;
      await audio.setSinkId(target.deviceId);
      setSpeakerOn(!speakerOn);
      vibrate(HAPTIC.tap);
    } catch {
      /* Device vanished or policy denied: the call continues on whatever
         output it had. A speaker toggle must never kill a live call. */
    }
  }, [speakerOn]);

  /* ------------------------------------------------------------------ */
  /* Inbound signaling                                                   */
  /* ------------------------------------------------------------------ */

  const handleSignal = useCallback(
    (signal: CallSignal) => {
      if (!signal || signal.user_id !== otherUserIdRef.current) return;

      switch (signal.event) {
        case "offer": {
          /* A renegotiation only counts mid-call; a first offer only counts
             when idle. Everything else is answered with busy — including an
             offer that arrives while an incoming call is un-answered, which
             is the "two people ring each other at once" case. */
          if (signal.payload?.restart && (statusRef.current === "connecting" || statusRef.current === "in_call")) {
            const pc = pcRef.current;
            if (pc) {
              (async () => {
                try {
                  await pc.setRemoteDescription({ type: "offer", sdp: signal.payload!.sdp! });
                  const answer = await pc.createAnswer();
                  await pc.setLocalDescription(answer);
                  void callSignaling.broadcast(conversationIdRef.current, {
                    event: "answer",
                    user_id: myIdRef.current,
                    payload: { sdp: pc.localDescription?.sdp ?? "" },
                  });
                } catch {
                  /* A failed renegotiation is the old path; the next ICE
                     state will either heal it or end the call. */
                }
              })();
            }
            return;
          }
          if (statusRef.current !== "idle") {
            void callSignaling.broadcast(conversationIdRef.current, {
              event: "busy",
              user_id: myIdRef.current,
              payload:
                typeof signal.payload?.callId === "string" ? { callId: signal.payload.callId } : null,
            });
            return;
          }
          pendingOfferSdpRef.current = signal.payload?.sdp ?? null;
          incomingCallIdRef.current =
            typeof signal.payload?.callId === "string" ? signal.payload.callId : null;
          setStatus("incoming");
          startRingTone();
          startIncomingVibration();
          return;
        }

        case "answer": {
          const pc = pcRef.current;
          if (pc && (statusRef.current === "outgoing" || statusRef.current === "connecting")) {
            void pc
              .setRemoteDescription({ type: "answer", sdp: signal.payload?.sdp ?? "" })
              .then(() => {
                answeredRef.current = true;
                if (statusRef.current === "outgoing") {
                  stopRingTone();
                  setStatus("connecting");
                }
              })
              .catch(() => {});
          }
          return;
        }

        case "ice": {
          if (signal.payload?.candidate) {
            void pcRef.current?.addIceCandidate(signal.payload.candidate).catch(() => {});
          }
          return;
        }

        case "end": {
          /* The other side hung up. A live call completes; an unanswered one
             the peer walked away from is recorded CANCELED by whoever reaches
             the server first (the transition table drops the loser's write),
             never MISSED — "they left" is not "they missed it". */
          settleCall(answeredRef.current ? "completed" : "canceled");
          /* A callee receiving `end` while still ringing: the system banner is
             retired from the same place the server retires it (data-only FCM
             via notify-on-notification), but a browser without a service
             worker still needs the local close. */
          if (statusRef.current === "incoming") dismissIncomingAlerts();
          teardownMedia();
          setStatus("idle");
          onNoticeRef.current("Call ended.");
          return;
        }

        case "busy": {
          /* Busy is not missed: the callee's device answered the signaling by
             refusing it. Record the attempt, skip the missed alert — and on a
             modern database the callee side already wrote `busy`/declined its
             own way; the table ignores this write in that case. */
          settleCall("canceled");
          teardownMedia();
          setStatus("idle");
          onNoticeRef.current("They're on another call right now.");
          return;
        }

        case "decline": {
          /* Declined ≠ missed. The callee's own `declined` (0005) writes the
             row when it can; this caller-side call covers legacy peers, and is
             ignored when the row is already final either way. */
          settleCall("canceled");
          if (statusRef.current === "incoming") dismissIncomingAlerts();
          teardownMedia();
          setStatus("idle");
          onNoticeRef.current("Call declined.");
          return;
        }
      }
    },
    [dismissIncomingAlerts, settleCall, startIncomingVibration, teardownMedia]
  );

  /* The channel subscription, and the unmount tear-down that makes
     "navigating away" equal to "hanging up". The cleanup reads everything
     through refs and the stable callbacks, so the dep array below is the
     complete truth. */
  const handleSignalRef = useRef(handleSignal);
  useEffect(() => {
    handleSignalRef.current = handleSignal;
  }, [handleSignal]);

  useEffect(() => {
    if (!enabled || !myId || !otherUserId) return;

    const unsubscribe = callSignaling.subscribe(conversationId, myId, (signal) =>
      handleSignalRef.current(signal)
    );

    /* Stale-alert convergence (server-side, not timer-side): call_logs is in
       the realtime publication and readable by participants, so when ANY
       device of either party settles the row — answered elsewhere, declined,
       or the expiry sweep closed it — this view tears the ring down too.
       Without it, the overlay on the other device would offer "Accept" for a
       call that no longer exists. */
    const logChannel = supabase
      .channel(`call-logs-${conversationId}-${myId}`)
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
            (statusRef.current === "incoming" || statusRef.current === "outgoing") &&
            row.status &&
            row.status !== "ringing"
          ) {
            dismissIncomingAlerts();
            /* Only an un-answered leg is torn down by a remote finalization;
               a live call (answered) keeps running no matter what the log
               says — its own media/ICE state decides when it ends. */
            if (!answeredRef.current) {
              stopRingTone();
              teardownMedia();
              setStatus("idle");
              onNoticeRef.current(
                row.status === "missed" || row.status === "expired"
                  ? "The call timed out."
                  : "Call ended before it connected."
              );
            }
          }
        }
      )
      .subscribe();

    return () => {
      unsubscribe();
      supabase.removeChannel(logChannel);
      if (statusRef.current !== "idle") {
        void callSignaling.broadcast(conversationId, { event: "end", user_id: myId });
        settleCall(answeredRef.current ? "completed" : "canceled");
        teardownMedia();
        statusRef.current = "idle";
        setStatusState("idle");
      }
    };
  }, [
    enabled,
    myId,
    otherUserId,
    conversationId,
    settleCall,
    teardownMedia,
    dismissIncomingAlerts,
  ]);

  return {
    status,
    startedAt,
    muted,
    speakerSupported,
    speakerOn,
    startCall,
    acceptIncoming,
    declineIncoming,
    hangUp: () => hangUp("Call ended."),
    toggleMute,
    toggleSpeaker,
  };
}
