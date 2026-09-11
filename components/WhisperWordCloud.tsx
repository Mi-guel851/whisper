"use client";

import MorphingText from "./ui/MorphingText";
import { whisperLane } from "@/lib/whisperWords";

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
 * THE WORDS
 *
 * Each line still opens on its own brand phrase — the near-rhymes and echoes,
 * not the literal ones (crisper, blister, lisper are comic, and this is the
 * first screen a stranger sees) — and then continues through its slice of the
 * shared hundred-word vocabulary in lib/whisperWords.ts. That vocabulary is the
 * reason a word almost never repeats inside one visit: a line used to cycle
 * three words, which reads as a loop in under fifteen seconds, and now cycles
 * twenty-odd at ~3.8s each. The dashboard welcome card's wall draws on the same
 * list, so the two screens share a vocabulary as well as an animation.
 */

type Line = {
  /** Tailwind position for the line's box. */
  position: string;
  /** Slant, in degrees. */
  rotate: number;
  /** Where in the morph cycle this line starts, 0–1, so they never change
   *  in lockstep. */
  phase: number;
  size: string;
};

/** What each line leads with, before the shared dictionary takes over. */
const BRAND_LINES: readonly (readonly string[])[] = [
  ["whisper", "softer", "closer", "quieter"],
  ["no name", "no trace", "no face"],
  ["say it", "send it", "mean it"],
  ["unsigned", "unseen", "unsaid"],
];

const LINES: readonly Line[] = [
  { position: "left-[-1.5rem] top-[14%]", rotate: -14, phase: 0, size: "text-3xl sm:text-5xl" },
  { position: "right-[-1rem] top-[26%]", rotate: 11, phase: 0.35, size: "text-2xl sm:text-4xl" },
  { position: "left-[6%] bottom-[18%]", rotate: 9, phase: 0.62, size: "text-2xl sm:text-4xl" },
  { position: "right-[2%] bottom-[9%]", rotate: -10, phase: 0.85, size: "text-3xl sm:text-5xl" },
];

/* Resolved once at module scope: the split is deterministic, so there is
   nothing to recompute, and a stable array identity keeps `MorphingText` from
   being handed a "new" list on every render of the page behind it. */
const LINE_TEXTS: readonly (readonly string[])[] = BRAND_LINES.map((brand, index) => [
  ...brand,
  ...whisperLane(index, BRAND_LINES.length, 3 + index * 5).filter((word) => !brand.includes(word)),
]);

export default function WhisperWordCloud() {
  return (
    /* Pinned to the section rather than the viewport so it scrolls with the card
       instead of hanging over the page like chrome. */
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
      {LINES.map((line, index) => (
        <div
          key={BRAND_LINES[index][0]}
          className={`absolute ${line.position}`}
          style={{ transform: `rotate(${line.rotate}deg)` }}
        >
          <MorphingText
            texts={LINE_TEXTS[index]}
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
