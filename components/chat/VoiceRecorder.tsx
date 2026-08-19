"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { Mic, Trash2, Send, Lock, ChevronUp, Pause, Play, Eye, Loader2 } from "lucide-react";
import { HAPTIC, vibrate } from "@/lib/haptics";
import { Capacitor } from "@capacitor/core";
import MicPermissionDialog from "./MicPermissionDialog";
import { useToast } from "@/components/ToastProvider";
import {
  useVoiceRecorder,
  MIN_RECORDING_MS,
  MAX_RECORDING_MS,
  type VoiceRecording,
} from "@/lib/useVoiceRecorder";

/**
 * WhatsApp's voice note control, in its two states.
 *
 * THE TWO WAYS TO SEND
 *
 * Press and hold, then release — the whole note lives inside one gesture, and
 * the finger never has to find a second target.
 *
 * Or drag up to latch, which frees the finger and hands over a panel with an
 * explicit Send button, plus pause and discard. Slide left, either way, to
 * throw it away.
 *
 * THREE RACES THIS CONTROL USED TO LOSE
 *
 * 1. `stop()` could outrun `start()`. Releasing before `getUserMedia` resolved
 *    called `stop()` on a recorder that did not exist yet, which resolved null,
 *    and then `start()` finished and left a recording running with no gesture
 *    attached to it and no UI to end it. `finish()` now awaits the in-flight
 *    start before stopping.
 *
 * 2. `pointercancel` was handled as a release, so it *sent*. But the browser
 *    fires it precisely when something takes the gesture away mid-recording —
 *    a permission bubble, a system edge swipe — at which point the clip is
 *    usually a few milliseconds long and got silently discarded. It latches
 *    now: the recording survives and the Send button appears.
 *
 * 3. On the web the first press was spent on the permission prompt. The
 *    rationale dialog existed but was gated behind `isNativePlatform()`, so in
 *    a browser the first hold opened a permission bubble instead of recording,
 *    lost the gesture to it, and looked like a dead button. Permission state is
 *    now resolved on mount, so the dialog comes first in both places and the
 *    press that follows records.
 */

const CANCEL_DISTANCE = 96;

/* Shortened from 76px. The latch is the only route to the Send button, and a
   76px reach from a thumb resting at the bottom-right of a phone was far enough
   that most people released before finding it. */
const LOCK_DISTANCE = 64;

const HOLD_BARS = 28;
const PANEL_BARS = 44;

/** Set once the mic has actually opened, so the dialog is asked for once a session. */
let micGranted = false;

/**
 * Whether to show the rationale before recording.
 *
 * Resolved ahead of the gesture, not during it: this is async, and a press has
 * to decide synchronously whether it is starting a recording or opening a
 * dialog. Deciding late is what cost the first press.
 */
async function micNeedsRationale(): Promise<boolean> {
  if (micGranted) return false;

  if (Capacitor.isNativePlatform()) {
    /* Native keeps its own flag: the OS prompt is one-per-install, so once the
       rationale has been shown the plugin's own permission state governs. */
    try {
      return !localStorage.getItem("mic_prompted");
    } catch {
      return false; // private mode with storage blocked — don't nag every press
    }
  }

  try {
    const status = await navigator.permissions?.query({
      name: "microphone",
    } as unknown as PermissionDescriptor);

    if (!status) return false; // no Permissions API — let getUserMedia ask
    if (status.state === "granted") {
      micGranted = true;
      return false;
    }
    /* "denied" deliberately returns false. The dialog cannot reopen a blocked
       permission — only browser settings can — so showing it would be a dead
       end. `start()` surfaces the real reason instead. */
    return status.state === "prompt";
  } catch {
    /* Firefox has historically thrown on a "microphone" descriptor. Falling
       through to getUserMedia is the correct degradation. */
    return false;
  }
}

function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function laneFor(peaks: number[], count: number) {
  return Array.from({ length: count }, (_, index) => peaks[peaks.length - count + index] ?? 0);
}

type VoiceRecorderProps = {
  canRecord: boolean;
  cost: number;
  busy: boolean;
  onBlocked: () => void;
  onSend: (recording: VoiceRecording) => void;
  onError: (message: string) => void;
  onRecordingChange?: (recording: boolean) => void;
};

function VoiceRecorderBase({
  canRecord,
  cost,
  busy,
  onBlocked,
  onSend,
  onError,
  onRecordingChange,
}: VoiceRecorderProps) {
  const [locked, setLocked] = useState(false);
  const [showMicRationale, setShowMicRationale] = useState(false);
  const { showToast } = useToast();

  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);

  const pointerIdRef = useRef<number | null>(null);
  const originRef = useRef({ x: 0, y: 0 });
  const cancelledRef = useRef(false);
  const lockedRef = useRef(false);
  const armedRef = useRef(false);

  /** The in-flight `start()`, so a release can wait for it instead of racing it. */
  const startRef = useRef<Promise<boolean> | null>(null);

  /* Resolved on mount and kept in sync with the browser's own permission state,
     so `handlePointerDown` reads a plain boolean. Starts null — "not known yet"
     is distinct from "no rationale needed", and a press during that window
     should ask rather than assume. */
  const [needsRationale, setNeedsRationale] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let permission: PermissionStatus | null = null;

    const sync = () => {
      void micNeedsRationale().then((needed) => {
        if (!cancelled) setNeedsRationale(needed);
      });
    };

    sync();

    /* A grant made in another tab, or through the browser's own site settings,
       should clear the dialog without a reload. */
    if (!Capacitor.isNativePlatform()) {
      navigator.permissions
        ?.query({ name: "microphone" } as unknown as PermissionDescriptor)
        .then((result) => {
          if (cancelled) return;
          permission = result;
          result.addEventListener("change", sync);
        })
        .catch(() => {
          /* No Permissions API, or a descriptor it refuses. Nothing to watch. */
        });
    }

    return () => {
      cancelled = true;
      permission?.removeEventListener("change", sync);
    };
  }, []);

  const resetGesture = useCallback(() => {
    pointerIdRef.current = null;
    cancelledRef.current = false;
    armedRef.current = false;
    animate(dragX, 0, { duration: 0.18 });
    animate(dragY, 0, { duration: 0.18 });
  }, [dragX, dragY]);

  const deliver = useCallback(
    (recording: VoiceRecording | null) => {
      setLocked(false);
      lockedRef.current = false;
      resetGesture();
      if (!recording) return;

      if (recording.durationMs < MIN_RECORDING_MS) {
        onError("Hold the mic to record a voice note.");
        return;
      }
      vibrate(HAPTIC.select);
      onSend(recording);
    },
    [resetGesture, onSend, onError]
  );

  const {
    status, isRecording, isPaused, elapsedMs, peaks, error,
    clearError, start, stop, cancel, pause, resume,
  } = useVoiceRecorder({ onAutoStop: deliver });

  /* "Starting" counts as active. The hold bar then appears on the press rather
     than when the mic finishes opening — the difference between a control that
     responds and one that seems to hesitate — and a latch that lands during
     startup has somewhere to render. */
  const active = isRecording || status === "starting";

  const hintOpacity = useTransform(dragX, [-CANCEL_DISTANCE, -8, 0], [0, 1, 1]);
  const trashScale = useTransform(dragX, [-CANCEL_DISTANCE, 0], [1.35, 1]);
  const lockProgress = useTransform(dragY, [-LOCK_DISTANCE, 0], [1, 0]);

  useEffect(() => {
    if (!error) return;

    /* Always surfaced, blocked permission included. Swallowing that one is what
       made the button look dead: the press did nothing and said nothing. */
    onError(error);

    /* A block cannot be undone from in here — only from browser or OS settings
       — so stop offering the rationale dialog, which would otherwise reappear on
       every press and lead nowhere. */
    if (/blocked|denied|notallowed/i.test(error)) setNeedsRationale(false);

    clearError();
    setLocked(false);
    lockedRef.current = false;
    resetGesture();
  }, [error, onError, clearError, resetGesture]);

  /* Safety net for one invariant: `locked` true while nothing is recording
     renders neither branch below — the panel needs `active`, the mic button
     needs `!locked` — and the control disappears from the composer entirely.
     Reachable when a latch lands during startup and the start then fails
     without setting `error` (the hook returns false without one when it is
     asked to start from a non-idle state). Cheaper to hold the invariant here
     than to unwind it correctly on every failure path. */
  useEffect(() => {
    if (status === "idle" && locked) {
      setLocked(false);
      lockedRef.current = false;
    }
  }, [status, locked]);

  const onRecordingChangeRef = useRef(onRecordingChange);
  useEffect(() => { onRecordingChangeRef.current = onRecordingChange; }, [onRecordingChange]);
  /* Reports `active`, not `isRecording`, so the composer the parent hides
     collapses on the press instead of a moment later when the mic opens. */
  useEffect(() => {
    onRecordingChangeRef.current?.(active);
  }, [active]);

  /** Hand the recording over to the panel and let go of the finger. */
  const latch = useCallback(() => {
    lockedRef.current = true;
    setLocked(true);
    vibrate(HAPTIC.success);
    animate(dragX, 0, { duration: 0.16 });
    animate(dragY, 0, { duration: 0.16 });
  }, [dragX, dragY]);

  const finish = useCallback(async () => {
    /* Await the start before stopping. Without this a quick release stops a
       recorder that has not been created yet — see race 1 in the header. */
    if (startRef.current) await startRef.current;
    deliver(await stop());
  }, [stop, deliver]);

  const abort = useCallback(() => {
    cancelledRef.current = true;
    cancel();
    setLocked(false);
    lockedRef.current = false;
    resetGesture();
    vibrate(HAPTIC.warning);
  }, [cancel, resetGesture]);

  const beginRecording = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* unsupported */ }
      pointerIdRef.current = event.pointerId;
      originRef.current = { x: event.clientX, y: event.clientY };
      cancelledRef.current = false;
      armedRef.current = true;

      vibrate(HAPTIC.select);

      const pending = start();
      startRef.current = pending;
      void pending.then((started) => {
        if (startRef.current === pending) startRef.current = null;
        if (started) micGranted = true;
        else { armedRef.current = false; pointerIdRef.current = null; }
      });
    },
    [start]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      /* Guarded on `active`, not `isRecording`. A second press landing while the
         mic is still opening would otherwise call `start()` again, which bails
         on a non-idle status and returns false — and that false is read as "this
         gesture failed", disarming the *first* press and losing the recording it
         had already begun. */
      if (busy || active) return;
      if (!canRecord) { onBlocked(); return; }

      /* Ask before recording, in the browser as well as in the shell. `null` is
         "still resolving", and asking is the safe answer there — a rationale
         the user did not need costs one tap, a lost gesture costs the note. */
      if (needsRationale !== false) {
        setShowMicRationale(true);
        return;
      }

      beginRecording(event);
    },
    [busy, active, canRecord, onBlocked, needsRationale, beginRecording]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (pointerIdRef.current !== event.pointerId || lockedRef.current) return;

      const deltaX = Math.min(0, event.clientX - originRef.current.x);
      const deltaY = Math.min(0, event.clientY - originRef.current.y);

      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        dragY.set(Math.max(deltaY, -LOCK_DISTANCE - 24));
        dragX.set(0);
        if (deltaY <= -LOCK_DISTANCE && armedRef.current) {
          latch();
        }
        return;
      }

      dragX.set(Math.max(deltaX, -CANCEL_DISTANCE - 24));
      dragY.set(0);
      if (deltaX <= -CANCEL_DISTANCE && armedRef.current) {
        armedRef.current = false;
        abort();
      }
    },
    [dragX, dragY, abort, latch]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (pointerIdRef.current !== event.pointerId) return;
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* unsupported */ }
      pointerIdRef.current = null;

      if (lockedRef.current) return;
      if (cancelledRef.current) { resetGesture(); return; }
      if (!armedRef.current) { resetGesture(); return; }
      void finish();
    },
    [finish, resetGesture]
  );

  /**
   * The gesture was taken away rather than ended — a permission bubble, a
   * system swipe, a call arriving. Latch instead of sending: the audio captured
   * so far is kept and the panel's Send button takes over. Discarding here is
   * what made the first-ever recording look like a dead button.
   */
  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (pointerIdRef.current !== event.pointerId) return;
      pointerIdRef.current = null;

      if (lockedRef.current || cancelledRef.current || !armedRef.current) {
        resetGesture();
        return;
      }
      latch();
    },
    [latch, resetGesture]
  );

  async function grantMicAccess() {
    setShowMicRationale(false);
    try { localStorage.setItem("mic_prompted", "true"); } catch { /* storage blocked */ }

    const stream = await navigator.mediaDevices?.getUserMedia({ audio: true }).catch(() => null);
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      micGranted = true;
      setNeedsRationale(false);
      showToast("Microphone ready! Hold to record.");
    } else {
      /* Denied. `needsRationale` goes false either way: the dialog cannot
         reopen a blocked permission, and re-showing it on every press would
         trap the user in it. The next press surfaces the real reason. */
      setNeedsRationale(false);
      showToast("Microphone access denied.");
    }
  }

  const holding = active && !locked;
  const nearingLimit = elapsedMs > MAX_RECORDING_MS - 15_000;
  const timerColor = nearingLimit ? "var(--chat-danger)" : "var(--chat-bubble-text)";

  return (
    <>
      {showMicRationale && (
        <MicPermissionDialog
          onConfirm={grantMicAccess}
          onCancel={() => setShowMicRationale(false)}
        />
      )}

      {holding && (
        <div className="chat-recording-bar absolute inset-0 z-20 flex items-center gap-2 rounded-[26px] pl-3 pr-16">
          <button
            type="button"
            onClick={abort}
            className="chat-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            aria-label="Discard voice note"
          >
            <motion.span style={{ scale: trashScale }} className="flex">
              <Trash2 size={17} />
            </motion.span>
          </button>

          <span className="chat-recording-dot h-2.5 w-2.5 shrink-0 rounded-full" aria-hidden="true" />

          <span className="shrink-0 text-[13px] font-bold tabular-nums" style={{ color: timerColor }}>
            {formatDuration(elapsedMs)}
          </span>

          <div className="flex h-6 min-w-0 flex-1 items-center gap-[2px] overflow-hidden" aria-hidden="true">
            {laneFor(peaks, HOLD_BARS).map((peak, index) => (
              <span
                key={index}
                className="chat-recording-level w-[3px] shrink-0 rounded-full"
                style={{ height: `${Math.max(8, peak * 0.22 + 8)}px` }}
              />
            ))}
          </div>

          <motion.span style={{ opacity: hintOpacity }} className="chat-meta shrink-0 text-[11px] font-semibold">
            ‹ slide to cancel
          </motion.span>
        </div>
      )}

      {locked && active && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", bounce: 0, duration: 0.32 }}
          className="chat-recording-panel absolute inset-x-0 bottom-0 z-30 flex flex-col gap-3 rounded-[26px] px-4 pb-3 pt-3.5"
        >
          <div className="flex items-center gap-3">
            <span
              className="shrink-0 text-[15px] font-bold tabular-nums"
              style={{ color: timerColor }}
              aria-live="off"
            >
              {formatDuration(elapsedMs)}
            </span>

            <div
              className={`flex h-7 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden ${
                isPaused ? "opacity-45" : ""
              }`}
              aria-hidden="true"
            >
              {laneFor(peaks, PANEL_BARS).map((peak, index) => (
                <span
                  key={index}
                  className="chat-recording-level w-[3px] shrink-0 rounded-full"
                  style={{ height: `${Math.max(4, peak * 0.26 + 4)}px` }}
                />
              ))}
            </div>

            <span
              title="This voice note can only be played once"
              className="chat-recording-once-on flex h-8 shrink-0 items-center gap-1 rounded-full pl-2 pr-2.5 text-[10px] font-black uppercase tracking-wide"
            >
              <Eye size={12} />
              Once
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={abort}
              aria-label="Discard voice note"
              className="chat-recording-trash flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
            >
              <Trash2 size={19} />
            </button>

            <button
              type="button"
              onClick={isPaused ? resume : pause}
              disabled={status === "starting"}
              className="chat-recording-pause flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-bold disabled:opacity-60"
            >
              {isPaused ? <Play size={17} fill="currentColor" /> : <Pause size={17} fill="currentColor" />}
              {isPaused ? "Resume" : "Pause"}
            </button>

            <button
              type="button"
              onClick={() => void finish()}
              disabled={status === "finishing"}
              aria-label="Send voice note"
              className="chat-recording-send flex h-12 w-12 shrink-0 items-center justify-center rounded-full disabled:opacity-60"
            >
              {status === "finishing" ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
        </motion.div>
      )}

      {!locked && (
        <div className="relative flex shrink-0 items-center">
          {holding && (
            <motion.div
              style={{ opacity: lockProgress }}
              className="chat-recording-lock pointer-events-none absolute -top-[78px] left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-1 rounded-full px-2 py-2.5"
            >
              <Lock size={13} />
              <ChevronUp size={13} className="chat-recording-chevron" />
            </motion.div>
          )}

          <motion.button
            type="button"
            style={{ x: dragX, y: dragY, touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onContextMenu={(event) => event.preventDefault()}
            disabled={busy}
            title={
              canRecord
                ? `Hold to record a voice note, release to send (${cost} coins). Slide up to keep recording hands-free.`
                : "Unlock this chat to send voice notes"
            }
            aria-label={
              holding
                ? "Recording — release to send, slide up to lock, slide left to cancel"
                : `Hold to record a voice note, ${cost} coins`
            }
            className={`chat-send-circle relative z-30 flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full disabled:opacity-60 ${
              holding ? "chat-recording-mic" : ""
            }`}
          >
            {/* The glyph flips to Send while held, so the button under the thumb
                is the one that says what letting go will do. */}
            {holding ? <Send size={20} /> : <Mic size={21} />}
          </motion.button>
        </div>
      )}
    </>
  );
}

export const VoiceRecorder = memo(VoiceRecorderBase);
export default VoiceRecorder;
