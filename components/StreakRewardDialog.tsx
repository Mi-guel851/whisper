"use client";

import { motion } from "framer-motion";
import { Coins, Flame } from "lucide-react";

import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { spring, tween } from "@/lib/motion";
import Button from "./Button";
import Modal from "./Modal";

/**
 * The seven-day payout celebration.
 *
 * Shown once, on the check-in that completes a cycle, and only when the server
 * confirmed the coins were actually credited — `useWhisperStreak` withholds the
 * reward object if the payout lost its race, because announcing coins that are
 * not in the wallet is worse than announcing nothing.
 *
 * The restraint here is deliberate: one burst, one number, and a button. The
 * brief rules out animation that feels excessive, and a full-screen confetti
 * cannon for four coins would be exactly that — it would also fire on the moment
 * a user is most likely to be mid-scroll, so it has to be dismissible in one tap
 * and gone.
 */

type StreakRewardDialogProps = {
  open: boolean;
  onClose: () => void;
  coins: number;
  /** Which cycle completed — 1 for the first week, 2 for the next. */
  cycle: number;
  cycleLength?: number;
};

/* Eight coins on a ring. Fixed angles rather than random ones so the burst looks
   composed instead of scattered, and so it renders identically every time — a
   celebration that looks different on each payout reads as a glitch. */
const BURST = Array.from({ length: 8 }, (_, i) => {
  const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(angle) * 74, y: Math.sin(angle) * 74, delay: i * 0.028 };
});

export default function StreakRewardDialog({
  open,
  onClose,
  coins,
  cycle,
  cycleLength = 7,
}: StreakRewardDialogProps) {
  const reduced = useSafeReducedMotion();

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      showClose={false}
      className="overflow-hidden"
    >
      <div className="relative px-6 pb-6 pt-9 text-center">
        {/* Warm wash behind the medallion, so the amber reads as light in the
            room rather than a sticker pasted on the panel. `pointer-events-none`
            because it overlaps the button. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-44"
          style={{
            background:
              "radial-gradient(60% 70% at 50% 0%, rgba(251,191,36,0.22) 0%, rgba(251,146,60,0.09) 42%, transparent 72%)",
          }}
        />

        <div className="relative mx-auto mb-5 grid h-24 w-24 place-items-center">
          {/* The coins fly out and fade. They are `absolute` inside a fixed-size
              grid cell, so nothing they do can move the dialog's layout. */}
          {!reduced &&
            BURST.map((coin, i) => (
              <motion.span
                key={i}
                aria-hidden
                className="absolute grid h-6 w-6 place-items-center rounded-full"
                style={{
                  background: "linear-gradient(135deg, #fde68a, #f59e0b)",
                  boxShadow: "0 2px 8px rgba(245,158,11,0.4)",
                }}
                initial={{ x: 0, y: 0, scale: 0.3, opacity: 0 }}
                animate={{
                  x: coin.x,
                  y: coin.y,
                  scale: [0.3, 1, 0.7],
                  opacity: [0, 1, 0],
                }}
                transition={{
                  duration: 0.85,
                  delay: 0.12 + coin.delay,
                  ease: "easeOut",
                }}
              >
                <Coins size={11} className="text-[#3a2708]" />
              </motion.span>
            ))}

          <motion.div
            initial={reduced ? { opacity: 0 } : { scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={reduced ? tween.base : { ...spring.snappy, delay: 0.05 }}
            className="relative grid h-20 w-20 place-items-center rounded-[1.6rem]"
            style={{
              background: "linear-gradient(140deg, #fbbf24 0%, #f59e0b 52%, #ea9308 100%)",
              boxShadow:
                "0 10px 30px rgba(245,158,11,0.34), inset 0 1px 0 rgba(255,255,255,0.5)",
            }}
          >
            <Coins size={38} className="text-[#3a2708]" strokeWidth={2.1} />
          </motion.div>
        </div>

        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduced ? tween.base : { ...tween.base, delay: 0.14 }}
        >
          <p className="flex items-center justify-center gap-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-amber-300">
            <Flame size={12} />
            {cycleLength}-day streak complete
          </p>

          <h2 className="mt-2.5 text-[2.1rem] font-black leading-none tabular-nums text-white">
            +{coins}
          </h2>
          <p className="mt-1.5 text-sm font-bold text-white">
            Whisper coin{coins === 1 ? "" : "s"} credited
          </p>

          <p className="mx-auto mt-2.5 max-w-[15rem] text-[12.5px] leading-relaxed theme-text-muted">
            {coins} coin{coins === 1 ? " is" : "s are"} already in your wallet. Your
            streak starts over from day one — check in tomorrow to begin the next{" "}
            {cycleLength} days.
          </p>

          {/* Only from the second cycle on. "Cycle 1 complete" tells a first-time
              user nothing; "your 3rd week" is a real fact worth hearing. */}
          {cycle >= 2 && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-[11px] font-bold theme-text-muted">
              <Flame size={11} className="text-orange-300" />
              {cycle} cycles completed
            </p>
          )}

          <Button className="mt-6" size="md" fullWidth onClick={onClose}>
            Keep it going
          </Button>
        </motion.div>
      </div>
    </Modal>
  );
}
