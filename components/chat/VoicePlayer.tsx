"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Loader2, Mic } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

/**
 * A voice note bubble, WhatsApp-shaped.
 *
 * WhatsApp's version is a scrubbable waveform, not a play button — the shape
 * tells you where the pauses are, and dragging it is how you re-hear the word
 * you missed. View-once notes get the *same* control surface here rather than a
 * "Tap to play once" text link, which is the whole point of the rewrite: a
 * one-shot note is the one you most need to scrub back through, and a link
 * gives you no way to.
 *
 * The one-shot semantics still hold, because they live on the server. Tapping
 * play calls `onRequestViewOnce`, which routes through `/api/audio/view` — that
 * endpoint hands back the bytes, nulls `audio_path`, and deletes the object.
 * From then on the note exists only as a blob URL held by this component, so it
 * is scrubbable for as long as the thread stays open and gone the moment it
 * isn't. Nothing is re-downloadable.
 *
 * Notes with no stored waveform predate capture-time sampling. Rather than show
 * a flat bar or decode the file to recover the shape, they get a deterministic
 * pseudo-waveform seeded from the message id: stable across renders and
 * reloads, and honest about being decoration.
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
  /**
   * Consumes the note server-side and resolves to a playable object URL, or
   * `null` if it couldn't be fetched. Owned by the page because the same call
   * is what marks the row viewed.
   */
  onRequestViewOnce: () => Promise<string | null>;
};

function VoicePlayerBase({
  messageId,
  audioPath,
  durationMs,
  waveform,
  isMe,
  isViewOnce,
  viewedAt,
  onRequestViewOnce,
}: VoicePlayerProps) {
  const bars = useMemo(() => toBars(waveform, messageId), [waveform, messageId]);

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState((durationMs ?? 0) / 1000);
  const [speedIndex, setSpeedIndex] = useState(0);
  /* Set once a view-once note has been fetched into memory. It is what makes
     the difference between "consumed, nothing to play" and "consumed, but this
     tab still holds the bytes and can scrub them". */
  const [unlocked, setUnlocked] = useState(false);
  const [spent, setSpent] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      /* Revoking matters more here than for a normal note: this URL is the only
         remaining copy of a file the server has already deleted. */
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, []);

  /** Wire an element up to component state. Shared by both playback paths. */
  const attach = useCallback((element: HTMLAudioElement) => {
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
    return element;
  }, [speedIndex]);

  /**
   * The bucket is private, so playback needs a signed URL. It is minted on the
   * first play rather than on mount — a thread with forty voice notes would
   * otherwise fire forty signing requests to render a screen showing three.
   */
  const ensureAudio = useCallback(async (): Promise<HTMLAudioElement | null> => {
    if (audioRef.current) return audioRef.current;

    setLoading(true);
    try {
      if (isViewOnce) {
        const url = await onRequestViewOnce();
        if (!url) { setSpent(true); return null; }
        objectUrlRef.current = url;
        setUnlocked(true);
        return attach(new Audio(url));
      }

      if (!audioPath) return null;

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

      return attach(new Audio(url));
    } finally {
      setLoading(false);
    }
  }, [attach, audioPath, isViewOnce, onRequestViewOnce]);

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

  const nudge = useCallback((seconds: number) => {
    const element = audioRef.current;
    if (!element || !Number.isFinite(element.duration)) return;
    element.currentTime = Math.min(element.duration, Math.max(0, element.currentTime + seconds));
    setPosition(element.currentTime);
  }, []);

  /* View-once notes that this tab never opened have nothing to scrub. Everything
     else — including one opened a moment ago — gets the full control surface. */
  const consumed = isViewOnce && !unlocked && (Boolean(viewedAt) || !audioPath || spent);
  const interactive = !consumed && (!isViewOnce || unlocked);
  const canPlay = !consumed && (isViewOnce ? unlocked || Boolean(audioPath) : Boolean(audioPath));

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const playedBars = Math.round(progress * BAR_COUNT);

  /* A note you sent, or one already spent, is a read-only object: same shape so
     the thread doesn't jump, no affordances that would lie about being usable. */
  const inert = consumed || (isViewOnce && isMe && !unlocked);

  return (
    <div className="flex min-w-[210px] max-w-[268px] items-center gap-2.5 py-0.5">
      <button
        type="button"
        onClick={() => { if (!inert) void togglePlayback(); }}
        disabled={inert || loading || !canPlay}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full disabled:opacity-60 ${
          isViewOnce && !unlocked ? "chat-voice-once" : isMe ? "chat-voice-play" : "chat-voice-play-in"
        }`}
      >
        {loading ? (
          <Loader2 size={15} className="animate-spin" />
        ) : inert ? (
          <Mic size={15} />
        ) : playing ? (
          <Pause size={15} fill="currentColor" />
        ) : (
          <Play size={15} fill="currentColor" className="ml-0.5" />
        )}

        {/* WhatsApp's view-once marker: a "1" on the control itself. */}
        {isViewOnce && !consumed && (
          <span className="chat-voice-badge absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black leading-none">
            1
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          ref={trackRef}
          role={interactive ? "slider" : undefined}
          tabIndex={interactive ? 0 : -1}
          aria-label={interactive ? "Seek voice note" : undefined}
          aria-valuemin={interactive ? 0 : undefined}
          aria-valuemax={interactive ? Math.round(duration) : undefined}
          aria-valuenow={interactive ? Math.round(position) : undefined}
          onPointerDown={(event) => {
            if (!interactive || !audioRef.current) return;
            /* Capture so the drag keeps tracking past the bubble's edges — the
               track is ~120px wide and a thumb easily leaves it mid-scrub. */
            event.currentTarget.setPointerCapture(event.pointerId);
            wasPlayingRef.current = !audioRef.current.paused;
            audioRef.current.pause();
            seekFromPointer(event.clientX);
          }}
          onPointerMove={(event) => {
            if (interactive && event.currentTarget.hasPointerCapture(event.pointerId)) {
              seekFromPointer(event.clientX);
            }
          }}
          onPointerUp={(event) => {
            if (!interactive) return;
            event.currentTarget.releasePointerCapture(event.pointerId);
            /* Resume only if the scrub interrupted playback. Scrubbing a paused
               note should leave it paused where you put it. */
            if (wasPlayingRef.current) void audioRef.current?.play().catch(() => {});
            wasPlayingRef.current = false;
          }}
          onKeyDown={(event) => {
            if (!interactive) return;
            if (event.key === "ArrowRight") { event.preventDefault(); nudge(5); }
            if (event.key === "ArrowLeft") { event.preventDefault(); nudge(-5); }
          }}
          className={`flex h-8 items-center gap-[2px] ${interactive ? "cursor-pointer touch-none" : "opacity-70"}`}
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
          <span className="tabular-nums">
            {formatClock(position > 0 ? position : duration)}
          </span>

          {consumed ? (
            <span className="italic">Played</span>
          ) : isViewOnce && !unlocked ? (
            <span className="font-bold uppercase tracking-wide">
              {isMe ? "Sent · once" : "Once"}
            </span>
          ) : (
            <button
              type="button"
              onClick={cycleSpeed}
              className="chat-voice-speed rounded-full px-1.5 py-0.5 text-[9px] font-black"
              aria-label={`Playback speed ${SPEEDS[speedIndex]}x`}
            >
              {SPEEDS[speedIndex]}×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export const VoicePlayer = memo(VoicePlayerBase);
export default VoicePlayer;

