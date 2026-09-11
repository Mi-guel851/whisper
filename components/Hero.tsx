"use client";

import { motion } from "framer-motion";
import { ArrowRight, Play } from "lucide-react";
import PhoneMockup from "./PhoneMockup";
import AnimatedHeading from "./AnimatedHeading";
import OrbitChips from "./home/OrbitChips";
import Avatar from "./home/Avatar";
import CountUp from "./home/CountUp";
import { ButtonLink } from "./Button";
import DownloadAndroidButton from "./DownloadAndroidButton";
import ShimmerButton from "./ui/ShimmerButton";
import { ease, respectMotion, staggerContainer, staggerItem } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { shouldShowPlatformChoice } from "@/lib/platformChoice";

const HEADING_SETTLE = 0.3;
const PROOF = ["@its_joycee", "@real_kayz", "@mimi.vibes"];

export default function Hero() {
  const reduced = useSafeReducedMotion();
  const router = useRouter();
  const handleCreateLink = (e: React.MouseEvent) => {
    e.preventDefault();
    let isNative = false;
    try { isNative = Capacitor.isNativePlatform(); } catch {}
    router.push(shouldShowPlatformChoice(isNative) ? "/choose-platform" : "/signup");
  };

  return (
    <section className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 pb-12 pt-24 sm:px-8 sm:pb-20 sm:pt-28 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:pb-24 lg:pt-32">
      {/* --- Copy column --- */}
      <motion.div
        className="relative z-10 text-center lg:text-left"
        variants={respectMotion(staggerContainer(0.075, HEADING_SETTLE), reduced)}
        initial="hidden"
        animate="visible"
      >
        <motion.div
          variants={respectMotion(staggerItem, reduced)}
          className="home-pill mb-5 inline-flex"
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
          className="mx-auto mt-5 max-w-lg text-base leading-7 sm:text-lg sm:leading-8 lg:mx-0"
          style={{ color: "var(--bridge-text-secondary)" }}
        >
          Receive anonymous messages, photos, voice notes and reactions from the
          people who know you — completely honestly.
        </motion.p>

        <motion.div
          variants={respectMotion(staggerItem, reduced)}
          className="mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center lg:justify-start"
        >
          <ShimmerButton className="w-full sm:w-auto">
            <a
              href="/signup"
              onClick={handleCreateLink}
              className="premium-button premium-button-primary h-11 px-6 text-[15px] rounded-full w-full inline-flex items-center justify-center gap-2 font-bold whitespace-nowrap"
            >
              Create My Link
              <ArrowRight size={18} />
            </a>
          </ShimmerButton>
          <ButtonLink
            href="/#how-it-works"
            variant="outline"
            size="md"
            className="h-11 w-full sm:w-auto"
            icon={<Play size={15} fill="currentColor" />}
          >
            See how it works
          </ButtonLink>
        </motion.div>

        {/* The store lockup, not a one-line label: "Download Android app — Get
            it on Google Play" measured 307px in Roboto and this column gives a
            320px phone 288px, so the old pill was overflowing its own section.
            The badge arrangement says the same thing in 142px. */}
        <motion.div
          variants={respectMotion(staggerItem, reduced)}
          className="mt-3 flex justify-center lg:justify-start"
        >
          <DownloadAndroidButton
            variant="ghost"
            size="sm"
            lockup="store"
            label="Download Android app — Get it on Google Play"
            className="max-w-full"
          />
        </motion.div>

        {/* --- Social proof --- */}
        <motion.div
          variants={respectMotion(staggerItem, reduced)}
          className="mt-8 flex items-center justify-center gap-3.5 lg:justify-start"
        >
          <div className="flex">
            {PROOF.map((seed, index) => (
              <Avatar
                key={seed}
                seed={seed}
                size={34}
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
