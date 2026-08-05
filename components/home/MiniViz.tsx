"use client";

import { motion } from "framer-motion";
import { ease } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

/**
 * The three miniature charts that live inside the feature bento.
 *
 * They share a contract, which is why they share a file:
 *
 *  - **Decorative.** Each is `aria-hidden`; the card's heading and copy carry
 *    the meaning. A screen reader announcing 32 unlabelled waveform bars is
 *    noise, not access.
 *  - **Token-coloured.** Nothing here picks a hex. They inherit the accent
 *    tokens, so the light theme retunes them without a second implementation.
 *  - **Deterministic.** No `Math.random()` at render — the server and the
 *    client would disagree and React would blow the hydration away. Shapes come
 *    from fixed data or a pure function of the index.
 *  - **Draw on view, once.** Motion here is explanatory (this is what a voice
 *    note / a trend / a week of traffic looks like), so it plays when the card
 *    arrives and then holds still.
 */

/* -------------------------------------------------------------------------- */

/**
 * Voice-note waveform.
 *
 * Heights come from two detuned sines multiplied together. A single sine reads
 * as a wave, not as speech; beating two against each other gives the uneven
 * bursts-and-pauses envelope that a real recording has.
 */
export function Waveform({
  bars = 34,
  played = 0.45,
  className = "",
}: {
  bars?: number;
  /** Fraction rendered as already-played, in the accent. */
  played?: number;
  className?: string;
}) {
  const reduced = useSafeReducedMotion();
  const cutoff = Math.round(bars * played);

  return (
    <div
      aria-hidden="true"
      className={`flex h-8 items-center gap-[3px] ${className}`}
    >
      {Array.from({ length: bars }, (_, index) => {
        const envelope = Math.abs(Math.sin(index * 0.62) * Math.cos(index * 0.27));
        const height = 18 + envelope * 82;
        const isPlayed = index < cutoff;

        return (
          <motion.span
            key={index}
            className="w-[3px] shrink-0 rounded-full"
            style={{
              background: isPlayed
                ? "var(--theme-accent-purple)"
                : "color-mix(in srgb, var(--bridge-text-muted) 45%, transparent)",
            }}
            initial={{ height: reduced ? `${height}%` : "12%" }}
            whileInView={{ height: `${height}%` }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{
              duration: reduced ? 0 : 0.5,
              // Sweeps left to right like a playhead rather than every bar
              // popping at once. Capped so a long waveform still finishes fast.
              delay: reduced ? 0 : Math.min(index * 0.016, 0.55),
              ease: ease.outExpo,
            }}
          />
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** A week of engagement, normalised 0–1. Trending up, with a realistic dip. */
const TREND = [0.18, 0.3, 0.24, 0.46, 0.4, 0.62, 0.55, 0.78, 0.72, 0.94];

/**
 * Builds a smoothed path through evenly-spaced points.
 *
 * Quadratic segments anchored at the midpoint between each pair of samples —
 * the cheapest smoothing that stays inside the data's envelope. A cubic through
 * the points themselves overshoots on a sharp dip and draws a trend line that
 * dives below values that were never recorded.
 */
function smoothPath(values: readonly number[], width: number, height: number) {
  const step = width / (values.length - 1);
  const points = values.map((value, index) => ({
    x: index * step,
    y: height - value * height,
  }));

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    const midX = (previous.x + current.x) / 2;
    const midY = (previous.y + current.y) / 2;
    path += ` Q ${previous.x} ${previous.y} ${midX} ${midY}`;
  }
  path += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;

  return { path, last: points[points.length - 1] };
}

export function Sparkline({ className = "" }: { className?: string }) {
  const reduced = useSafeReducedMotion();
  const width = 200;
  const height = 56;
  const { path, last } = smoothPath(TREND, width, height);

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height + 4}`}
      preserveAspectRatio="none"
      className={`h-14 w-full ${className}`}
    >
      <defs>
        {/* Ids are literals, not `useId()`. There is exactly one Sparkline on
            the page; a generated id here would only add a hydration surface. */}
        <linearGradient id="sparkline-stroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--theme-accent-from)" />
          <stop offset="100%" stopColor="var(--theme-accent-purple)" />
        </linearGradient>
        <linearGradient id="sparkline-fill" x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor="var(--theme-accent-purple)"
            stopOpacity="0.32"
          />
          <stop offset="100%" stopColor="var(--theme-accent-purple)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <motion.path
        d={`${path} L ${width} ${height} L 0 ${height} Z`}
        fill="url(#sparkline-fill)"
        initial={{ opacity: reduced ? 1 : 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : 0.55 }}
      />

      {/* Line drawing: the stroke traces itself in. `pathLength={1}` normalises
          the dash units so the offset is a plain 1 → 0 regardless of geometry. */}
      <motion.path
        d={path}
        fill="none"
        stroke="url(#sparkline-stroke)"
        strokeWidth="2.5"
        strokeLinecap="round"
        pathLength={1}
        initial={{ pathLength: reduced ? 1 : 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: reduced ? 0 : 0.9, ease: ease.outExpo }}
      />

      <motion.circle
        cx={last.x}
        cy={last.y}
        r="3.5"
        fill="var(--theme-accent-purple)"
        stroke="var(--theme-bg)"
        strokeWidth="2"
        initial={{ scale: reduced ? 1 : 0 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{
          type: "spring",
          stiffness: 480,
          damping: 18,
          delay: reduced ? 0 : 0.8,
        }}
        style={{ transformOrigin: `${last.x}px ${last.y}px` }}
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */

/** Seven days of views. The final bar is today, and it's the tallest. */
const WEEK = [0.34, 0.52, 0.4, 0.68, 0.58, 0.82, 1];

export function BarChart({ className = "" }: { className?: string }) {
  const reduced = useSafeReducedMotion();

  return (
    <div
      aria-hidden="true"
      className={`flex h-14 items-end gap-1.5 ${className}`}
    >
      {WEEK.map((value, index) => {
        const isToday = index === WEEK.length - 1;

        return (
          <motion.span
            key={index}
            className="flex-1 rounded-t-[3px]"
            style={{
              // Today is the payoff, so it takes the full gradient; the rest
              // recede into a flat tint. Colouring all seven identically loses
              // the "and it's still climbing" read the card is making.
              background: isToday
                ? "linear-gradient(180deg, var(--theme-accent-from), var(--theme-accent-purple))"
                : "color-mix(in srgb, var(--theme-accent-purple) 34%, transparent)",
            }}
            initial={{ height: reduced ? `${value * 100}%` : "8%" }}
            whileInView={{ height: `${value * 100}%` }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{
              duration: reduced ? 0 : 0.55,
              delay: reduced ? 0 : index * 0.055,
              ease: ease.outExpo,
            }}
          />
        );
      })}
    </div>
  );
}
