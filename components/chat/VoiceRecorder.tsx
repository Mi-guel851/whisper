"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { Mic, Trash2, Send, Lock, ChevronUp, Pause, Play, Eye, Loader2 } from "lucide-react";
import { vibrate } from "@/lib/haptics";
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
 */

const CANCEL_DISTANCE = 96;
const LOCK_DISTANCE = 76;
const HOLD_BARS = 28;
const PANEL_BARS = 44;

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
      vibrate(12);
      onSend(recording);
    },
    [resetGesture, onSend, onError]
  );

  const {
    status, isRecording, isPaused, elapsedMs, peaks, error,
    clearError, start, stop, cancel, pause, resume,
  } = useVoiceRecorder({ onAutoStop: deliver });

  const hintOpacity = useTransform(dragX, [-CANCEL_DISTANCE, -8, 0], [0, 1, 1]);
  const trashScale = useTransform(dragX, [-CANCEL_DISTANCE, 0], [1.35, 1]);
  const lockProgress = useTransform(dragY, [-LOCK_DISTANCE, 0], [1, 0]);

  useEffect(() => {
    if (error) {
      if (error.toLowerCase().includes("access was blocked")) {
         // This is handled by rationale or browser settings
      } else {
         onError(error);
      }
      clearError();
      setLocked(false);
      lockedRef.current = false;
      resetGesture();
    }
  }, [error, onError, clearError, resetGesture]);

  const onRecordingChangeRef = useRef(onRecordingChange);
  useEffect(() => { onRecordingChangeRef.current = onRecordingChange; }, [onRecordingChange]);
  useEffect(() => {
    onRecordingChangeRef.current?.(isRecording);
  }, [isRecording]);

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
    async (event: React.PointerEvent<HTMLButtonElement>) => {
      if (busy || isRecording) return;
      if (!canRecord) { onBlocked(); return; }

      if (Capacitor.isNativePlatform()) {
        const hasPrompted = localStorage.getItem("mic_prompted");
        if (!hasPrompted) {
          setShowMicRationale(true);
          return;
        }
      }

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

      if (lockedRef.current) return;
      if (cancelledRef.current) { resetGesture(); return; }
      if (!armedRef.current) { resetGesture(); return; }
      void finish();
    },
    [finish, resetGesture]
  );

  async function grantMicAccess() {
    setShowMicRationale(false);
    localStorage.setItem("mic_prompted", "true");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      showToast("Microphone ready! Hold to record.");
    } else {
      showToast("Microphone access denied.");
    }
  }

  const holding = isRecording && !locked;
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

      {locked && isRecording && (
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
              className="chat-recording-pause flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-bold"
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
            onPointerCancel={handlePointerUp}
            onContextMenu={(event) => event.preventDefault()}
            disabled={busy}
            title={canRecord ? `Hold to record a voice note (${cost} coins)` : "Unlock this chat to send voice notes"}
            aria-label={holding ? "Recording — release to send" : `Hold to record a voice note, ${cost} coins`}
            className={`chat-send-circle relative z-30 flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full disabled:opacity-60 ${
              holding ? "chat-recording-mic" : ""
            }`}
          >
            <Mic size={21} />
          </motion.button>
        </div>
      )}
    </>
  );
}

export const VoiceRecorder = memo(VoiceRecorderBase);
export default VoiceRecorder;
