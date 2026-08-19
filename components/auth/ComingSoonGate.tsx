"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Hourglass } from "lucide-react";
import AuthShell, { AuthBrand } from "@/components/auth/AuthShell";
import AmbientFloaters from "@/components/AmbientFloaters";
import { SIGNUP_GATE_COPY } from "@/lib/signupGate";
import { fadeUp, respectMotion, spring, staggerContainer } from "@/lib/motion";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";

/**
 * The screen a would-be new user sees while signups are closed.
 *
 * Built on AuthShell rather than as its own layout, so it inherits the aurora
 * backdrop and the edge-lit card every other auth screen uses — a dead end
 * that looks like a different product reads as a broken link rather than a
 * deliberate "not yet".
 *
 * The login link is the most important element here: the people most likely to
 * hit this screen are testers who tapped the wrong button, and the way out has
 * to be obvious rather than a browser back press.
 */
export default function ComingSoonGate() {
  const reduced = useSafeReducedMotion();

  return (
    <AuthShell>
      <AmbientFloaters />

      <motion.div
        className="relative z-10"
        variants={staggerContainer(0.07)}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={respectMotion(fadeUp, reduced)}>
          <AuthBrand />
        </motion.div>

        {/* The hourglass tips rather than spins. A spinner would read as
            "working on it, wait here"; a slow tilt reads as time passing,
            which is the actual message. */}
        <motion.div
          className="auth-badge mt-6"
          variants={respectMotion(fadeUp, reduced)}
          animate={
            reduced
              ? undefined
              : { rotate: [0, 12, 0, -12, 0] }
          }
          transition={
            reduced
              ? undefined
              : { duration: 6, repeat: Infinity, ease: [0.65, 0, 0.35, 1] }
          }
        >
          <Hourglass size={24} />
        </motion.div>

        <motion.h1
          className="auth-title mt-4"
          variants={respectMotion(fadeUp, reduced)}
        >
          {SIGNUP_GATE_COPY.title}
        </motion.h1>

        <motion.p
          className="auth-subtitle"
          variants={respectMotion(fadeUp, reduced)}
        >
          {SIGNUP_GATE_COPY.body}
        </motion.p>

        <motion.div
          className="mt-7 space-y-4"
          variants={respectMotion(fadeUp, reduced)}
        >
          <p className="auth-note">{SIGNUP_GATE_COPY.note}</p>

          <motion.div whileTap={reduced ? undefined : { scale: 0.97 }} transition={spring.snappy}>
            <Link href="/login" className="auth-submit block text-center">
              Back to login
            </Link>
          </motion.div>
        </motion.div>

        <motion.p
          className="auth-footnote"
          variants={respectMotion(fadeUp, reduced)}
        >
          Want a heads-up when we open?{" "}
          <Link href="/contact-support" className="auth-link">
            Tell us
          </Link>
        </motion.p>
      </motion.div>
    </AuthShell>
  );
}
