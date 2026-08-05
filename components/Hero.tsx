"use client";

import { useRef } from "react";
import {
  motion,
  useMotionTemplate,
  useScroll,
  useTransform,
} from "framer-motion";
import { ArrowRight } from "lucide-react";
import PhoneMockup from "./PhoneMockup";
import AnimatedHeading from "./AnimatedHeading";
import EdgeLitCard from "./EdgeLitCard";
import { ButtonLink } from "./Button";
import { ease, respectMotion, staggerContainer, staggerItem } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

/**
 * The heading runs its own per-character cascade, so the block-level stagger
 * skips over it and resumes underneath — otherwise the subhead would wait for
 * ~0.75s of character reveal before starting, and the fold would feel slow.
 */
const HEADING_SETTLE = 0.34;

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
   * The blur is applied *inside* the card, not to it. `filter` on an ancestor
   * creates a new backdrop root, which would stop `.edge-lit-inner`'s
   * `backdrop-filter` from sampling the page behind it — the glass would go
   * flat exactly when it's most visible.
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
  const settle = useTransform(scrollYProgress, [0, 1], [1, 0.95]);

  // Hooks can't be conditional, so the values are always computed and only the
  // binding is skipped when the user has asked for less motion.
  const scrollStyle = reduced
    ? undefined
    : { filter: frost, opacity: recede, scale: settle, willChange: "filter, opacity" };

  return (
    <section
      ref={sectionRef}
      className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center px-4 pb-16 pt-28 text-center sm:px-8 sm:pb-24 sm:pt-40"
    >
      <div className="relative z-10 w-full max-w-4xl">
        {/* The hero is the one card on the page that earns a bright, quick
            rim. Everything below it sweeps dimmer and slower, so the eye
            still lands here first without anything having to sit still. */}
        <EdgeLitCard
          radius="3xl"
          intensity={0.6}
          speed={11}
          innerClassName="p-6 sm:p-10"
        >
          {/* Stagger container and scroll-frost target are the same node.
              Splitting them would put a non-variant motion component between
              the container and its items, which collapses `staggerChildren` —
              every item would then reveal on the same frame. */}
          <motion.div
            style={scrollStyle}
            variants={respectMotion(
              staggerContainer(0.07, HEADING_SETTLE),
              reduced
            )}
            initial="hidden"
            animate="visible"
          >
          <motion.div
            variants={respectMotion(staggerItem, reduced)}
            className="mb-6 inline-flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-black sm:px-5 sm:text-sm"
            style={{
              color: "var(--brand-cyan)",
              background: "color-mix(in srgb, var(--brand-cyan) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--brand-cyan) 26%, transparent)",
            }}
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
            <span>👻 Anonymous messages • Images • Reactions</span>
          </motion.div>

          <AnimatedHeading />

          <motion.p
            variants={respectMotion(staggerItem, reduced)}
            className="mx-auto mt-6 max-w-2xl px-2 text-base font-medium leading-7 sm:mt-8 sm:text-xl sm:leading-9"
            style={{ color: "var(--bridge-text-secondary)" }}
          >
            Create your anonymous profile, receive honest messages, anonymous
            images, and discover what people really think of you.
          </motion.p>

          <motion.div
            variants={respectMotion(staggerItem, reduced)}
            className="mt-8 flex w-full flex-wrap items-center justify-center gap-3 sm:mt-10 sm:w-auto sm:gap-4"
          >
            <ButtonLink
              href="/signup"
              size="lg"
              iconRight={<ArrowRight size={18} />}
              className="w-full sm:w-auto"
            >
              Create my link
            </ButtonLink>
            <ButtonLink
              href="/login"
              variant="secondary"
              size="lg"
              className="w-full sm:w-auto"
            >
              Login
            </ButtonLink>
          </motion.div>

          <motion.p
            variants={respectMotion(staggerItem, reduced)}
            className="mt-6 px-4 text-sm"
            style={{ color: "var(--bridge-text-muted)" }}
          >
            Free forever · No sign-in for senders · End-to-end anonymous
          </motion.p>
          </motion.div>
        </EdgeLitCard>
      </div>

      {/* The mockup arrives last and from further down — it's the payoff, not
          part of the headline block.

          Two wrappers on purpose: the entrance animates `opacity`, and the
          scroll frosting drives `opacity` as a motion value. On one element the
          entrance would take ownership of the property and the scroll fade
          would never apply. */}
      <motion.div
        className="mt-12 w-full sm:mt-16"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reduced ? 0.2 : 0.7,
          delay: reduced ? 0 : 0.55,
          ease: ease.outExpo,
        }}
      >
        <motion.div style={scrollStyle}>
          <PhoneMockup />
        </motion.div>
      </motion.div>
    </section>
  );
}
