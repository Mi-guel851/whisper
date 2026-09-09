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

  /** Closes the call_log row exactly once. `missed` is the caller's truth:
      the call never reached the other side. */
  const finalizeCallLog = useCallback((missed: boolean) => {
    if (!callLogIdRef.current || callFinalizedRef.current) return;
    callFinalizedRef.current = true;
    /* Promise.resolve: PostgREST builders thenable-resolve to a PromiseLike
       without .catch — same treatment as presence.ts's activity stamp. */
    void Promise.resolve(
      supabase
        .from("call_logs")
        .update({ ended_at: new Date().toISOString(), missed })
        .eq("id", callLogIdRef.current)
    ).catch(() => {
      /* The notification rides this row; a failed update is a missing
         notification, not a broken call. Swallowed, not surfaced. */
    });
  }, []);

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
    callFinalizedRef.current = false;
    answeredRef.current = false;
    mutedRef.current = false;
    setMuted(false);
    setSpeakerOn(false);
    setStartedAt(null);
  }, [clearCallTimers, stopIncomingVibration]);

  /** The local-side hangup. `notify` is shown to the local user; the peer
      is told via the "end" signal. */
  const hangUp = useCallback(
    (notify: string | null) => {
      if (statusRef.current === "idle") return;
      /* A call that never answered is missed — the flip fires the
         missed-call notification for the other side server-side. */
      finalizeCallLog(!answeredRef.current);
      void callSignaling.broadcast(conversationIdRef.current, {
        event: "end",
        user_id: myIdRef.current,
      });
      teardownMedia();
      setStatus("idle");
      if (notify) onNoticeRef.current(notify);
    },
    [finalizeCallLog, teardownMedia]
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

    const stream = await acquireMedia();
    if (!stream) return;

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
      teardownMedia();
      setStatus("idle");
      onNoticeRef.current("Couldn't start the call.");
      return;
    }

    void callSignaling.broadcast(conversationIdRef.current, {
      event: "offer",
      user_id: myIdRef.current,
      payload: { sdp: pc.localDescription?.sdp ?? "" },
    });

    /* The log row exists from the first ring, not from the connect: a call
       that rings for 40 seconds and goes missed is still a call, and the
       missed notification needs a row to flip. */
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

    /* A phone gives up eventually. Forty-five unanswered seconds is a
       missed call, not a dial tone forever. */
    ringingTimeoutRef.current = setTimeout(() => {
      if (statusRef.current === "outgoing") hangUp(null);
    }, OUTGOING_TIMEOUT_MS);
  }, [acquireMedia, enabled, hangUp, teardownMedia, wirePeerConnection]);

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
      payload: { sdp: pc.localDescription?.sdp ?? "" },
    });
  }, [acquireMedia, stopIncomingVibration, teardownMedia, wirePeerConnection]);

  const declineIncoming = useCallback(() => {
    if (statusRef.current !== "incoming") return;
    stopRingTone();
    stopIncomingVibration();
    void callSignaling.broadcast(conversationIdRef.current, {
      event: "decline",
      user_id: myIdRef.current,
    });
    teardownMedia();
    setStatus("idle");
    vibrate(HAPTIC.warning);
  }, [stopIncomingVibration, teardownMedia]);

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
            });
            return;
          }
          pendingOfferSdpRef.current = signal.payload?.sdp ?? null;
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
          /* The other side hung up. Close our own log row (if we are the
             caller and it is still open) as a normal completion — the flip
             to missed is the caller's own decision, made in hangUp. */
          finalizeCallLog(false);
          teardownMedia();
          setStatus("idle");
          onNoticeRef.current("Call ended.");
          return;
        }

        case "busy": {
          finalizeCallLog(!answeredRef.current);
          teardownMedia();
          setStatus("idle");
          onNoticeRef.current("They're on another call right now.");
          return;
        }

        case "decline": {
          finalizeCallLog(!answeredRef.current);
          teardownMedia();
          setStatus("idle");
          onNoticeRef.current("Call declined.");
          return;
        }
      }
    },
    [finalizeCallLog, startIncomingVibration, teardownMedia]
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

    return () => {
      unsubscribe();
      if (statusRef.current !== "idle") {
        void callSignaling.broadcast(conversationId, { event: "end", user_id: myId });
        finalizeCallLog(!answeredRef.current);
        teardownMedia();
        statusRef.current = "idle";
        setStatusState("idle");
      }
    };
  }, [enabled, myId, otherUserId, conversationId, finalizeCallLog, teardownMedia]);

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
