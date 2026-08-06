"use client";

import { useScroll, useTransform, motion } from "framer-motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

const BLOB_ALPHA = 0.55;

export default function Background() {
  const { scrollY } = useScroll();
  const reduced = useSafeReducedMotion();

  // Different rates per layer are what sell the depth; matching them would
  // read as one flat image sliding.
  const blob1 = useTransform(scrollY, [0, 1200], [0, 180]);
  const blob2 = useTransform(scrollY, [0, 1200], [0, -120]);
  const blob3 = useTransform(scrollY, [0, 1200], [0, 300]);
  const grid = useTransform(scrollY, [0, 1200], [0, 60]);

  const still = reduced ? 0 : undefined;

  return (
    <div className="theme-bg-gradient fixed inset-0 -z-10 overflow-hidden">
      {/* 500px + ~180px of blur spread each way ≈ 860px, centred on (90, 90). */}
      <motion.div
        className="absolute -left-[340px] -top-[340px] h-[860px] w-[860px] rounded-full"
        style={{
          background: "var(--theme-blob-1)",
          opacity: BLOB_ALPHA,
          y: still ?? blob1,
          animation: reduced ? undefined : "blobDrift 14s ease-in-out infinite",
        }}
      />

      {/* 420px + ~180px each way ≈ 780px, centred 90px off the right edge. */}
      <motion.div
        className="absolute right-[-300px] top-[-100px] h-[780px] w-[780px] rounded-full"
        style={{
          background: "var(--theme-blob-2)",
          opacity: BLOB_ALPHA,
          y: still ?? blob2,
          animation: reduced
            ? undefined
            : "blobDrift 18s ease-in-out infinite reverse",
        }}
      />

      {/* 550px + ~220px each way ≈ 990px, centred 95px below the fold edge. */}
      <motion.div
        className="absolute bottom-[-400px] left-1/2 h-[990px] w-[990px] rounded-full"
        style={{
          background: "var(--theme-blob-3)",
          opacity: BLOB_ALPHA,
          x: "-50%",
          y: still ?? blob3,
        }}
      />

      {/* Grid. Opacity is a token because a white grid over the light theme's
          pale canvas is invisible — it needs to darken instead. */}
      <motion.div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
          maskImage:
            "radial-gradient(ellipse 80% 60% at 50% 40%, #000 40%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 60% at 50% 40%, #000 40%, transparent 100%)",
          y: still ?? grid,
        }}
      />
    </div>
  );
}
