"use client";

import { memo } from "react";

/**
 * Drifting reaction emoji, rising slowly behind a page's content.
 *
 * Every value is a hand-picked constant rather than `Math.random()`. Random
 * placement would differ between the server render and the hydration render,
 * and it also re-rolls on every parent re-render — so the whole field would
 * jump the moment a user types a character into the message box.
 *
 * The animation is `transform` and `opacity` only, so each floater rides the
 * compositor and never touches layout or the main thread. That is what makes a
 * permanent, always-running effect affordable on a mid-range phone: the cost is
 * a handful of small GPU layers, not a per-frame paint.
 *
 * `aria-hidden` throughout — this is atmosphere. A screen reader announcing
 * "purple heart, sparkles, ghost" over and over would be actively hostile.
 */

type Floater = {
  emoji: string;
  /** Horizontal start, as a percentage of the container. */
  left: number;
  /** Font size in rem. Varied so the field reads as having depth. */
  size: number;
  /** Seconds before the first rise. Negative starts mid-flight, so the screen
   *  is already populated on arrival instead of empty for ten seconds. */
  delay: number;
  /** Seconds for one full rise. Longer = further away. */
  duration: number;
  /** Sideways drift in px over the climb — nothing rises perfectly straight. */
  drift: number;
  /** Peak opacity. Small and distant ones stay fainter. */
  peak: number;
  /** Where it sits when motion is reduced and the rise is switched off, as a
   *  percentage from the top. Scattered, so a still field still reads as a
   *  field rather than a row. */
  rest: number;
};

const FLOATERS: Floater[] = [
  { emoji: "💜", left: 8,  size: 1.5,  delay: -2,  duration: 17, drift: 26,  peak: 0.5,  rest: 68 },
  { emoji: "✨", left: 21, size: 1.0,  delay: -9,  duration: 21, drift: -18, peak: 0.34, rest: 26 },
  { emoji: "❤️", left: 34, size: 1.25, delay: -14, duration: 19, drift: 32,  peak: 0.42, rest: 82 },
  { emoji: "👻", left: 47, size: 1.75, delay: -5,  duration: 24, drift: -28, peak: 0.3,  rest: 14 },
  { emoji: "💬", left: 61, size: 1.1,  delay: -18, duration: 20, drift: 22,  peak: 0.36, rest: 58 },
  { emoji: "💜", left: 75, size: 1.35, delay: -11, duration: 16, drift: -24, peak: 0.46, rest: 34 },
  { emoji: "✨", left: 89, size: 0.95, delay: -7,  duration: 23, drift: 16,  peak: 0.32, rest: 74 },
];

function AmbientFloatersBase() {
  return (
    <div className="ambient-floaters" aria-hidden="true">
      {FLOATERS.map((floater, index) => (
        <span
          key={index}
          className="ambient-floater"
          style={
            {
              left: `${floater.left}%`,
              fontSize: `${floater.size}rem`,
              animationDelay: `${floater.delay}s`,
              animationDuration: `${floater.duration}s`,
              "--floater-drift": `${floater.drift}px`,
              "--floater-peak": floater.peak,
              "--floater-rest": `${floater.rest}%`,
            } as React.CSSProperties
          }
        >
          {floater.emoji}
        </span>
      ))}
    </div>
  );
}

export const AmbientFloaters = memo(AmbientFloatersBase);
export default AmbientFloaters;
