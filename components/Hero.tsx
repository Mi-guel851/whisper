"use client";

import { motion } from "framer-motion";
import { ArrowRight, Play } from "lucide-react";
import PhoneMockup from "./PhoneMockup";
import AnimatedHeading from "./AnimatedHeading";
import OrbitChips from "./home/OrbitChips";
import Avatar from "./home/Avatar";
import CountUp from "./home/CountUp";
import { ButtonLink } from "./Button";
import { ease, respectMotion, staggerContainer, staggerItem } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

const HEADING_SETTLE = 0.3;
const PROOF = ["@its_joycee", "@real_kayz", "@mimi.vibes"];

export default function Hero() {
  const reduced = useSafeReducedMotion();

  return (
    <section className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-4 pb-16 pt-28 sm:px-8 sm:pb-24 sm:pt-36 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:pt-40">
      {/* --- Copy column --- */}
      <motion.div
        className="relative z-10 text-center lg:text-left"
        variants={respectMotion(staggerContainer(0.075, HEADING_SETTLE), reduced)}
        initial="hidden"
        animate="visible"
      >
        <motion.div
          variants={respectMotion(staggerItem, reduced)}
          className="home-pill mb-6 inline-flex"
        >
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

      {/* --- Device column --- */}
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
        <div className="relative">
          <OrbitChips />
          <PhoneMockup />
        </div>
      </motion.div>
    </section>
  );
}