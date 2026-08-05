"use client";

import { motion } from "framer-motion";
import { Link2, Share2, Inbox, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import SectionHeading from "./home/SectionHeading";
import { respectMotion, staggerContainer, staggerItem } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

/**
 * How it works.
 *
 * This used to be three `premium-card` panels in a row. Cards were the wrong
 * container: a card says "here is a discrete thing", and these four items are
 * one continuous process. Circular nodes strung along a dashed thread say
 * *sequence* — the shape carries the meaning, so the copy doesn't have to.
 *
 * Dropping the card shells also removed three large surfaces from a page that
 * already has a bento grid and a stats card above it. The section reads as a
 * breath between two dense blocks now, which is what it's for.
 */

type Step = {
  icon: LucideIcon;
  title: string;
  desc: string;
};

const STEPS: readonly Step[] = [
  {
    icon: Link2,
    title: "Create your link",
    desc: "Sign up in seconds and get your own unique Whisper link instantly.",
  },
  {
    icon: Share2,
    title: "Share it anywhere",
    desc: "Drop it in your Instagram bio, TikTok, or Snapchat story — wherever your people are.",
  },
  {
    icon: Inbox,
    title: "Receive messages",
    desc: "Anonymous messages, photos and voice notes land in your inbox in real time.",
  },
  {
    icon: Sparkles,
    title: "Reply and react",
    desc: "Answer back, react with an emoji, and share the best ones to your story.",
  },
];

export default function HowItWorks() {
  const reduced = useSafeReducedMotion();

  return (
    <section
      id="how-it-works"
      className="relative mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24"
    >
      <SectionHeading
        eyebrow="Live in under a minute"
        title="How it"
        accent="works."
        description="Four steps. Zero identity. Nothing to install."
      />

      <motion.ol
        className="relative grid grid-cols-1 gap-10 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-14 lg:grid-cols-4 lg:gap-8"
        variants={respectMotion(staggerContainer(0.1), reduced)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.25 }}
      >
        {/* The thread only exists on the 4-across layout. Stacked or two-up it
            would run between items that aren't consecutive, which would be a
            line that actively lies about the order.

            Insets of 12.5% put each end at the centre of the first and last
            node (half of a quarter-width column), so it joins the circles
            rather than overshooting past them. */}
        <div
          aria-hidden="true"
          className="step-thread pointer-events-none absolute left-[12.5%] right-[12.5%] top-7 hidden h-px lg:block"
        />

        {STEPS.map((step, index) => {
          const Icon = step.icon;

          return (
            <motion.li
              key={step.title}
              variants={respectMotion(staggerItem, reduced)}
              className="relative flex flex-col items-center text-center"
            >
              {/* Sits above the thread so the dashes stop at the circle's edge
                  instead of running visibly across the glass. */}
              <div className="relative mb-5">
                <span className="step-node">
                  <Icon size={22} strokeWidth={2.1} />
                </span>

                {/* The ordinal is already carried by <ol> for assistive tech,
                    so this badge is decorative — it exists to let a sighted eye
                    count the sequence without reading it. */}
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full text-[11px] font-black"
                  style={{
                    color: "#ffffff",
                    background:
                      "linear-gradient(135deg, var(--theme-accent-from), var(--theme-accent-to))",
                    border: "2px solid var(--theme-bg)",
                  }}
                >
                  {index + 1}
                </span>
              </div>

              <h3
                className="mb-2 text-lg font-bold"
                style={{
                  color: "var(--bridge-text)",
                  letterSpacing: "var(--tracking-lg)",
                }}
              >
                {step.title}
              </h3>
              <p
                className="max-w-xs text-sm leading-6"
                style={{ color: "var(--bridge-text-secondary)" }}
              >
                {step.desc}
              </p>
            </motion.li>
          );
        })}
      </motion.ol>
    </section>
  );
}
