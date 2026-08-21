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
            {/* Theme tokens, not `text-white/90`. Tailwind's opacity modifier
                compiles to its own class, which the compatibility bridge in
                globals.css never matches — it only rewrites bare `.text-white`.
                So an `/N` variant stays literal white and vanishes against the
                light theme's white glass. */}
            <span className="block text-sm font-medium text-white">Vibration</span>
            <span className="block text-[11px] theme-text-subtle">Buzz on every tap</span>
          </span>
        </span>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setReport(diagnoseHaptics())}
            className="rounded-full bg-white/5 px-3 py-1.5 text-[11px] font-bold theme-text-muted transition hover:bg-white/10"
          >
            Test
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Vibration on tap"
            onClick={toggle}
            /* `no-press` and `border-0 p-0` are both load-bearing, and both were
               the "disfigured when on" bug:

               - A `<button>` carries UA padding (`1px 6px` in Chrome). The knob
                 below is absolutely positioned with no `left`, so it resolved to
                 its *static* position — inset by that 6px. Off, it floated a
                 third of the way in; on, `x: 22` pushed it 4px past the track's
                 right edge, so the white pill bulged out of the purple one.
                 Zeroing the padding and giving the knob an explicit `left-0.5`
                 makes both ends deterministic instead of inherited.
               - The app-wide press rule scales any button to 0.97. On a 44×24
                 pill that reads as the switch buckling, and a switch already has
                 its own feedback: the knob moving. */
            className={`no-press relative box-border h-6 w-11 shrink-0 rounded-full border-0 p-0 transition-colors ${
              enabled ? "bg-purple-500" : "bg-white/15"
            }`}
          >
            <motion.span
              className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow"
              /* Animating `left` would relayout every frame; `x` is composited.
                 20px of travel, not 22: 44 track − 20 knob − 2 left − 2 right. */
              animate={{ x: enabled ? 20 : 0 }}
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
          className="mt-2.5 rounded-xl bg-white/5 px-3 py-2 text-[11px] leading-relaxed theme-text-subtle"
        >
          <span className="font-semibold theme-text-muted">{report.summary}</span>
          {report.advice ? <> {report.advice}</> : null}
        </motion.p>
      )}
    </div>
  );
}
