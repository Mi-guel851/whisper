"use client";

import { useEffect, useRef, useState } from "react";
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
  const [display, setDisplay] = useState(to);

  useEffect(() => {
    if (!inView || reduced) return;

    setDisplay(0);
    const controls = animate(0, to, {
      // Long enough to read as counting, short enough that the eye isn't
      // waiting on it — the number is supporting evidence, not the headline.
      duration: 1.5,
      ease: ease.outExpo,
      onUpdate: (value) => setDisplay(value),
    });

    return () => controls.stop();
  }, [inView, reduced, to]);

  const formatted = display.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
