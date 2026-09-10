"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { Flame } from "lucide-react";

import useWhisperStreak from "@/lib/useWhisperStreak";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import Modal from "./Modal";
import StreakCard from "./StreakCard";
import StreakRewardDialog from "./StreakRewardDialog";

/** Daily check-in opens in a portal, never inside the hero clipping boundary. */
export default function StreakChip() {
  const { streak, checkIn, checkingIn, reward, dismissReward } = useWhisperStreak();
  const reduced = useSafeReducedMotion();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const handleCheckIn = useCallback(async () => {
    const earned = await checkIn();
    if (earned) setOpen(false);
  }, [checkIn]);

  if (!streak) return null;

  const lit = streak.cycleDay >= 3;
  /* An unclaimed day is the one thing worth pulling attention to without a tap.
     It disappears the moment they check in, so it can never become a permanent
     ornament. */
  const pending = !streak.checkedInToday;

  return (
    <>
      <div className="relative">
        <button
          type="button"
          /* No vibrate() call here on purpose: ClickHaptics already buzzes every
             interactive element from one delegated pointerdown listener, so a
             local call would drive the motor twice for a single press. */
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={
            pending
              ? `Day ${streak.cycleDay} of ${streak.cycleLength}. Check in`
              : `Day ${streak.cycleDay} of ${streak.cycleLength}. Show progress`
          }
          className="relative inline-flex min-h-11 items-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 px-2.5 text-white transition hover:bg-white/10"
        >
          <motion.span
            className="flex items-center"
            /* The glow lives on the icon, not the chip, so the pulse cannot make
               the header's layout breathe. */
            animate={reduced || !lit ? undefined : { scale: [1, 1.1, 1] }}
            transition={{ duration: 0.7, ease: "easeInOut" }}
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
            {streak.cycleDay}
          </span>
          <span className="text-xs font-semibold">{pending ? "Check in" : "Day streak"}</span>

          {pending && (
            <motion.span
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 shadow-lg shadow-amber-500/40"
              animate={reduced ? undefined : { scale: [1, 1.25, 1], opacity: [1, 0.75, 1] }}
              transition={{ duration: 0.65, ease: "easeInOut" }}
            />
          )}
        </button>

      </div>

      <Modal open={open} onClose={close} title="Your daily streak" size="sm" className="max-h-[85dvh] overflow-y-auto">
        <div className="p-6 pt-3">
          <StreakCard streak={streak} onCheckIn={handleCheckIn} checkingIn={checkingIn} />
        </div>
      </Modal>

      {/* Portalled by Modal, so it is not clipped by the header's stacking
          context or by the popover's transform. */}
      <StreakRewardDialog
        open={reward !== null}
        onClose={dismissReward}
        coins={reward?.coins ?? 0}
        cycle={reward?.cycle ?? 1}
        cycleLength={streak.cycleLength}
      />
    </>
  );
}
