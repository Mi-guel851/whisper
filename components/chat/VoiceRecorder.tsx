"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { Mic, Trash2, Send, Lock, ChevronUp, Eye, Loader2, Square } from "lucide-react";
import { vibrate } from "@/lib/haptics";
import {
  useVoiceRecorder,
  MIN_RECORDING_MS,
  MAX_RECORDING_MS,
  type VoiceRecording,
} from "@/lib/useVoiceRecorder";

/**
 * WhatsApp's voice note control.
 *
 * The interaction, precisely: press and hold the mic to record. Keep holding
 * and the composer is replaced — not accompanied — by a recording bar. Slide
 * left past the threshold and the note is discarded. Slide up and the recording
 * locks, so you can let go and keep talking, at which point the bar grows a
 * stop and a send. Release without either and it sends.
 *
 * "Replaced, not accompanied" is the part the previous control got wrong. It
 * was a toggle button with a permanently-visible timer and cost label beside
 * it, so the composer carried recording chrome at all times and the mic itself
 * was ambiguous — its icon flipped to an X, which reads as "discard", while its
 * handler sent the note. Here the resting state is a single mic, and the
 * recording UI exists only while recording.
 *
 * Everything gestural runs on motion values rather than React state, so the
 * drag itself never re-renders. The two things that do re-render — the timer
 * and the live waveform — are why this is a separate component: at 10 samples a
 * second they would otherwise re-render the entire chat thread.
 */

/** Horizontal travel that discards the take. Matches WhatsApp's feel. */
const CANCEL_DISTANCE = 96;

/** Vertical travel that locks hands-free recording. */
const LOCK_DISTANCE = 76;

/** How many bars the live waveform shows. */
const LIVE_BARS = 28;

function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

type VoiceRecorderProps = {
  /** False while the chat is still locked behind coins. */
  canRecord: boolean;
  /** Coin cost, surfaced in the button title so the price is never a surprise. */
  cost: number;
  /** True while a previous note is still uploading. */
  busy: boolean;
  /** Fired when the user presses the mic on a locked chat. */
  onBlocked: () => void;
  onSend: (recording: VoiceRecording) => void;
  onError: (message: string) => void;
  /** Whether the next note should self-destruct after one listen. */
  viewOnce: boolean;
  onToggleViewOnce: () => void;
};

function VoiceRecorderBase({
  canRecord,
  cost,
  busy,
  onBlocked,
  onSend,
  onError,
  viewOnce,
  onToggleViewOnce,
}: VoiceRecorderProps) {
  const [locked, setLocked] = useState(false);
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);

  const pointerIdRef = useRef<number | null>(null);
  const originRef = useRef({ x: 0, y: 0 });
  const cancelledRef = useRef(false);
  const lockedRef = useRef(false);
  const armedRef = useRef(false);

  const resetGesture = useCallback(() => {
    pointerIdRef.current = null;
    cancelledRef.current = false;
    armedRef.current = false;
    animate(dragX, 0, { duration: 0.18 });
    animate(dragY, 0, { duration: 0.18 });
  }, [dragX, dragY]);

  /**
   * Everything that happens once a take is in hand, whichever way it ended.
   * A recording that hits the five-minute ceiling stops itself rather than
   * being stopped, so it arrives here instead of through `finish()` — without
   * this path a long note would simply vanish at the cap.
   */
  const deliver = useCallback(
    (recording: VoiceRecording | null) => {
      setLocked(false);
      lockedRef.current = false;
      resetGesture();
      if (!recording) return;

      /* A tap that happened to land on the mic isn't a voice note. Discarding
         below the floor is what stops the thread filling with 200ms clips. */
      if (recording.durationMs < MIN_RECORDING_MS) {
        onError("Hold the mic to record a voice note.");
        return;
      }
      vibrate(12);
      onSend(recording);
    },
    [resetGesture, onSend, onError]
  );

  const { status, isRecording, elapsedMs, peaks, error, clearError, start, stop, cancel } =
    useVoiceRecorder({ onAutoStop: deliver });

  /* The cancel hint fades as the finger travels toward the threshold, and the
     trash icon comes up to meet it — the gesture tells you how far you have
     left before it commits. */
  const hintOpacity = useTransform(dragX, [-CANCEL_DISTANCE, -8, 0], [0, 1, 1]);
  const trashScale = useTransform(dragX, [-CANCEL_DISTANCE, 0], [1.35, 1]);
  const lockProgress = useTransform(dragY, [-LOCK_DISTANCE, 0], [1, 0]);

  useEffect(() => {
    if (error) {
      onError(error);
      clearError();
      setLocked(false);
      lockedRef.current = false;
      resetGesture();
    }
  }, [error, onError, clearError, resetGesture]);

  const finish = useCallback(async () => {
    deliver(await stop());
  }, [stop, deliver]);

  const abort = useCallback(() => {
    cancelledRef.current = true;
    cancel();
    setLocked(false);
    lockedRef.current = false;
    resetGesture();
    vibrate([14, 40, 14]);
  }, [cancel, resetGesture]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (busy || isRecording) return;
      if (!canRecord) { onBlocked(); return; }

      /* Capture on the button so the gesture keeps tracking once the finger
         leaves its 40px box — which it does immediately, since the whole
         interaction is about sliding away from it. */
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* unsupported */ }
      pointerIdRef.current = event.pointerId;
      originRef.current = { x: event.clientX, y: event.clientY };
      cancelledRef.current = false;
      armedRef.current = true;

      vibrate(18);
      void start().then((started) => {
        if (!started) { armedRef.current = false; pointerIdRef.current = null; }
      });
    },
    [busy, isRecording, canRecord, onBlocked, start]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (pointerIdRef.current !== event.pointerId || lockedRef.current) return;

      const deltaX = Math.min(0, event.clientX - originRef.current.x);
      const deltaY = Math.min(0, event.clientY - originRef.current.y);

      /* Whichever axis is dominant wins, so a diagonal drag resolves to one
         intent instead of half-committing to both. */
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        dragY.set(Math.max(deltaY, -LOCK_DISTANCE - 24));
        dragX.set(0);
        if (deltaY <= -LOCK_DISTANCE && armedRef.current) {
          lockedRef.current = true;
          setLocked(true);
          vibrate([10, 30, 10]);
          animate(dragX, 0, { duration: 0.16 });
          animate(dragY, 0, { duration: 0.16 });
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
    [dragX, dragY, abort]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (pointerIdRef.current !== event.pointerId) return;
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* unsupported */ }
      pointerIdRef.current = null;

      if (lockedRef.current) return;      // hands-free; the bar takes over
      if (cancelledRef.current) { resetGesture(); return; }
      if (!armedRef.current) { resetGesture(); return; }
      void finish();
    },
    [finish, resetGesture]
  );

  const showBar = isRecording;
  const nearingLimit = elapsedMs > MAX_RECORDING_MS - 15_000;

  return (
    <>
      {showBar && (
        <div className="chat-recording-bar absolute inset-0 z-20 flex items-center gap-2 rounded-2xl px-3">
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

          <span
            className="chat-recording-dot h-2.5 w-2.5 shrink-0 rounded-full"
            aria-hidden="true"
          />

          <span
            className="shrink-0 text-[13px] font-bold tabular-nums"
            style={{ color: nearingLimit ? "var(--theme-danger, #f43f5e)" : "var(--chat-bubble-text)" }}
          >
            {formatDuration(elapsedMs)}
          </span>

          {/* Live level meter. Bars are keyed by slot rather than by value so
              React updates 28 heights instead of rebuilding the row. */}
          <div className="flex h-6 min-w-0 flex-1 items-center gap-[2px] overflow-hidden" aria-hidden="true">
            {Array.from({ length: LIVE_BARS }, (_, index) => {
              const peak = peaks[peaks.length - LIVE_BARS + index] ?? 0;
              return (
                <span
                  key={index}
                  className="chat-recording-level w-[3px] shrink-0 rounded-full"
                  style={{ height: `${Math.max(8, peak * 0.22 + 8)}px` }}
                />
              );
            })}
          </div>

          {locked ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={onToggleViewOnce}
                title={viewOnce ? "Sends as view-once" : "Send as a normal voice note"}
                aria-pressed={viewOnce}
                className={`flex h-9 w-9 items-center justify-center rounded-full ${viewOnce ? "chat-recording-once-on" : "chat-icon"}`}
              >
                <Eye size={16} />
              </button>
              <button
                type="button"
                onClick={() => void finish()}
                disabled={status === "finishing"}
                className="flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-60"
                style={{
                  background: "linear-gradient(135deg, var(--theme-accent-from), var(--theme-accent-to))",
                  color: "var(--theme-accent-contrast)",
                }}
                aria-label="Send voice note"
              >
                {status === "finishing" ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              </button>
            </div>
          ) : (
            <motion.span
              style={{ opacity: hintOpacity }}
              className="chat-meta shrink-0 text-[11px] font-semibold"
            >
              ‹ slide to cancel
            </motion.span>
          )}
        </div>
      )}

      <div className="relative flex shrink-0 items-center">
        {/* Lock affordance. Only meaningful mid-gesture, so it is only mounted
            then — a permanently-present rail is chrome for a state you are
            usually not in. */}
        {showBar && !locked && (
          <motion.div
            style={{ opacity: lockProgress }}
            className="chat-recording-lock pointer-events-none absolute -top-[76px] left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 rounded-full px-2 py-2.5"
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
          onPointerCancel={handlePointerUp}
          onContextMenu={(event) => event.preventDefault()}
          disabled={busy}
          title={canRecord ? `Hold to record a voice note (${cost} coins)` : "Unlock this chat to send voice notes"}
          aria-label={showBar ? "Recording — release to send" : `Hold to record a voice note, ${cost} coins`}
          className={`chat-icon relative z-30 mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition disabled:opacity-60 ${
            showBar ? "chat-recording-mic" : ""
          }`}
        >
          {locked ? <Square size={15} fill="currentColor" /> : <Mic size={18} />}
        </motion.button>
      </div>
    </>
  );
}

export const VoiceRecorder = memo(VoiceRecorderBase);
export default VoiceRecorder;
