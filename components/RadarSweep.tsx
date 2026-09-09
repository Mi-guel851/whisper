"use client";

import { motion } from "framer-motion";
import { Ghost } from "lucide-react";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import { spring } from "@/lib/motion";

type RadarSweepProps = {
  /**
   * How long the parent will keep the sweep on screen, in ms. The sweep's
   * rotation is tuned so one full turn fills that window — the scan reads as
   * "it swept the ring" rather than "it spun while waiting on a fetch".
   */
  durationMs?: number;
};

const DEFAULT_SWEEP_MS = 2500;

/**
 * The Find a Match scan: concentric rings plus a rotating sweep wedge, the
 * product's ghost at the centre.
 *
 * Presentational on purpose — the parent owns the timer (the sweep is the
 * MINIMUM perceived duration, and the RPC may land earlier, so nobody couples
 * "animation finished" to "data arrived" in both directions at once).
 *
 * Motion is stripped for `prefers-reduced-motion` the app-wide way: no
 * rotation, a static wedge, and the same duration — the wait is a network
 * wait, not a decoration, so reduced-motion users lose the spin, not the scan.
 */
export default function RadarSweep({ durationMs = DEFAULT_SWEEP_MS }: RadarSweepProps) {
  const reduced = useSafeReducedMotion();
  const turnSeconds = durationMs / 1000;
  const turns = Math.max(1, Math.round(durationMs / (turnSeconds * 1000)));

  return (
    <div className="flex flex-col items-center gap-5">
      <div
        className="relative flex items-center justify-center"
        style={{ width: 220, height: 220 }}
        role="img"
        aria-label="Scanning for people near you"
      >
        {/* The rings. Three, evenly spaced, the outermost the faintest — a
            radar reads by falloff, and the ghost motif carries the centre. */}
        {[1.0, 0.72, 0.44].map((scale, index) => (
          <div
            key={scale}
            className="absolute rounded-full"
            style={{
              width: 220 * scale,
              height: 220 * scale,
              border: "1px solid color-mix(in srgb, var(--theme-accent-from) 38%, transparent)",
              background: `radial-gradient(circle, transparent 62%, color-mix(in srgb, var(--theme-accent-from) ${14 - index * 4}%, transparent) 100%)`,
            }}
          />
        ))}

        {/* The sweep: a conic wedge over the full disc, rotated. One full
            turn per durationMs so the last pixel of the sweep lands exactly
            when the list reveals. */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background: reduced
              ? "conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--theme-accent-from) 26%, transparent) 70deg, transparent 120deg)"
              : "conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--theme-accent-from) 30%, transparent) 80deg, transparent 140deg)",
            WebkitMaskImage: "radial-gradient(circle, black 0%, black 100%)",
          }}
          initial={reduced ? false : { rotate: 0 }}
          animate={reduced ? undefined : { rotate: 360 * turns }}
          transition={
            reduced
              ? { duration: 0 }
              : { duration: turnSeconds * turns, ease: "linear" }
          }
        />

        {/* Centre ghost, breathing on a spring — the scan's "heart". */}
        <motion.div
          className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full"
          style={{
            background: "color-mix(in srgb, var(--theme-accent-from) 18%, transparent)",
            border: "1px solid color-mix(in srgb, var(--theme-accent-from) 45%, transparent)",
            color: "var(--theme-accent-from)",
          }}
          animate={reduced ? undefined : { scale: [1, 1.08, 1] }}
          transition={reduced ? { duration: 0 } : { ...spring.smooth, duration: 1.4, repeat: turns }}
        >
          <Ghost size={26} />
        </motion.div>
      </div>

      <p className="text-sm font-semibold" style={{ color: "var(--theme-text-muted)" }}>
        Scanning nearby whispers…
      </p>
    </div>
  );
}
