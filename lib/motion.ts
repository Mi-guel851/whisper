/**
 * Shared motion vocabulary.
 *
 * Every animated component imports from here rather than declaring its own
 * transition objects. One place to tune means the whole app moves like one
 * product instead of forty screens that each guessed.
 *
 * Values mirror the CSS custom properties in app/globals.css (--dur-*,
 * --ease-*) so CSS transitions and Framer Motion agree.
 */

import type { Transition, Variants } from "framer-motion";

/* --------------------------------------------------------------------------
 * Durations (seconds — Framer's unit)
 * ------------------------------------------------------------------------ */

export const duration = {
  instant: 0.11,
  fast: 0.17,
  base: 0.26,
  slow: 0.42,
  slower: 0.64,
} as const;

/* --------------------------------------------------------------------------
 * Easings — the cubic-beziers from globals.css
 * ------------------------------------------------------------------------ */

export const ease = {
  outQuint: [0.22, 1, 0.36, 1],
  outExpo: [0.16, 1, 0.3, 1],
  spring: [0.34, 1.4, 0.64, 1],
  soft: [0.65, 0, 0.35, 1],
} as const;

/* --------------------------------------------------------------------------
 * Springs
 *
 * Physical springs rather than duration curves for anything the user
 * directly manipulates (drags, sheets, presses) — they stay interruptible
 * and preserve velocity when a gesture is caught mid-flight.
 * ------------------------------------------------------------------------ */

export const spring = {
  /** Buttons, toggles, small state flips. Fast, barely overshoots. */
  snappy: { type: "spring", stiffness: 520, damping: 34, mass: 0.7 },
  /** Default for panels and cards. Settles cleanly, no visible bounce. */
  smooth: { type: "spring", stiffness: 320, damping: 32, mass: 0.9 },
  /** Larger surfaces — sheets, modals, drawers. */
  gentle: { type: "spring", stiffness: 220, damping: 30, mass: 1 },
  /** Playful, for reactions and celebratory pops only. */
  bouncy: { type: "spring", stiffness: 480, damping: 18, mass: 0.8 },
  /** Gesture release — matches the feel of iOS rubber-banding back. */
  gesture: { type: "spring", stiffness: 500, damping: 40, mass: 0.8 },
} satisfies Record<string, Transition>;

/* --------------------------------------------------------------------------
 * Tweens
 * ------------------------------------------------------------------------ */

export const tween = {
  fast: { duration: duration.fast, ease: ease.outQuint },
  base: { duration: duration.base, ease: ease.outQuint },
  slow: { duration: duration.slow, ease: ease.outExpo },
} satisfies Record<string, Transition>;

/* --------------------------------------------------------------------------
 * Variants
 * ------------------------------------------------------------------------ */

/** Standard entrance: rise and fade. The workhorse. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: tween.base },
  exit: { opacity: 0, y: -8, transition: tween.fast },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: tween.base },
  exit: { opacity: 0, transition: tween.fast },
};

/**
 * Blur reveal — content resolves into focus as it rises.
 * Reserve for hero moments; `filter` animation is expensive, so this should
 * never be applied to a list or anything repeated.
 */
export const blurReveal: Variants = {
  hidden: { opacity: 0, y: 22, filter: "blur(12px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: duration.slow, ease: ease.outExpo },
  },
  exit: { opacity: 0, filter: "blur(6px)", transition: tween.fast },
};

/** Pop in — for popovers, menus, reactions. */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  visible: { opacity: 1, scale: 1, transition: spring.snappy },
  exit: { opacity: 0, scale: 0.96, transition: tween.fast },
};

/** Modal/dialog entrance — slightly heavier than a popover. */
export const modalIn: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: 12 },
  visible: { opacity: 1, scale: 1, y: 0, transition: spring.smooth },
  exit: { opacity: 0, scale: 0.97, y: 6, transition: tween.fast },
};

/** Bottom sheet. */
export const sheetUp: Variants = {
  hidden: { y: "100%" },
  visible: { y: 0, transition: spring.gentle },
  exit: { y: "100%", transition: { duration: duration.base, ease: ease.soft } },
};

export const backdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.base, ease: ease.soft } },
  exit: { opacity: 0, transition: { duration: duration.fast, ease: ease.soft } },
};

/** Toast — slides in from the edge with a spring. */
export const toastIn: Variants = {
  hidden: { opacity: 0, y: 20, scale: 0.94 },
  visible: { opacity: 1, y: 0, scale: 1, transition: spring.smooth },
  exit: { opacity: 0, scale: 0.9, transition: tween.fast },
};

/* --------------------------------------------------------------------------
 * Stagger
 * ------------------------------------------------------------------------ */

/**
 * Parent variant that cascades children.
 *
 * Keep `stagger` small (0.04–0.08). Anything larger reads as slow rather
 * than choreographed, and the last item in a long list arrives late enough
 * to feel broken.
 */
export function staggerContainer(stagger = 0.055, delayChildren = 0): Variants {
  return {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: stagger, delayChildren },
    },
    exit: {
      opacity: 0,
      transition: { staggerChildren: 0.02, staggerDirection: -1 },
    },
  };
}

/** Child of staggerContainer. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: tween.base },
  exit: { opacity: 0, y: -6, transition: tween.fast },
};

/* --------------------------------------------------------------------------
 * Interaction presets
 * ------------------------------------------------------------------------ */

export const hoverLift = {
  whileHover: { y: -2, transition: spring.snappy },
  whileTap: { scale: 0.985, y: 0, transition: spring.snappy },
} as const;

export const pressable = {
  whileTap: { scale: 0.96, transition: spring.snappy },
} as const;

/* --------------------------------------------------------------------------
 * Scroll reveal
 * ------------------------------------------------------------------------ */

/**
 * Props for reveal-on-scroll sections.
 *
 * `once: true` matters — re-animating on every scroll-back is the classic
 * "animated website" mistake and makes content feel unstable.
 */
export const revealOnScroll = {
  initial: "hidden",
  whileInView: "visible",
  viewport: { once: true, amount: 0.25, margin: "0px 0px -80px 0px" },
} as const;

/* --------------------------------------------------------------------------
 * Reduced motion
 * ------------------------------------------------------------------------ */

/**
 * Strips movement from a variant set while keeping the opacity change, so
 * content still announces itself instead of appearing without explanation.
 *
 * Pair with `useSafeReducedMotion()` from lib/useSafeReducedMotion — not
 * Framer's own `useReducedMotion()`, which reads the media query during the
 * hydration render and causes a mismatch:
 *
 *   const reduced = useSafeReducedMotion();
 *   <motion.div variants={respectMotion(fadeUp, reduced)} />
 */
export function respectMotion(variants: Variants, reduced: boolean | null): Variants {
  if (!reduced) return variants;

  const stripped: Variants = {};
  for (const [key, value] of Object.entries(variants)) {
    if (typeof value !== "object" || value === null) {
      stripped[key] = value;
      continue;
    }
    const { y, x, scale, filter, rotate, ...rest } = value as Record<string, unknown>;
    void y; void x; void scale; void filter; void rotate;
    stripped[key] = { ...rest, transition: { duration: 0.15 } };
  }
  return stripped;
}
