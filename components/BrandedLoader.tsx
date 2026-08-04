"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { ease } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

/**
 * Full-screen loading gate.
 *
 * Replaces bare `<p>Loading...</p>` blocks. Two details matter here:
 *
 * 1. It fades in after ~250ms rather than appearing instantly. A session check
 *    that resolves from cache in 40ms would otherwise flash a full-screen
 *    splash and rip it away — worse than showing nothing at all.
 * 2. The ring spins fast (0.75s). A faster spinner makes the same wait feel
 *    shorter; this is perceived performance, and it's free.
 */
export default function BrandedLoader({
  label = "Loading",
  /** Set false for an inline gate inside an already-rendered shell. */
  fullScreen = true,
}: {
  label?: string;
  fullScreen?: boolean;
}) {
  const reduced = useSafeReducedMotion();

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        fullScreen
          ? "theme-bg-gradient flex min-h-screen flex-col items-center justify-center gap-5"
          : "flex flex-col items-center justify-center gap-5 py-16"
      }
    >
      <motion.div
        className="relative grid h-16 w-16 place-items-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.25, ease: ease.outQuint }}
      >
        {/* Rotating arc. A conic gradient masked to a ring reads as a smooth
            sweep rather than the hard-edged segment a border-based spinner
            gives you. */}
        {!reduced && (
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0deg, var(--theme-accent-purple) 300deg, var(--theme-accent-from) 360deg)",
              mask: "radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2.5px))",
              WebkitMask:
                "radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2.5px))",
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 0.75, repeat: Infinity, ease: "linear" }}
          />
        )}

        <motion.div
          animate={reduced ? undefined : { scale: [1, 1.07, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        >
          <Image src="/ghost.png" alt="" width={34} height={34} priority />
        </motion.div>
      </motion.div>

      <motion.p
        className="text-sm font-medium"
        style={{ color: "var(--theme-text-muted)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.35, ease: ease.outQuint }}
      >
        {label}
      </motion.p>
    </div>
  );
}
