"use client";

import { motion } from "framer-motion";
import { Check, Coins, Flame, Trophy } from "lucide-react";

import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { spring, tween } from "@/lib/motion";
import type { WhisperStreak } from "@/lib/useWhisperStreak";
import Button from "./Button";

/**
 * The streak detail panel.
 *
 * Presentational plus one action. It takes a streak and a check-in callback and
 * draws them; the RPCs and the reward state live in `useWhisperStreak`, so this
 * can be dropped into the header popover, a settings screen or an onboarding
 * step without any of them starting their own duplicate check-in.
 *
 * The check-in button is the point. Previously the streak advanced merely because
 * the dashboard had mounted, which made it a visit counter — the user could not
 * do anything to keep it, so it did not measure a choice. Now the day only counts
 * when they tap, and the seven dots show exactly how much of the cycle is left to
 * earn, so the reward is legible before it is claimed rather than after.
 */

type StreakCardProps = {
  streak: WhisperStreak;
  /** Resolves once the write lands. Omit to render the card read-only. */
  onCheckIn?: () => void;
  checkingIn?: boolean;
  className?: string;
};

/**
 * What to say about the streak.
 *
 * Deliberately not congratulatory at 1. "1 day streak! 🔥" on someone's first
 * check-in announces an achievement that hasn't happened — the cheap
 * gamification tone the brief rules out. It reads as a beginning at 1 and earns
 * enthusiasm once there is something to be enthusiastic about.
 *
 * Every branch is phrased around what happens next, because the panel exists to
 * get the user to tap the button underneath it.
 */
function subtitleFor(streak: WhisperStreak): string {
  const { cycleDay, cycleLength, cycleCoins, checkedInToday, longest, run } = streak;
  const left = Math.max(0, cycleLength - cycleDay);

  if (checkedInToday && left === 0) {
    return `Cycle complete — ${cycleCoins} coins are in your wallet`;
  }
  if (checkedInToday) {
    return `${left} more day${left === 1 ? "" : "s"} to ${cycleCoins} coins`;
  }
  if (cycleDay === 0) {
    return longest === 0
      ? "Check in to start your streak"
      : `Check in to start a fresh ${cycleLength}-day cycle`;
  }
  if (left === 1) return `Check in today for your ${cycleCoins} coins`;
  if (run >= longest && longest > 1) return "This is your longest streak yet";
  return "Check in today to keep it alive";
}

export default function StreakCard({
  streak,
  onCheckIn,
  checkingIn = false,
  className = "",
}: StreakCardProps) {
  const reduced = useSafeReducedMotion();
  const { cycleDay, cycleLength, cycleCoins, checkedInToday } = streak;
  /* The flame lights from three days of a *cycle*, not three days ever, so it
     relights each week rather than staying permanently on after one good run. */
  const lit = cycleDay >= 3;
  const progress = cycleLength > 0 ? cycleDay / cycleLength : 0;

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
              : "var(--fill-1)",
            border: "1px solid var(--hairline)",
          }}
          animate={reduced || !lit ? undefined : { scale: [1, 1.045, 1] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
        >
          {/* `text-white opacity-*` rather than `text-white/35`. Tailwind's
              opacity modifier compiles to its own class (`.text-white\/35`), and
              the theme compatibility bridge in globals.css only rewrites the bare
              `.text-white` — so every `/N` variant stayed literally white and
              this panel's dimmer text disappeared on the light theme. Opacity is
              theme-independent, so it gives the same fade without leaving the
              bridge. */}
          <Flame size={23} className={lit ? "text-orange-300" : "text-white opacity-40"} />
        </motion.span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <motion.span
              key={cycleDay}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring.snappy}
              className="text-2xl font-black leading-none tabular-nums text-white"
            >
              {cycleDay}
            </motion.span>
            <span className="text-sm font-bold theme-text-muted">
              / {cycleLength} day{cycleLength === 1 ? "" : "s"}
            </span>
          </div>
          <p className="mt-1 text-[11.5px] leading-snug theme-text-subtle">
            {subtitleFor(streak)}
          </p>
        </div>

        {streak.longest >= 3 && (
          <span className="flex shrink-0 items-center gap-1 self-start rounded-full bg-white/5 px-2 py-1 text-[10.5px] font-bold theme-text-muted">
            <Trophy size={10} className="text-amber-300" />
            <span className="tabular-nums">{streak.longest}</span>
          </span>
        )}
      </div>

      {/* The cycle, one node per day. A bar would say "some progress"; seven
          nodes say "four more taps", which is the number that motivates the
          fifth. The last node is the payout, so it carries the coin rather than
          being a dot that happens to be last. */}
      <div className="mt-4 flex items-center gap-1.5" aria-hidden>
        {Array.from({ length: cycleLength }, (_, i) => {
          const day = i + 1;
          const done = day <= cycleDay;
          const isPayout = day === cycleLength;

          return (
            <motion.div
              key={day}
              initial={reduced ? false : { scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={
                reduced ? { duration: 0 } : { ...spring.snappy, delay: i * 0.035 }
              }
              className={`flex h-6 flex-1 items-center justify-center rounded-lg ${
                done ? "" : "bg-white/5"
              }`}
              style={
                done
                  ? {
                      background: isPayout
                        ? "linear-gradient(135deg, #fbbf24, #f59e0b)"
                        : "linear-gradient(135deg, #fb923c, #ec4899)",
                    }
                  : undefined
              }
            >
              {isPayout ? (
                <Coins
                  size={12}
                  /* Filled state gets near-black ink on the amber pill; empty
                     gets the bridged white faded, so it survives both themes. */
                  className={done ? "text-[#3a2708]" : "text-white opacity-40"}
                />
              ) : done ? (
                <Check size={11} className="text-white" strokeWidth={3.5} />
              ) : (
                <span className="h-1 w-1 rounded-full bg-white opacity-30" />
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Track plus a scaled fill rather than an animated width: scaleX is
          composited, width relayouts every frame. Kept alongside the dots because
          it carries the *motion* — the dots snap, this glides, and the glide is
          what reads as progress rather than a state change. */}
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/5">
        <motion.div
          className="h-full w-full origin-left rounded-full"
          style={{ background: "linear-gradient(90deg, #fb923c, #fbbf24)" }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: Math.max(0.015, progress) }}
          transition={reduced ? { duration: 0 } : { ...tween.base, duration: 0.7 }}
        />
      </div>

      {onCheckIn && (
        <div className="mt-3.5">
          {checkedInToday ? (
            /* Not a disabled button. A greyed-out control invites a tap that
               does nothing; a settled confirmation says the work is done and the
               next move is tomorrow. */
            <motion.div
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={spring.snappy}
              className="flex items-center justify-center gap-2 rounded-2xl bg-white/5 py-2.5 text-[12.5px] font-bold theme-text-muted"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400/20">
                <Check size={10} className="text-emerald-300" strokeWidth={3.5} />
              </span>
              Checked in today
            </motion.div>
          ) : (
            <Button
              size="sm"
              fullWidth
              loading={checkingIn}
              onClick={onCheckIn}
              icon={<Flame size={14} />}
            >
              Check in
            </Button>
          )}
          <p className="mt-2 text-center text-[10.5px] leading-snug theme-text-subtle">
            {cycleCoins} coins every {cycleLength} days
          </p>
        </div>
      )}
    </div>
  );
}
