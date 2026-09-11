"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronUp, Mic, MicOff, PhoneOff } from "lucide-react";

import { formatCallDuration } from "@/lib/calls/callFormat";
import type { CallStatus } from "@/lib/calls/callSession";
import { spring } from "@/lib/motion";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";

type InCallPillProps = {
  name: string;
  avatarUrl: string;
  status: Exclude<CallStatus, "idle" | "incoming">;
  startedAt: number | null;
  muted: boolean;
  onExpand: () => void;
  onToggleMute: () => void;
  onHangUp: () => void;
};

/**
 * The minimized call: a pill parked at the top of the screen, WhatsApp's shape.
 *
 * Answering a call should not confiscate the app. The full-screen ring does its
 * job — you cannot miss it — and the moment the call is accepted it collapses
 * into this, which keeps the three things a live call actually needs on screen
 * (who, how long, and the two controls you reach for: mute and hang up) while
 * handing the rest of the viewport back. Tapping the pill expands to the full
 * in-call sheet again.
 *
 * MOUNTED BY THE PROVIDER, NOT THE CHAT PAGE
 *
 * That is the whole reason the call engine is a singleton. A pill that lives on
 * the chat page can only float over the chat page; this one is rendered from the
 * root layout, so the call survives navigating to the feed, the inbox, anywhere
 * — the pill is still there when you arrive, still counting, still on.
 *
 * THEME
 *
 * `.call-surface` (globals.css) pins this to the dark call palette in BOTH
 * themes. The generic `[role="dialog"]` surface rule repaints dialogs with the
 * theme's own card colour, which on the light theme is white — a white pill with
 * white text is not a contrast problem, it is an invisible control.
 */
export default function InCallPill({
  name,
  avatarUrl,
  status,
  startedAt,
  muted,
  onExpand,
  onToggleMute,
  onHangUp,
}: InCallPillProps) {
  const reduced = useSafeReducedMotion();
  const [now, setNow] = useState(() => Date.now());

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
        ? "Ringing…"
        : "Connecting…";

  return (
    /* The layer is the animated element, which is what `AnimatePresence` in the
       provider needs: it can only run an exit on its own direct child. That is
       safe here because the pill is centred by flexbox rather than by a
       `translateX(-50%)`, so Framer's `y` is not fighting a transform of its
       own — the whole strip drops in from the top edge and lifts back out. */
    <motion.div
      className="call-pill-layer"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -28 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -24 }}
      transition={spring.snappy}
    >
      <div className="call-pill call-surface" role="group" aria-label={`Voice call with ${name}`}>
        <button type="button" className="call-pill-main" onClick={onExpand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarUrl} alt="" className="call-pill-avatar" />
          <span className="call-pill-text">
            <strong>{name}</strong>
            <small className="tabular-nums">{label}</small>
          </span>
          <ChevronUp size={16} aria-hidden />
        </button>

        <div className="call-pill-actions">
          <motion.button
            type="button"
            onClick={onToggleMute}
            whileTap={reduced ? undefined : { scale: 0.9, transition: spring.snappy }}
            className="call-pill-button"
            data-active={muted ? "true" : undefined}
            aria-label={muted ? "Unmute" : "Mute"}
            aria-pressed={muted}
          >
            {muted ? <MicOff size={17} /> : <Mic size={17} />}
          </motion.button>
          <motion.button
            type="button"
            onClick={onHangUp}
            whileTap={reduced ? undefined : { scale: 0.9, transition: spring.snappy }}
            className="call-pill-button call-pill-end"
            aria-label="End call"
          >
            <PhoneOff size={17} />
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
