"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import EdgeLitCard from "./EdgeLitCard";
import { ButtonLink } from "./Button";
import { respectMotion, staggerContainer, staggerItem } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

export default function ClosingCTA() {
  const reduced = useSafeReducedMotion();

  return (
    <section className="relative mx-auto max-w-5xl px-4 py-16 text-center sm:px-8 sm:py-24">
      <motion.div
        variants={respectMotion(staggerContainer(0.08), reduced)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.35 }}
      >
        {/* The closing CTA is the last thing on the page, so its rim runs
            brighter than the sections above it but slower than the hero —
            the eye should settle here, not be pulled back to the top. */}
        <EdgeLitCard
          radius="3xl"
          intensity={0.55}
          speed={13}
          innerClassName="p-8 sm:p-16"
        >
          {/* Slow float rather than `animate-pulse`. Pulsing opacity on a logo
              reads as a loading state; drifting reads as ambient. */}
          <motion.div
            variants={respectMotion(staggerItem, reduced)}
            className="mx-auto mb-6 w-fit"
          >
            <motion.div
              animate={reduced ? undefined : { y: [0, -8, 0] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
            >
              <Image
                src="/ghost.png"
                alt=""
                width={64}
                height={64}
                className="drop-shadow-[0_0_18px_rgba(34,211,238,0.75)]"
              />
            </motion.div>
          </motion.div>

          <motion.h2
            variants={respectMotion(staggerItem, reduced)}
            className="marketing-title"
            style={{ color: "var(--bridge-text)" }}
          >
            Ready to hear the truth?
          </motion.h2>

          <motion.p
            variants={respectMotion(staggerItem, reduced)}
            className="mx-auto mt-4 max-w-xl text-base sm:text-xl"
            style={{ color: "var(--bridge-text-secondary)" }}
          >
            Create your Whisper link and start receiving honest, anonymous
            messages today.
          </motion.p>

          <motion.div
            variants={respectMotion(staggerItem, reduced)}
            className="mt-8 sm:mt-10"
          >
            <ButtonLink
              href="/signup"
              size="lg"
              className="w-full sm:w-auto"
            >
              Create My Link — It&apos;s Free
            </ButtonLink>
          </motion.div>
        </EdgeLitCard>
      </motion.div>
    </section>
  );
}
