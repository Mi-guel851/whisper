"use client";

import { useRef } from "react";
import {
  motion,
  useMotionTemplate,
  useScroll,
  useTransform,
} from "framer-motion";
import { ArrowRight, Play } from "lucide-react";
import PhoneMockup from "./PhoneMockup";
import AnimatedHeading from "./AnimatedHeading";
import OrbitChips from "./home/OrbitChips";
import Avatar from "./home/Avatar";
import CountUp from "./home/CountUp";
import { ButtonLink } from "./Button";
import { ease, respectMotion, staggerContainer, staggerItem } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import { useCoarsePointer } from "@/lib/useMediaQuery";

/**
 * The headline runs its own per-word cascade, so the block-level stagger skips
 * over it and resumes underneath — otherwise the subhead would wait out the
 * full reveal before starting, and the fold would feel slow.
 */
const HEADING_SETTLE = 0.3;

/** Seeds for the social-proof stack. See components/home/Avatar. */
const PROOF = ["@its_joycee", "@real_kayz", "@mimi.vibes"];

export default function Hero() {
  const reduced = useSafeReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);

  /* Scroll-linked frosting.
   *
   * As the hero leaves, its contents defocus and settle back rather than just
   * scrolling off — the same trick Apple uses to hand attention to the next
   * section. Progress runs from "hero pinned at the top of the viewport" to
   * "hero fully scrolled past".
   *
   * The blur is applied to the two content columns, never to a wrapper that
   * contains a frosted surface: `filter` on an ancestor creates a new backdrop
   * root, which would stop any descendant's `backdrop-filter` from sampling the
   * page behind it — the glass would go flat exactly when it's most visible.
   */
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });

  // Blur leads, opacity trails. Fading first would just look like the section
  // disappearing; frosting first reads as depth.
  const blurPx = useTransform(scrollYProgress, [0, 0.72], [0, 14]);
  const frost = useMotionTemplate`blur(${blurPx}px)`;
  const recede = useTransform(scrollYProgress, [0, 0.92], [1, 0]);
  const settle = useTransform(scrollYProgress, [0, 1], [1, 0.96]);

  // Hooks can't be conditional, so the values are always computed and only the
  // binding is skipped when the user has asked for less motion.
  //
  // On touch devices the blur is dropped and only opacity and scale are bound.
  // `filter` is the one property here that cannot be composited: the GPU can
  // fade and scale an existing layer for free, but a blur has to be re-rendered
  // at every radius, so a scroll-linked one repaints the entire hero — text,
  // glass panel, phone mockup — on every frame of the fold. On a mid-range
  // Android that is the first thing a new visitor scrolls, and it stutters.
  //
  // The effect survives the demotion because the other two values carry it: the
  // hero still recedes and settles away, just without the defocus. Desktop GPUs
  // handle the blur comfortably and keep the full version.
  const coarsePointer = useCoarsePointer();
  const scrollStyle = reduced
    ? undefined
    : coarsePointer
      ? { opacity: recede, scale: settle, willChange: "opacity, transform" }
      : { filter: frost, opacity: recede, scale: settle, willChange: "filter, opacity" };

  return (
    <section
      ref={sectionRef}
      className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-4 pb-16 pt-28 sm:px-8 sm:pb-24 sm:pt-36 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:pt-40"
    >
      {/* --- Copy column --- */}
      <motion.div
        style={scrollStyle}
        className="relative z-10 text-center lg:text-left"
        variants={respectMotion(staggerContainer(0.075, HEADING_SETTLE), reduced)}
        initial="hidden"
        animate="visible"
      >
        <div className="glass-control rounded-[2.5rem] border border-white/10 p-8 lg:p-10">
          <motion.div
            variants={respectMotion(staggerItem, reduced)}
            className="home-pill mb-6"
          >
          {/* Two-layer dot: a solid core with a slower halo behind it, so the
              "live" signal reads without the whole pill pulsing. */}
          <span className="relative flex h-2 w-2 shrink-0">
            {!reduced && (
              <motion.span
                className="absolute inset-0 rounded-full"
                style={{ background: "var(--brand-cyan)" }}
                animate={{ scale: [1, 2.4, 1], opacity: [0.55, 0, 0.55] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
              />
            )}
            <span
              className="relative h-2 w-2 rounded-full"
              style={{ background: "var(--brand-cyan)" }}
            />
          </span>
          100% Anonymous. Always.
        </motion.div>
        </div>

        <AnimatedHeading className="mx-auto max-w-[15ch] lg:mx-0" />

        <motion.p
          variants={respectMotion(staggerItem, reduced)}
          className="mx-auto mt-6 max-w-lg text-base leading-7 sm:text-lg sm:leading-8 lg:mx-0"
          style={{ color: "var(--bridge-text-secondary)" }}
        >
          Receive anonymous messages, photos, voice notes and reactions from the
          people who know you — completely honestly.
        </motion.p>

        <motion.div
          variants={respectMotion(staggerItem, reduced)}
          className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center lg:justify-start"
        >
          <ButtonLink href="/signup" size="lg" iconRight={<ArrowRight size={18} />}>
            Create My Link
          </ButtonLink>
          <ButtonLink
            href="/#how-it-works"
            variant="outline"
            size="lg"
            icon={<Play size={15} fill="currentColor" />}
          >
            See how it works
          </ButtonLink>
        </motion.div>

        {/* --- Social proof --- */}
        <motion.div
          variants={respectMotion(staggerItem, reduced)}
          className="mt-10 flex items-center justify-center gap-3.5 lg:justify-start"
        >
          {/* Negative margin on the children, not `space-x-reverse` tricks: the
              stack has to overlap left-over-right, and the ring on each avatar
              is what separates them. */}
          <div className="flex">
            {PROOF.map((seed, index) => (
              <Avatar
                key={seed}
                seed={seed}
                size={38}
                className={index === 0 ? "" : "-ml-3"}
              />
            ))}
          </div>

          <div className="text-left">
            <p
              className="text-lg font-extrabold leading-tight"
              style={{ color: "var(--bridge-text)" }}
            >
              <CountUp to={120000} suffix="+" />
            </p>
            <p className="text-xs font-semibold" style={{ color: "var(--bridge-text-muted)" }}>
              messages sent today
            </p>
          </div>
        </motion.div>
      </motion.div>

      {/* --- Device column ---
          The mockup arrives last and from further down — it's the payoff, not
          part of the headline block.

          Two wrappers on purpose: the entrance animates `opacity`, and the
          scroll frosting drives `opacity` as a motion value. On one element the
          entrance would take ownership of the property and the scroll fade
          would never apply. */}
      <motion.div
        className="relative"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 44 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reduced ? 0.2 : 0.8,
          delay: reduced ? 0 : 0.4,
          ease: ease.outExpo,
        }}
      >
        <motion.div style={scrollStyle} className="relative">
          <OrbitChips />
          <PhoneMockup />
        </motion.div>
      </motion.div>
    </section>
  );
}
