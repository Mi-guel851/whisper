"use client";

import { memo } from "react";
import {
  Flame,
  Ghost,
  Heart,
  MessageCircle,
  Moon,
  Sparkle,
  Sparkles,
  Star,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * The glowing cluster in the top-right of the Daily Question card.
 *
 * WHY THIS IS CSS AND NOT FRAMER MOTION
 *
 * It is the only thing on this screen that animates *continuously* — everything
 * else in the feed animates in response to a tap and then stops. A JS-driven loop
 * would therefore be the one piece of the page holding the main thread open for
 * the entire time somebody is reading, on the exact device class this feed is
 * tuned for. Keyframes on `transform` and `opacity` run on the compositor and
 * cost the main thread nothing at all after the first frame.
 *
 * HOW THE ICONS CHANGE WITHOUT ANY JAVASCRIPT
 *
 * Each slot renders its whole set at once, stacked, and each glyph gets the same
 * keyframe with its start pushed one step further along a shared cycle. A glyph is
 * visible for a little under its share of that cycle, so the set hands off from
 * one to the next and the slot reads as one thing changing its mind. No timers, no
 * state, no re-renders — see `feedSparkPop` in globals.css.
 *
 * The slots are deliberately uneven in size, position and hue. Three identical
 * glyphs on a grid would read as a loading indicator; this reads as atmosphere,
 * which is the whole point of it being here.
 *
 * Decorative and announced as such. It carries no information the question does
 * not already carry, so it is hidden from assistive tech rather than described.
 */

type Slot = {
  /** Distance from the card's top-right, as inline styles — one slot, one place. */
  top: string;
  right: string;
  size: number;
  /** Palette token, so both themes stay on-brand. */
  color: string;
  /** Seconds offset into the shared cycle, so the slots never pop in unison. */
  delay: number;
  icons: LucideIcon[];
};

/** One shared cycle length, referenced by the keyframe in globals.css. */
const CYCLE_S = 9;

const SLOTS: Slot[] = [
  {
    top: "0.375rem",
    right: "0.25rem",
    size: 18,
    color: "var(--theme-accent-purple)",
    delay: 0,
    icons: [Sparkles, Star, Zap],
  },
  {
    top: "1.875rem",
    right: "2.125rem",
    size: 13,
    color: "var(--theme-accent-pink)",
    delay: 1.15,
    icons: [Heart, Flame, Sparkle],
  },
  {
    top: "2.75rem",
    right: "0.6875rem",
    size: 15,
    color: "var(--theme-accent-from)",
    delay: 2.4,
    icons: [MessageCircle, Moon, Ghost],
  },
];

function FeedQuestionSparksBase() {
  return (
    <span aria-hidden className="feed-sparks">
      {SLOTS.map((slot, slotIndex) => (
        <span
          key={slotIndex}
          className="feed-spark-slot"
          style={{ top: slot.top, right: slot.right, color: slot.color }}
        >
          {slot.icons.map((Glyph, iconIndex) => (
            <span
              key={iconIndex}
              className="feed-spark"
              style={{
                /* Its own step of the cycle, pushed by the slot's offset so no
                   two slots are ever at the same point in their animation. */
                animationDelay: `${
                  slot.delay + (iconIndex * CYCLE_S) / slot.icons.length
                }s`,
                animationDuration: `${CYCLE_S}s`,
              }}
            >
              <Glyph size={slot.size} strokeWidth={2.2} />
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

export const FeedQuestionSparks = memo(FeedQuestionSparksBase);
export default FeedQuestionSparks;
