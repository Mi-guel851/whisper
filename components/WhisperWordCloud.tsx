"use client";

import MorphingText from "./ui/MorphingText";

/**
 * The ambient word wall behind the send box.
 *
 * Four short lines, set at angles around the screen, each cycling through words
 * in Whisper's voice. They sit *behind* the glass card, which is the reason the
 * effect works: the card's 32px backdrop blur turns whatever overlaps it into a
 * soft wash of colour, so the words read as texture in the middle of the screen
 * and as legible text out at the edges. Nothing needs to be kept clear of them.
 *
 * Four is the whole budget. Each line is one rAF loop writing a `blur()`, and
 * `filter` repaints — so this is deliberately a small number of small nodes,
 * held at low opacity, rather than a screen full of moving text.
 *
 * On the words: these are near-rhymes and echoes rather than strict ones. The
 * literal rhymes for "whisper" — crisper, blister, lisper — are comic, and this
 * is the first screen a stranger sees. The shared `-er` cadence carries the
 * rhyme; the vocabulary carries the brand. Swapping any line is a one-array
 * edit below.
 */

type Line = {
  texts: readonly string[];
  /** Tailwind position for the line's box. */
  position: string;
  /** Slant, in degrees. */
  rotate: number;
  /** Where in the morph cycle this line starts, 0–1, so they never change
   *  in lockstep. */
  phase: number;
  size: string;
};

const LINES: readonly Line[] = [
  {
    texts: ["whisper", "softer", "closer", "quieter"],
    position: "left-[-1.5rem] top-[14%]",
    rotate: -14,
    phase: 0,
    size: "text-3xl sm:text-5xl",
  },
  {
    texts: ["no name", "no trace", "no face"],
    position: "right-[-1rem] top-[26%]",
    rotate: 11,
    phase: 0.35,
    size: "text-2xl sm:text-4xl",
  },
  {
    texts: ["say it", "send it", "mean it"],
    position: "left-[6%] bottom-[18%]",
    rotate: 9,
    phase: 0.62,
    size: "text-2xl sm:text-4xl",
  },
  {
    texts: ["unsigned", "unseen", "unsaid"],
    position: "right-[2%] bottom-[9%]",
    rotate: -10,
    phase: 0.85,
    size: "text-3xl sm:text-5xl",
  },
];

export default function WhisperWordCloud() {
  return (
    /* Pinned to the section rather than the viewport so it scrolls with the card
       instead of hanging over the page like chrome. */
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
      {LINES.map((line) => (
        <div
          key={line.texts[0]}
          className={`absolute ${line.position}`}
          style={{ transform: `rotate(${line.rotate}deg)` }}
        >
          <MorphingText
            texts={line.texts}
            holdSeconds={2.6}
            morphSeconds={1.2}
            blurPx={8}
            phase={line.phase}
            className={`${line.size} font-black uppercase tracking-tight text-white/[0.09]`}
          />
        </div>
      ))}
    </div>
  );
}
