"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Flame } from "lucide-react";

import useWhisperStreak from "@/lib/useWhisperStreak";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { spring } from "@/lib/motion";
import GlassPanel from "./GlassPanel";
import StreakCard from "./StreakCard";

/**
 * The streak indicator in the dashboard header.
 *
 * A streak belongs in the chrome, not in the content column: it is status, it is
 * checked at a glance, and the dashboard column is already dense enough without a
 * full card competing with the link, the prompt and the chart. So it reads as a
 * flame and a number beside the notification bell, with the detail one tap away.
 *
 * The chip is a real control, not decoration — tapping it opens the progress
 * panel. That distinction matters: a number sitting in a nav bar that ignores
 * taps is the kind of dead affordance the brief rules out, and the one thing
 * everyone wants to know about a streak ("how far to the next milestone?") is
 * exactly what a bare number cannot say.
 *
 * It renders nothing until the streak is real. `useWhisperStreak` returns null
 * both before the round trip and when the migration has not been applied, so the
 * header simply has one fewer control rather than a chip showing a hollow zero.
 */
export default function StreakChip() {
  const streak = useWhisperStreak();
  const reduced = useSafeReducedMotion();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  /* Dismissal: outside pointer or Escape. Bound only while open, so a closed
     chip costs no document listeners — there are several of these header
     controls and they all mount on every dashboard visit. */
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!streak) return null;

  const lit = streak.current >= 3;
  /* A milestone reached on this very visit is worth surfacing without a tap —
     the coins have already landed and the panel is where that is explained. */
  const celebrating = streak.milestone !== null && streak.coins > 0;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        /* No vibrate() call here on purpose: ClickHaptics already buzzes every
           interactive element from one delegated pointerdown listener, so a local
           call would drive the motor twice for a single press. */
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${streak.current} day streak. Show progress`}
        className="relative inline-flex h-10 items-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 px-2.5 text-white transition hover:bg-white/10"
      >
        <motion.span
          className="flex items-center"
          /* The glow lives on the icon, not the chip, so the pulse cannot make
             the header's layout breathe. */
          animate={reduced || !lit ? undefined : { scale: [1, 1.1, 1] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
        >
          <Flame
            size={17}
            /* `text-white opacity-*`, not `text-white/45`: the opacity modifier
               compiles to its own class, which the theme bridge in globals.css
               does not rewrite, so an unlit flame stayed literally white and
               vanished into the light theme's header. Opacity fades the bridged
               colour instead of replacing it. */
            className={lit ? "text-orange-300" : "text-white opacity-50"}
            fill={lit ? "currentColor" : "none"}
          />
        </motion.span>
        <span className="text-sm font-black tabular-nums leading-none">
          {streak.current}
        </span>

        {celebrating && (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 shadow-lg shadow-amber-500/40" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={spring.snappy}
            /* Anchored to the chip's right edge so it grows out of its trigger
               rather than from nowhere, and `origin-top-right` keeps the scale
               reading as the same object opening. */
            className="absolute right-0 top-12 z-50 w-[272px] origin-top-right"
          >
            <GlassPanel strong className="rounded-2xl p-4" elevation={5}>
              <StreakCard streak={streak} />
            </GlassPanel>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
