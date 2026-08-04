"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  animate,
  useInView,
  useReducedMotion,
  type AnimationPlaybackControls,
} from "framer-motion";
import { duration, ease } from "@/lib/motion";

type AnimatedCounterProps = {
  value: number;
  /** Seconds for the roll. Longer reads as slower, not as more impressive. */
  durationSec?: number;
  /** Rendered before the number — "+" for deltas, "$" for money. */
  prefix?: string;
  suffix?: string;
  /** Thousands separators. Off for small counts where they'd never appear. */
  locale?: boolean;
  className?: string;
};

/** `useLayoutEffect` warns during SSR; the paint it guards only exists client-side. */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function AnimatedCounter({
  value,
  durationSec = duration.slower * 1.6,
  prefix = "",
  suffix = "",
  locale = true,
  className = "",
}: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduced = useReducedMotion();

  const painted = useRef(0);

  const format = (n: number) => {
    const rounded = Math.round(n);
    return `${prefix}${locale ? rounded.toLocaleString() : rounded}${suffix}`;
  };

  // The animated span's children are ALWAYS null so React never owns a text
  // node inside it — if it ever rendered one, the next reconciliation would
  // remove it and wipe everything written below. Every character in this
  // element is written imperatively, and only here.
  useIsomorphicLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Paint something before the roll starts (and forever, if it never
    // enters the viewport) so the tile is never visually blank.
    if (!node.textContent) node.textContent = format(painted.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (!inView) {
      // Off-screen updates land silently; the roll happens on reveal.
      node.textContent = format(painted.current);
      return;
    }

    const from = painted.current;
    const to = value;

    if (reduced || from === to) {
      painted.current = to;
      node.textContent = format(to);
      return;
    }

    const controls: AnimationPlaybackControls = animate(from, to, {
      duration: durationSec,
      ease: ease.outExpo,
      onUpdate: (latest) => {
        painted.current = latest;
        node.textContent = format(latest);
      },
      onComplete: () => {
        painted.current = to;
        node.textContent = format(to);
      },
    });

    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, value, durationSec, prefix, suffix, locale, reduced]);

  const formatted = `${prefix}${locale ? value.toLocaleString() : value}${suffix}`;

  return (
    <>
      {/* Assistive tech reads the settled value, not sixty intermediate
          frames of the roll. `aria-label` on a bare span isn't reliably
          exposed, so this is a real (visually hidden) text node instead. */}
      <span className="sr-only">{formatted}</span>
      <span ref={ref} aria-hidden="true" className={`tabular-nums ${className}`} />
    </>
  );
}
