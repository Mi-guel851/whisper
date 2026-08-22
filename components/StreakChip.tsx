"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Flame } from "lucide-react";

import useWhisperStreak from "@/lib/useWhisperStreak";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { spring } from "@/lib/motion";
import GlassPanel from "./GlassPanel";
import StreakCard from "./StreakCard";
import StreakRewardDialog from "./StreakRewardDialog";

/**
 * The streak indicator in the dashboard header.
 *
 * A streak belongs in the chrome, not in the content column: it is status, it is
 * checked at a glance, and the dashboard column is already dense enough without a
 * full card competing with the link, the prompt and the chart. So it reads as a
 * flame and a number, with the detail — and the check-in button — one tap away.
 *
 * The chip is a real control, not decoration. Tapping it opens the panel where the
 * day is actually claimed, which is the whole reason the panel exists now: the
 * streak no longer advances just because the dashboard mounted.
 *
 * It renders nothing only while the first read is in flight or if that read
 * failed (an unapplied migration, most likely) — never for a user with a streak of
 * zero. Someone who has never checked in needs the chip more than anyone, because
 * it is the only way to reach the button.
 */
export default function StreakChip() {
  const { streak, checkIn, checkingIn, reward, dismissReward } = useWhisperStreak();
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

  /* The popover closes on a payout so the celebration is not competing with a
     272px panel behind it — and because the panel's own numbers have just
     changed, showing a restarted cycle underneath a "cycle complete" dialog. */
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
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          /* No vibrate() call here on purpose: ClickHaptics already buzzes every
             interactive element from one delegated pointerdown listener, so a
             local call would drive the motor twice for a single press. */
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={
            pending
              ? `Day ${streak.cycleDay} of ${streak.cycleLength}. Check in`
              : `Day ${streak.cycleDay} of ${streak.cycleLength}. Show progress`
          }
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
            {streak.cycleDay}
          </span>

          {pending && (
            <motion.span
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 shadow-lg shadow-amber-500/40"
              animate={reduced ? undefined : { scale: [1, 1.25, 1], opacity: [1, 0.75, 1] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            />
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
              {/* `surface-solid` is what stops the dashboard card behind this
                  panel from reading through it. A popover that opens *directly*
                  over content is the one place translucency stops meaning depth
                  and starts meaning a smear — two overlapping paragraphs at 20%
                  are not legible at any blur radius. */}
              <GlassPanel strong className="surface-solid rounded-2xl p-4" elevation={5}>
                <StreakCard
                  streak={streak}
                  onCheckIn={handleCheckIn}
                  checkingIn={checkingIn}
                />
              </GlassPanel>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

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
