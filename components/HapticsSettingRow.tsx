"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Vibrate } from "lucide-react";

import {
  diagnoseHaptics,
  isHapticsEnabled,
  setHapticsEnabled,
  type HapticsDiagnosis,
} from "@/lib/haptics";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { spring, tween } from "@/lib/motion";

/**
 * The haptics switch, and the only honest way to debug a haptic.
 *
 * A vibration that does not happen looks identical whatever the cause — no
 * motor, a WebView missing the plugin, a browser withholding user activation, or
 * an OS touch-feedback setting turned off. None of those can be distinguished by
 * tapping harder, which is why "it isn't working" has been so hard to act on.
 *
 * So Test fires a real, deliberately strong buzz and reports which path it took
 * and what the platform said. The last case is the important one: when Whisper's
 * side succeeded and nothing was felt, the remaining switch is in Android's own
 * settings and no amount of code can reach it. Saying so is more useful than
 * another silent attempt.
 *
 * `diagnoseHaptics()` is called straight out of the click handler on purpose —
 * `navigator.vibrate` needs user activation, and activation does not survive an
 * `await`. Nothing may be awaited before it.
 */
export default function HapticsSettingRow() {
  const reduced = useSafeReducedMotion();

  /* Starts at the default rather than reading storage during render: this is a
     client component, so it still renders on the server, where `localStorage`
     does not exist and a mismatch would be a hydration error. */
  const [enabled, setEnabled] = useState(true);
  const [report, setReport] = useState<HapticsDiagnosis | null>(null);

  useEffect(() => {
    setEnabled(isHapticsEnabled());
  }, []);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    setHapticsEnabled(next);
    setReport(null);
    /* Confirm the *on* transition with the thing being switched on. Turning it
       off buzzing once would be contradictory. */
    if (next) setReport(diagnoseHaptics());
  }

  return (
    <div className="py-3.5 px-1">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-purple-300">
            <Vibrate size={17} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-white/90">Vibration</span>
            <span className="block text-[11px] text-white/40">Buzz on every tap</span>
          </span>
        </span>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setReport(diagnoseHaptics())}
            className="rounded-full bg-white/5 px-3 py-1.5 text-[11px] font-bold text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            Test
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Vibration on tap"
            onClick={toggle}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              enabled ? "bg-purple-500" : "bg-white/15"
            }`}
          >
            <motion.span
              className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
              /* Animating `left` would relayout every frame; `x` is composited. */
              animate={{ x: enabled ? 22 : 2 }}
              transition={reduced ? { duration: 0 } : spring.snappy}
            />
          </button>
        </div>
      </div>

      {report && (
        <motion.p
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={tween.base}
          className="mt-2.5 rounded-xl bg-white/[0.04] px-3 py-2 text-[11px] leading-relaxed text-white/55"
        >
          <span className="font-semibold text-white/75">{report.summary}</span>
          {report.advice ? <> {report.advice}</> : null}
        </motion.p>
      )}
    </div>
  );
}
