"use client";

import MorphingText from "@/components/ui/MorphingText";
import { whisperLane } from "@/lib/whisperWords";
import { useMediaQuery } from "@/lib/useMediaQuery";

/**
 * The ambient word wall behind the dashboard welcome card.
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
 *    guarantees the lanes never show the same word at once, and each lane's
 *    own cycle is ~35 words, so nothing on this card repeats inside the time
 *    anyone spends on the dashboard.
 *  * **Pinned to the card, not to a gutter.** The wall is one absolutely
 *    positioned layer (`inset: 0`, `z-index: 0` in globals.css) that is
 *    clipped at the card's own rounded corners and paints *behind* every
 *    piece of foreground content. The lanes park low on the right half, clear
 *    of the streak chip's top-right corner.
 *  * **On phones it thins instead of hiding.** Below 44rem the card is a
 *    single tight column, so the wall drops to two lanes with smaller type —
 *    still a watermark, never removed.
 *
 * Colour comes from `--theme-text` at low alpha rather than a hardcoded white:
 * this card is white in the light theme, where a white wall would simply not
 * exist.
 */

type Lane = {
  /** Tailwind position for the lane's box, inside the card's bounds. */
  position: string;
  /** Slant, in degrees. */
  rotate: number;
  /** Where in its own cycle this lane starts, 0–1, so the lanes never flip
   *  in lockstep. */
  phase: number;
  /** Rotates the lane's slice of the dictionary, so lane 2 does not start on
   *  the same word lane 1 started on. */
  rotation: number;
};

const DESKTOP_LANES: readonly Lane[] = [
  { position: "right-[20%] top-[30%]", rotate: -9, phase: 0, rotation: 0 },
  { position: "right-[8%] top-[58%]", rotate: 7, phase: 0.37, rotation: 11 },
  { position: "right-[30%] bottom-[2%]", rotate: -4, phase: 0.68, rotation: 23 },
];

/* On phones the card is a single tight column, so the wall thins to two lanes
   parked on the right, clear of the eyebrow + streak chip row and the action
   row at the foot. */
const MOBILE_LANES: readonly Lane[] = [
  { position: "right-[10%] top-[28%]", rotate: -8, phase: 0, rotation: 0 },
  { position: "right-[5%] bottom-[10%]", rotate: 5, phase: 0.5, rotation: 17 },
];

/* Resolved once at module scope rather than per render: the split is
   deterministic, so there is nothing to recompute, and a stable array identity
   keeps `MorphingText`'s cycle from being handed a "new" list every time this
   card re-renders. */
const DESKTOP_LANE_TEXTS: readonly (readonly string[])[] = DESKTOP_LANES.map(
  (lane, index) => whisperLane(index, DESKTOP_LANES.length, lane.rotation)
);

const MOBILE_LANE_TEXTS: readonly (readonly string[])[] = MOBILE_LANES.map(
  (lane, index) => whisperLane(index, MOBILE_LANES.length, lane.rotation)
);

/* Same breakpoint the stylesheet uses for the mobile word-wall type. */
const MOBILE_QUERY = "(max-width: 44rem)";

export default function WordWall() {
  /* `useMediaQuery` defaults to false on the server and during hydration, so
     the desktop three-lane wall is what renders first; a phone drops to the
     two-lane set a frame later — the same trade the rest of the app makes for
     media queries. */
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const lanes = isMobile ? MOBILE_LANES : DESKTOP_LANES;
  const laneTexts = isMobile ? MOBILE_LANE_TEXTS : DESKTOP_LANE_TEXTS;

  return (
    <div className="dashboard-word-wall" aria-hidden>
      {lanes.map((lane, index) => (
        <div
          key={lane.position}
          className={`absolute ${lane.position}`}
          style={{ transform: `rotate(${lane.rotate}deg)` }}
        >
          <MorphingText
            texts={laneTexts[index]}
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
