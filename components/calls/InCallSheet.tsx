"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Mic, MicOff, PhoneOff, Volume2, VolumeX } from "lucide-react";

import { formatCallDuration } from "@/lib/calls/callFormat";
import type { CallStatus } from "@/lib/calls/useVoiceCall";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { spring } from "@/lib/motion";

type InCallSheetProps = {
  name: string;
  avatarUrl: string;
  status: Exclude<CallStatus, "idle" | "incoming">;
  startedAt: number | null;
  muted: boolean;
  speakerSupported: boolean;
  speakerOn: boolean;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onHangUp: () => void;
};

/**
 * The in-call sheet: who, how long, mute, speaker, end.
 *
 * A bottom sheet rather than a modal because a call is a background fact
 * while the thread is still the foreground thought — the sheet holds the
 * call and the chat stays visible underneath, the way a phone's in-call bar
 * coexists with everything else on the home screen.
 *
 * The timer starts when the call CONNECTS (startedAt), not when it is
 * dialed: a 40-second ring is "Calling…", not "0:40" of a conversation that
 * never happened.
 */
export default function InCallSheet({
  name,
  avatarUrl,
  status,
  startedAt,
  muted,
  speakerSupported,
  speakerOn,
  onToggleMute,
  onToggleSpeaker,
  onHangUp,
}: InCallSheetProps) {
  const reduced = useSafeReducedMotion();
  const [now, setNow] = useState(() => Date.now());

  /* Tick only while connected: before that there is no number to show, and
     a per-second re-render for "Connecting…" is pure cost. */
  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const label =
    status === "in_call"
      ? startedAt !== null
        ? formatCallDuration(now - startedAt)
        : "0:00"
      : status === "outgoing"
        ? "Calling…"
        : "Connecting…";

  return (
    <motion.div
      className="fixed inset-x-0 bottom-0 z-[60] px-3 pb-3"
      initial={reduced ? { opacity: 0 } : { y: "100%" }}
      animate={reduced ? { opacity: 1 } : { y: 0 }}
      transition={reduced ? { duration: 0 } : spring.gentle}
    >
      <div
        className="mx-auto w-full max-w-md rounded-3xl p-5 shadow-2xl"
        style={{
          background: "var(--theme-glass-strong)",
          border: "1px solid var(--theme-glass-border)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
        }}
      >
        <div className="flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarUrl}
            alt=""
            className="h-16 w-16 rounded-full object-cover"
            style={{ border: "1px solid var(--theme-glass-border)", background: "var(--fill-2)" }}
          />
          <p className="mt-2.5 text-base font-black">{name}</p>
          <p
            className="mt-0.5 text-sm font-semibold tabular-nums"
            style={{ color: status === "in_call" ? "var(--theme-success)" : "var(--theme-text-muted)" }}
          >
            {label}
          </p>
        </div>

        <div className="mt-5 flex items-center justify-center gap-5">
          <motion.button
            type="button"
            onClick={onToggleMute}
            whileTap={reduced ? undefined : { scale: 0.9, transition: spring.snappy }}
            className="flex h-14 w-14 items-center justify-center rounded-full"
            style={{
              background: muted
                ? "color-mix(in srgb, #a855f7 26%, transparent)"
                : "rgba(255,255,255,0.08)",
              color: muted ? "#d8b4fe" : "var(--theme-text-secondary)",
              border: "1px solid var(--theme-glass-border)",
            }}
            aria-label={muted ? "Unmute" : "Mute"}
            aria-pressed={muted}
          >
            {muted ? <MicOff size={22} /> : <Mic size={22} />}
          </motion.button>

          {/* The speaker control exists only where the platform exposes an
              output device to switch (setSinkId, desktop). On mobile the
              WebRTC audio follows the OS call-routing switch, and a button
              that cannot route audio is a promise the UI makes twice —
              once on screen, once in the "why didn't it work" report. */}
          {speakerSupported && (
            <motion.button
              type="button"
              onClick={onToggleSpeaker}
              whileTap={reduced ? undefined : { scale: 0.9, transition: spring.snappy }}
              className="flex h-14 w-14 items-center justify-center rounded-full"
              style={{
                background: speakerOn
                  ? "color-mix(in srgb, #22d3ee 26%, transparent)"
                  : "rgba(255,255,255,0.08)",
                color: speakerOn ? "#67e8f9" : "var(--theme-text-secondary)",
                border: "1px solid var(--theme-glass-border)",
              }}
              aria-label={speakerOn ? "Speaker off" : "Speaker on"}
              aria-pressed={speakerOn}
            >
              {speakerOn ? <Volume2 size={22} /> : <VolumeX size={22} />}
            </motion.button>
          )}

          <motion.button
            type="button"
            onClick={onHangUp}
            whileTap={reduced ? undefined : { scale: 0.9, transition: spring.snappy }}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg"
            aria-label="End call"
          >
            <PhoneOff size={22} />
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
