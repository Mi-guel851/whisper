"use client";

import { motion } from "framer-motion";
import { Flame, Trophy } from "lucide-react";

import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { spring, tween } from "@/lib/motion";
import { milestoneProgress, nextMilestone, type WhisperStreak } from "@/lib/useWhisperStreak";

/**
 * The streak detail panel.
 *
 * Presentational only — it takes a streak and draws it. The check-in and the
 * numbers live in `useWhisperStreak`, so this can be dropped into the nav
 * popover, a settings screen, or a share sheet without any of them starting
 * their own duplicate check-in.
 *
 * It is not on the dashboard column by choice: that column is already dense, and
 * a streak belongs where a status indicator belongs — in the chrome, glanceable,
 * with the detail one tap away.
 */

type StreakCardProps = {
  streak: WhisperStreak;
  className?: string;
};

/**
 * What to say about the streak.
 *
 * Deliberately not congratulatory at 1. "1 day streak! 🔥" on someone's first
 * visit is the tone the brief called a cheap gamification system — it announces
 * an achievement that hasn't happened. It reads as a beginning at 1 and earns
 * enthusiasm once there is something to be enthusiastic about.
 */
function subtitleFor(current: number, longest: number): string {
  if (current <= 1) return "Come back tomorrow to start a streak";
  if (current < 3) return "Two days in — one more for your first milestone";
  if (current >= longest) return "This is your longest streak yet";
  return `Your best is ${longest} days`;
}

export default function StreakCard({ streak, className = "" }: StreakCardProps) {
  const reduced = useSafeReducedMotion();
  const target = nextMilestone(streak.current);
  const progress = milestoneProgress(streak.current);
  const lit = streak.current >= 3;

  return (
    <div className={className}>
      <div className="flex items-center gap-3.5">
        {/* The flame is the only thing here that moves on its own, and only once
            the streak is real. A pulsing icon beside "1 day" would be drawing
            attention to nothing. */}
        <motion.span
          className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
          style={{
            background: lit
              ? "linear-gradient(135deg, rgba(251,146,60,0.28), rgba(236,72,153,0.22))"
              : "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
          animate={reduced || !lit ? undefined : { scale: [1, 1.045, 1] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
        >
          <Flame size={23} className={lit ? "text-orange-300" : "text-white/35"} />
        </motion.span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <motion.span
              key={streak.current}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring.snappy}
              className="text-2xl font-black leading-none tabular-nums text-white"
            >
              {streak.current}
            </motion.span>
            <span className="text-sm font-bold text-white/70">
              day{streak.current === 1 ? "" : "s"}
            </span>
          </div>
          <p className="mt-1 text-[11.5px] leading-snug theme-text-subtle">
            {subtitleFor(streak.current, streak.longest)}
          </p>
        </div>

        {streak.longest >= 3 && (
          <span className="flex shrink-0 items-center gap-1 self-start rounded-full bg-white/[0.06] px-2 py-1 text-[10.5px] font-bold text-white/60">
            <Trophy size={10} className="text-amber-300" />
            <span className="tabular-nums">{streak.longest}</span>
          </span>
        )}
      </div>

      {target && (
        <div className="mt-3.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="theme-text-subtle">Next milestone</span>
            <span className="font-bold tabular-nums text-white/70">
              {streak.current}/{target}
            </span>
          </div>
          {/* Track plus a scaled fill rather than an animated width: scaleX is
              composited, width relayouts every frame. */}
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <motion.div
              className="h-full w-full origin-left rounded-full"
              style={{ background: "linear-gradient(90deg, #fb923c, #ec4899)" }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: Math.max(0.02, progress) }}
              transition={reduced ? { duration: 0 } : { ...tween.base, duration: 0.7 }}
            />
          </div>
        </div>
      )}

      {/* Shown only on the visit where the coins were actually credited — the
          server reports a milestone once and never again, so this cannot become
          a permanent banner congratulating an old achievement. */}
      {streak.milestone !== null && streak.coins > 0 && (
        <motion.p
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={tween.base}
          className="mt-3 rounded-xl bg-amber-400/10 px-3 py-2 text-[11.5px] font-semibold leading-snug text-amber-200"
        >
          {streak.milestone}-day streak reached — {streak.coins} coins added to your wallet
        </motion.p>
      )}
    </div>
  );
}
