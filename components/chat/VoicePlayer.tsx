"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Loader2, Eye, Mic } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

/**
 * A voice note bubble.
 *
 * WhatsApp's version is a scrubbable waveform, not a play button — the shape
 * tells you where the pauses are, and dragging it is how you re-hear the word
 * you missed. This is that, with two Whisper-specific cases folded in:
 *
 * - **View-once notes** can't be scrubbed, because the file is consumed by the
 *   act of playing it. They keep their own affordance and route through the
 *   API, which is what deletes the object server-side.
 * - **Notes with no stored waveform** predate the capture-time sampling. Rather
 *   than show a flat bar or decode the file client-side to recover the shape,
 *   they get a deterministic pseudo-waveform seeded from the message id: stable
 *   across renders and reloads, and honest about being decoration.
 */

const BAR_COUNT = 34;

/** Playback speeds, in the order tapping cycles them. */
const SPEEDS = [1, 1.5, 2] as const;

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, "0")}`;
}

/**
 * A stable, id-derived waveform for legacy rows. xorshift rather than
 * `Math.random` so the same message always draws the same shape — a bubble
 * whose waveform reshuffles on every re-render reads as broken.
 */
function fallbackWaveform(seed: string) {
  let state = 0;
  for (let i = 0; i < seed.length; i += 1) state = (state * 31 + seed.charCodeAt(i)) >>> 0;
  const bars: number[] = [];
  for (let i = 0; i < BAR_COUNT; i += 1) {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    bars.push(28 + (state % 60));
  }
  return bars;
}

/** Resample the captured peaks down to the bar count the bubble draws. */
function toBars(waveform: number[] | null | undefined, seed: string) {
  if (!waveform || waveform.length === 0) return fallbackWaveform(seed);
  if (waveform.length <= BAR_COUNT) {
    /* Short notes: stretch rather than pad, so a 2-second clip still fills the
       bubble instead of trailing off into empty slots. */
    return Array.from({ length: BAR_COUNT }, (_, index) => {
      const source = Math.floor((index / BAR_COUNT) * waveform.length);
      return waveform[Math.min(source, waveform.length - 1)] ?? 8;
    });
  }
  const bucket = waveform.length / BAR_COUNT;
  return Array.from({ length: BAR_COUNT }, (_, index) => {
    const from = Math.floor(index * bucket);
    const to = Math.floor((index + 1) * bucket);
    let peak = 0;
    for (let i = from; i < to; i += 1) if (waveform[i] > peak) peak = waveform[i];
    return peak;
  });
}

type VoicePlayerProps = {
  messageId: string;
  audioPath: string | null;
  durationMs: number | null;
  waveform: number[] | null;
  isMe: boolean;
  isViewOnce: boolean;
  viewedAt: string | null;
  /** View-once playback is server-mediated; the page owns that request. */
  onPlayViewOnce: () => void;
  viewOnceLoading: boolean;
  viewOncePlaying: boolean;
};

function VoicePlayerBase({
  messageId,
  audioPath,
  durationMs,
  waveform,
  isMe,
  isViewOnce,
  viewedAt,
  onPlayViewOnce,
  viewOnceLoading,
  viewOncePlaying,
}: VoicePlayerProps) {
  const bars = useMemo(() => toBars(waveform, messageId), [waveform, messageId]);

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState((durationMs ?? 0) / 1000);
  const [speedIndex, setSpeedIndex] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      urlRef.current = null;
    };
  }, []);

  /**
   * The bucket is private, so playback needs a signed URL. It is minted on the
   * first play rather than on mount — a thread with forty voice notes would
   * otherwise fire forty signing requests to render a screen showing three.
   */
  const ensureAudio = useCallback(async (): Promise<HTMLAudioElement | null> => {
    if (audioRef.current) return audioRef.current;
    if (!audioPath) return null;

    setLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from("voice-messages")
        .createSignedUrl(audioPath, 60 * 60);

      let url = data?.signedUrl ?? null;
      if (error || !url) {
        /* Notes sent before the dedicated bucket existed still live in the
           photo bucket. Falling back keeps that history playable. */
        const legacy = await supabase.storage
          .from("view-once-photos")
          .createSignedUrl(audioPath, 60 * 60);
        url = legacy.data?.signedUrl ?? null;
      }
      if (!url) return null;

      const element = new Audio(url);
      element.preload = "metadata";
      element.playbackRate = SPEEDS[speedIndex];
      element.onloadedmetadata = () => {
        if (Number.isFinite(element.duration) && element.duration > 0) setDuration(element.duration);
      };
      element.ontimeupdate = () => setPosition(element.currentTime);
      element.onended = () => { setPlaying(false); setPosition(0); element.currentTime = 0; };
      element.onpause = () => setPlaying(false);
      element.onplay = () => setPlaying(true);

      audioRef.current = element;
      urlRef.current = url;
      return element;
    } finally {
      setLoading(false);
    }
  }, [audioPath, speedIndex]);

  const togglePlayback = useCallback(async () => {
    const element = await ensureAudio();
    if (!element) return;
    if (element.paused) {
      try { await element.play(); } catch { setPlaying(false); }
    } else {
      element.pause();
    }
  }, [ensureAudio]);

  const seekFromPointer = useCallback((clientX: number) => {
    const track = trackRef.current;
    const element = audioRef.current;
    if (!track || !element || !Number.isFinite(element.duration)) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    element.currentTime = ratio * element.duration;
    setPosition(element.currentTime);
  }, []);

  const cycleSpeed = useCallback(() => {
    setSpeedIndex((current) => {
      const next = (current + 1) % SPEEDS.length;
      if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
      return next;
    });
  }, []);

  // --- View-once ------------------------------------------------------------

  if (isViewOnce) {
    const consumed = Boolean(viewedAt) || !audioPath;
    return (
      <div className="flex min-w-[190px] items-center gap-2.5 py-0.5">
        <span className="chat-voice-once flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
          {viewOnceLoading ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          {consumed ? (
            <p className="chat-meta text-[13px] italic">Voice note played</p>
          ) : isMe ? (
            <p className="chat-meta text-[13px]">Voice note sent · view once</p>
          ) : (
            <button
              type="button"
              onClick={onPlayViewOnce}
              disabled={viewOnceLoading || viewOncePlaying}
              className="text-left text-[13px] font-bold disabled:opacity-60"
              style={{ color: "var(--theme-accent-purple)" }}
            >
              {viewOncePlaying ? "Playing…" : viewOnceLoading ? "Loading…" : "Tap to play once"}
            </button>
          )}
          <p className="chat-meta mt-0.5 flex items-center gap-1 text-[10px]">
            <Eye size={10} /> {durationMs ? formatClock(durationMs / 1000) : "Plays once"}
          </p>
        </div>
      </div>
    );
  }

  // --- Normal voice note ----------------------------------------------------

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const playedBars = Math.round(progress * BAR_COUNT);

  return (
    <div className="flex min-w-[200px] max-w-[260px] items-center gap-2.5 py-0.5">
      <button
        type="button"
        onClick={() => void togglePlayback()}
        disabled={loading || !audioPath}
        className="chat-voice-play flex h-9 w-9 shrink-0 items-center justify-center rounded-full disabled:opacity-60"
        aria-label={playing ? "Pause voice note" : "Play voice note"}
      >
        {loading ? (
          <Loader2 size={15} className="animate-spin" />
        ) : playing ? (
          <Pause size={15} fill="currentColor" />
        ) : (
          <Play size={15} fill="currentColor" className="ml-0.5" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Seek voice note"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(position)}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            seekFromPointer(event.clientX);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromPointer(event.clientX);
          }}
          onKeyDown={(event) => {
            const element = audioRef.current;
            if (!element) return;
            if (event.key === "ArrowRight") element.currentTime = Math.min(element.duration, element.currentTime + 5);
            if (event.key === "ArrowLeft") element.currentTime = Math.max(0, element.currentTime - 5);
          }}
          className="flex h-8 cursor-pointer items-center gap-[2px] touch-none"
        >
          {bars.map((peak, index) => (
            <span
              key={index}
              className={`w-[3px] flex-1 rounded-full ${index < playedBars ? "chat-voice-bar-on" : "chat-voice-bar"}`}
              style={{ height: `${Math.max(4, Math.round(peak * 0.24) + 4)}px` }}
            />
          ))}
        </div>

        <div className="chat-meta mt-0.5 flex items-center gap-2 text-[10px] leading-none">
          <span className="tabular-nums">{formatClock(playing || position > 0 ? position : duration)}</span>
          <button
            type="button"
            onClick={cycleSpeed}
            className="chat-voice-speed rounded-full px-1.5 py-0.5 text-[9px] font-black"
            aria-label={`Playback speed ${SPEEDS[speedIndex]}x`}
          >
            {SPEEDS[speedIndex]}×
          </button>
        </div>
      </div>
    </div>
  );
}

export const VoicePlayer = memo(VoicePlayerBase);
export default VoicePlayer;
