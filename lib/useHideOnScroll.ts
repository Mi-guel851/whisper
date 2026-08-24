"use client";

import { useRef, useState } from "react";
import { useMotionValueEvent, useScroll } from "framer-motion";

/**
 * Reports whether the reader is currently heading *down* the page, for chrome
 * that should retract while they read and come back the moment they turn around.
 *
 * WHY ANCHOR-BASED AND NOT PER-FRAME DELTA
 *
 * The naive version flips on the sign of every scroll event, which on a touch
 * screen means it flickers: a thumb drag is never monotonic, and the couple of
 * pixels of rebound at the end of a flick read as "scrolled up" to anything
 * comparing consecutive frames. So direction is latched, and an anchor is set
 * wherever the direction last changed — the state only flips once the reader has
 * actually travelled `threshold` px *since turning around*. Small corrections
 * inside a gesture cost nothing.
 *
 * WHY A MOTION VALUE AND NOT A SCROLL LISTENER
 *
 * `useMotionValueEvent` runs off Framer's existing rAF-batched scroll
 * subscription, so this adds no listener of its own and — because the state is a
 * boolean — re-renders only on the frames where it actually flips, rather than on
 * every scroll event. Same reason `components/Navbar.tsx` reads scroll this way.
 *
 * WHY THIS REPORTS SCROLL AND NOTHING ELSE
 *
 * An earlier version took the full set of "don't hide right now" conditions — an
 * open search field, an open sheet — and masked its own output with them. That
 * put a boolean in here that could go stale: switched off while retracted and
 * then switched back on, it would snap the chrome shut with no gesture behind it,
 * and unsticking it needed either a setState in an effect or a ref read during
 * render, both of which this codebase's lint rules refuse for good reasons.
 *
 * Reporting only the scroll direction removes the problem instead of managing it.
 * Callers compose the exceptions themselves — `scrolledAway && !searchOpen` — and
 * because the controls that open those surfaces live *in* the chrome, the reader
 * has already scrolled up to reach them by the time the exception applies.
 */

type Options = {
  /**
   * False pins the result to `false` for good. Pass the reader's
   * `prefers-reduced-motion`: retraction is content moving out from under them,
   * which is the whole thing that preference is about. Safe to flip mid-session —
   * the matching `@media` block in globals.css neutralises the transform
   * independently, so there is no state here that can disagree with the CSS.
   */
  enabled?: boolean;
  /**
   * Never report `true` within this many px of the top. Without it the chrome
   * retracts while the first post is still on screen, which reads as the page
   * eating its own header on the first flick.
   */
  minY?: number;
  /** Travel required, after a direction change, before the result flips. */
  threshold?: number;
};

export function useHideOnScroll({
  enabled = true,
  minY = 72,
  threshold = 12,
}: Options = {}): boolean {
  const { scrollY } = useScroll();
  const [scrolledAway, setScrolledAway] = useState(false);

  const lastY = useRef(0);
  const anchorY = useRef(0);
  const direction = useRef<"up" | "down">("up");

  useMotionValueEvent(scrollY, "change", (value) => {
    const previous = lastY.current;
    lastY.current = value;

    /* Near the top there is nothing to retract for, and the anchor follows the
       reader so the first downward flick measures from where they actually are. */
    if (value <= minY) {
      anchorY.current = value;
      setScrolledAway(false);
      return;
    }

    const next = value > previous ? "down" : value < previous ? "up" : direction.current;

    /* A turn resets the ruler rather than moving the chrome — this is the frame
       the flicker used to happen on. */
    if (next !== direction.current) {
      direction.current = next;
      anchorY.current = value;
      return;
    }

    /* `setScrolledAway` with the value it already holds is a no-op React bails
       out of, so there is no guard here and no need to read the state back. */
    const travelled = value - anchorY.current;
    if (next === "down" && travelled > threshold) setScrolledAway(true);
    else if (next === "up" && travelled < -threshold) setScrolledAway(false);
  });

  return enabled && scrolledAway;
}

export default useHideOnScroll;
