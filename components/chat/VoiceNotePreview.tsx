"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Pause, Play, Send, Trash2 } from "lucide-react";
import { spring, tween } from "@/lib/motion";
import { vibrate, HAPTIC } from "@/lib/haptics";
import type { VoiceRecording } from "@/lib/useVoiceRecorder";

/**
 * The recording you just made, before it goes anywhere.
 *
 * WHY THIS EXISTS
 *
 * Releasing the mic used to send immediately. That is the wrong default for the one
 * message type you cannot proofread: you do not know what a voice note sounds like
 * until you hear it, and the failure modes are all invisible at record time — the
 * first word clipped by the press, a siren going past, the mic muffled by a thumb,
 * a sentence restarted halfway. Every other messenger — WhatsApp, Telegram, Signal,
 * iMessage — lets you listen first, and the reason is that an unheard voice note is
 * the only message people regularly wish they could unsend.
 *
 * WHY IT IS NOT `VoicePlayer`
 *
 * That component plays a *sent* message: it takes a `messageId` and an `audioPath`,
 * resolves a signed URL from storage, and understands view-once state. None of that
 * exists yet here — the audio is a local `Blob` that has never been uploaded, and
 * may never be. Reusing it would mean threading "not saved anywhere" through a
 * component whose whole job is fetching saved things.
 *
 * WHY THE WAVEFORM IS THE RECORDER'S OWN
 *
 * `VoiceRecording.waveform` was already sampled live during capture, so drawing it
 * costs nothing and — more importantly — it is the *same* shape the recipient will
 * see next to the sent message. Decoding the blob to redraw it would risk a preview
 * that looks different from the thing it is previewing.
 */

type VoiceNotePreviewProps = {
  recording: VoiceRecording;
  /** True while the upload is in flight, so the controls cannot be double-fired. */
  sending: boolean;
  cost: number;
  onSend: () => void;
  onDiscard: () => void;
};

function formatDuration(ms: number) {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** A fixed number of bars, resampled from however many peaks were captured. */
const BARS = 34;

function resample(peaks: number[], count: number): number[] {
  if (peaks.length === 0) return Array.from({ length: count }, () => 6);
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index * peaks.length) / count);
    const end = Math.max(start + 1, Math.floor(((index + 1) * peaks.length) / count));
    let peak = 0;
    for (let i = start; i < end && i < peaks.length; i += 1) {
      peak = Math.max(peak, peaks[i] ?? 0);
    }
    // Floored so a silent stretch still reads as a bar rather than a gap.
    return Math.max(6, Math.min(100, peak));
  });
}

function VoiceNotePreviewBase({
  recording,
  sending,
  cost,
  onSend,
  onDiscard,
}: VoiceNotePreviewProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  /** 0-1 through the clip, for the played/unplayed split on the waveform. */
  const [progress, setProgress] = useState(0);

  const bars = resample(recording.waveform, BARS);

  /*
   * One object URL per blob, revoked on unmount.
   *
   * Created in an effect rather than inline in `src`: a render-time
   * `URL.createObjectURL` leaks a URL on every re-render, and this component
   * re-renders on every timeupdate while playing — which is several times a second.
   */
  useEffect(() => {
    const url = URL.createObjectURL(recording.blob);
    const audio = new Audio(url);
    audioRef.current = audio;

    const onEnded = () => {
      setPlaying(false);
      setProgress(0);
      /* Rewound so the play button means "play it again" rather than doing nothing
         because the cursor is parked at the end. */
      audio.currentTime = 0;
    };
    const onTime = () => {
      /*
       * `recording.durationMs` rather than `audio.duration`.
       *
       * A MediaRecorder blob routinely reports `Infinity` or NaN for duration in
       * Chromium because the container is written without a length header, and
       * dividing by that puts the progress bar at zero for the whole clip. The
       * recorder measured the real elapsed time as it captured, so that is the
       * number that works everywhere.
       */
      const total = recording.durationMs / 1000;
      if (total > 0) setProgress(Math.min(1, audio.currentTime / total));
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", onTime);

    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", onTime);
      audio.pause();
      audioRef.current = null;
      URL.revokeObjectURL(url);
    };
  }, [recording.blob, recording.durationMs]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    vibrate(HAPTIC.tap);

    if (audio.paused) {
      void audio.play().then(() => setPlaying(true)).catch(() => {
        /* Autoplay policy, or a codec the WebView cannot decode. Nothing to say
           that the user can act on — the send path is unaffected. */
        setPlaying(false);
      });
    } else {
      audio.pause();
      setPlaying(false);
    }
  }, []);

  const played = Math.round(progress * BARS);

  return (
    <motion.div
      className="voice-preview"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={tween.base}
    >
      <button
        type="button"
        onClick={onDiscard}
        disabled={sending}
        aria-label="Discard recording"
        className="voice-preview-discard"
      >
        <Trash2 size={17} strokeWidth={2.2} aria-hidden />
      </button>

      <button
        type="button"
        onClick={toggle}
        disabled={sending}
        aria-label={playing ? "Pause" : "Play recording"}
        className="voice-preview-play"
      >
        {playing ? (
          <Pause size={16} strokeWidth={2.6} aria-hidden />
        ) : (
          <Play size={16} strokeWidth={2.6} aria-hidden />
        )}
      </button>

      {/* Decorative: the control is the play button and the time is text, so the
          bars carry no information a screen reader needs repeated. */}
      <div className="voice-preview-wave" aria-hidden>
        {bars.map((height, index) => (
          <span
            key={index}
            className={`voice-preview-bar${index < played ? " is-played" : ""}`}
            style={{ height: `${height}%` }}
          />
        ))}
      </div>

      <span className="voice-preview-time tabular-nums">
        {formatDuration(playing || progress > 0
          ? progress * recording.durationMs
          : recording.durationMs)}
      </span>

      <motion.button
        type="button"
        onClick={() => {
          vibrate(HAPTIC.select);
          onSend();
        }}
        disabled={sending}
        aria-label={`Send voice note (${cost} coins)`}
        className="voice-preview-send"
        whileTap={{ scale: 0.92 }}
        transition={spring.snappy}
      >
        <Send size={16} strokeWidth={2.4} aria-hidden />
      </motion.button>
    </motion.div>
  );
}

export const VoiceNotePreview = memo(VoiceNotePreviewBase);
export default VoiceNotePreview;
