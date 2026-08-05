"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ease } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Seconds. Use for a one-off offset; for lists prefer a stagger container. */
  delay?: number;
  /** Distance the block rises from, in px. 0 turns it into a plain fade. */
  y?: number;
  /** Fraction of the element that must be visible before it fires. */
  amount?: number;
};

/**
 * Scroll reveal for a block of marketing content.
 *
 * Every section on the home page previously spelled out the same
 * `initial`/`whileInView`/`viewport`/`transition` quartet inline, which is four
 * chances per section for one of them to drift — and they had: two sections
 * used `amount: 0.5`, two used `0.3`, and the durations disagreed. One
 * component means the page reveals at one rhythm.
 *
 * `once: true` is not configurable on purpose. Re-animating on scroll-back is
 * the tell of a template, and it makes long pages feel unstable under the
 * thumb.
 */
export default function Reveal({
  children,
  className,
  delay = 0,
  y = 22,
  amount = 0.3,
}: RevealProps) {
  const reduced = useSafeReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount, margin: "0px 0px -60px 0px" }}
      transition={{
        duration: reduced ? 0.18 : 0.62,
        delay: reduced ? 0 : delay,
        ease: ease.outExpo,
      }}
    >
      {children}
    </motion.div>
  );
}
