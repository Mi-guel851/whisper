"use client";

import { motion } from "framer-motion";
import { ease, respectMotion, staggerContainer, staggerItem } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

const steps = [
  {
    number: "01",
    title: "Create your link",
    desc: "Sign up in seconds and get your own unique Whisper link instantly.",
  },
  {
    number: "02",
    title: "Share it anywhere",
    desc: "Drop it in your Instagram bio, TikTok, Snapchat story, wherever your audience is.",
  },
  {
    number: "03",
    title: "Receive honest messages",
    desc: "Watch anonymous messages and images roll into your inbox in real time.",
  },
];

export default function HowItWorks() {
  const reduced = useSafeReducedMotion();

  return (
    <section
      id="how-it-works"
      className="relative mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24"
    >
      <motion.div
        className="mb-10 text-center sm:mb-16"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: reduced ? 0.2 : 0.6, ease: ease.outExpo }}
      >
        <h2
          className="marketing-title"
          style={{ color: "var(--bridge-text)" }}
        >
          How it works
        </h2>
        <p
          className="mt-4 text-base sm:text-xl"
          style={{ color: "var(--bridge-text-secondary)" }}
        >
          Three steps. Zero identity.
        </p>
      </motion.div>

      <motion.ol
        className="relative grid grid-cols-1 gap-6 sm:gap-8 md:grid-cols-3"
        variants={respectMotion(staggerContainer(0.1), reduced)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
      >
        {/* Connective thread. Only on the 3-across layout — stacked on mobile
            the cards are already adjacent, and a vertical line between them
            would collide with the numerals. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-[16.6%] right-[16.6%] top-16 hidden h-px md:block"
          style={{
            background:
              "linear-gradient(90deg, transparent, var(--theme-border-strong) 15%, var(--theme-border-strong) 85%, transparent)",
          }}
        />

        {steps.map((step) => (
          <motion.li
            key={step.number}
            variants={respectMotion(staggerItem, reduced)}
            className="premium-card relative rounded-3xl p-6 sm:p-8"
          >
            {/* The numeral is the ordinal, already conveyed by <ol>, so it's
                decorative to a screen reader. Sits on the shared stat scale
                rather than a one-off 5xl/6xl `font-black` — an ordinal that
                outweighs the step's own heading is bulk, not hierarchy. */}
            <div
              aria-hidden="true"
              className="theme-accent-text stat-value mb-6"
            >
              {step.number}
            </div>
            <h3
              className="mb-3 text-2xl font-bold"
              style={{
                color: "var(--bridge-text)",
                letterSpacing: "var(--tracking-2xl)",
              }}
            >
              {step.title}
            </h3>
            <p
              className="leading-7"
              style={{ color: "var(--bridge-text-secondary)" }}
            >
              {step.desc}
            </p>
          </motion.li>
        ))}
      </motion.ol>
    </section>
  );
}
