"use client";

import { useEffect, useRef } from "react";
import { animate, useInView } from "framer-motion";
import { ease } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

type CountUpProps = {
  /** The final value. Rendered verbatim before the count starts. */
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
};

/**
 * Number that counts up the first time it scrolls into view.
 *
 * Two details that are easy to get wrong and very visible when you do:
 *
 *  - The text is `tabular-nums` (via `.stat-value`, or the inline fallback
 *    below). Proportional digits change width as they roll, so the label under
 *    a counting number jitters left and right for the whole animation.
 *  - The final value is what renders on the server and before the element is
 *    seen. A counter that starts at "0" would flash a wrong number to anyone
 *    with JS disabled, and would read as 0 to a screen reader that walks the
 *    tree before the observer fires.
 */
function format(value: number, decimals: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export default function CountUp({
  to,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduced = useSafeReducedMotion();

  /* The frames are written straight to the text node, not through state.
   *
   * A 1.5s count at 60fps is ~90 ticks. Held in state, each one is a React
   * render, a reconcile and a commit for a string that nothing else on the page
   * depends on — and on the home page four of these run at once. Writing
   * `textContent` skips all of it and is what a `motion` component does
   * internally for a style value; there's just no motion component for text.
   *
   * The markup below still renders the *final* value, so the server output, the
   * no-JS output and the accessibility tree are all correct without this effect
   * ever running. */
  useEffect(() => {
    const node = ref.current;
    if (!node || !inView || reduced) return;

    const controls = animate(0, to, {
      // Long enough to read as counting, short enough that the eye isn't
      // waiting on it — the number is supporting evidence, not the headline.
      duration: 1.5,
      ease: ease.outExpo,
      onUpdate: (value) => {
        node.textContent = `${prefix}${format(value, decimals)}${suffix}`;
      },
    });

    return () => {
      controls.stop();
      // Interrupted mid-count (unmount, or a `to` that changes) the node would
      // otherwise keep whichever partial number it happened to be showing.
      node.textContent = `${prefix}${format(to, decimals)}${suffix}`;
    };
  }, [inView, reduced, to, decimals, prefix, suffix]);

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {prefix}
      {format(to, decimals)}
      {suffix}
    </span>
  );
}
