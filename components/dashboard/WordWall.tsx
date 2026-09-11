"use client";

import MorphingText from "@/components/ui/MorphingText";
import { whisperLane } from "@/lib/whisperWords";

/**
 * The word wall in the empty right half of the dashboard welcome card.
 *
 * Same effect as the send page's `WhisperWordCloud` — the same `MorphingText`,
 * the same hold/morph timing, the same blur-in-and-out — because the point is
 * that the two screens share a vocabulary and a rhythm, not that they share a
 * component. What is different is the budget and the placement:
 *
 *  * **Three lanes, not four.** This wall shares a card with a headline, a
 *    sub-line and two actions; four lines of display-weight type in a
 *    1.75rem-padded card is a poster, not texture.
 *  * **The whole hundred-word dictionary, split round-robin.** `whisperLane`
 *    guarantees the three lanes never show the same word at once, and each
 *    lane's own cycle is ~35 words, so nothing on this card repeats inside the
 *    time anyone spends on the dashboard.
 *  * **Right-hand half only, masked toward the copy.** The left edge of the
 *    wall fades out (`mask-image` in globals.css), so the longest word can
 *    drift under the headline's column without ever competing with it. Its top
 *    edge also starts below the streak chip's row, so no lane ever renders
 *    underneath the button.
 *  * **On phones it stops being an overlay.** Below 44rem the card is a single
 *    column with no spare half, so globals.css reflows this same markup into a
 *    standalone full-width band at the foot of the card (flex `order`, lanes
 *    stacked as rows, both edges masked) — the morph keeps running there.
 *
 * Colour comes from `--theme-text` at low alpha rather than a hardcoded white:
 * this card is white in the light theme, where a white wall would simply not
 * exist.
 */

type Lane = {
  /** Tailwind position for the lane's box, inside the right-hand field. */
  position: string;
  /** Slant, in degrees. */
  rotate: number;
  /** Where in its own cycle this lane starts, 0–1, so the three never flip
   *  in lockstep. */
  phase: number;
  /** Rotates the lane's slice of the dictionary, so lane 2 does not start on
   *  the same word lane 1 started on. */
  rotation: number;
};

const LANE_COUNT = 3;

const LANES: readonly Lane[] = [
  { position: "right-[10%] top-[2%]", rotate: -9, phase: 0, rotation: 0 },
  { position: "right-[26%] top-[40%]", rotate: 7, phase: 0.37, rotation: 11 },
  { position: "right-[6%] bottom-[1%]", rotate: -4, phase: 0.68, rotation: 23 },
];

/* Resolved once at module scope rather than per render: the split is
   deterministic, so there is nothing to recompute, and a stable array identity
   keeps `MorphingText`'s cycle from being handed a "new" list every time this
   card re-renders. */
const LANE_TEXTS: readonly (readonly string[])[] = LANES.map((lane, index) =>
  whisperLane(index, LANE_COUNT, lane.rotation)
);

export default function WordWall() {
  return (
    <div className="dashboard-word-wall" aria-hidden>
      {LANES.map((lane, index) => (
        <div
          key={lane.position}
          className={`absolute ${lane.position}`}
          style={{ transform: `rotate(${lane.rotate}deg)` }}
        >
          <MorphingText
            texts={LANE_TEXTS[index]}
            holdSeconds={2.6}
            morphSeconds={1.2}
            blurPx={8}
            phase={lane.phase}
            className="dashboard-word-wall-word"
          />
        </div>
      ))}
    </div>
  );
}
