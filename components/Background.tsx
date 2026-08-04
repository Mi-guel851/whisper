"use client";

import { useScroll, useTransform, motion } from "framer-motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

/**
 * Ambient backdrop: three drifting colour blobs over a faint grid.
 *
 * Parallax is driven by motion values from `useScroll`, not React state. The
 * previous version called `setScrollY` on every scroll event, which re-rendered
 * this component — and therefore reconciled it — on every frame of every
 * scroll, on every page that mounts it. Motion values write straight to the
 * style object and never touch the React tree.
 */
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
      <motion.div
        className="absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full blur-[180px]"
        style={{
          background: "var(--theme-blob-1)",
          y: still ?? blob1,
          animation: reduced ? undefined : "blobDrift 14s ease-in-out infinite",
        }}
      />

      <motion.div
        className="absolute right-[-120px] top-[80px] h-[420px] w-[420px] rounded-full blur-[180px]"
        style={{
          background: "var(--theme-blob-2)",
          y: still ?? blob2,
          animation: reduced
            ? undefined
            : "blobDrift 18s ease-in-out infinite reverse",
        }}
      />

      <motion.div
        className="absolute bottom-[-180px] left-1/2 h-[550px] w-[550px] rounded-full blur-[220px]"
        style={{
          background: "var(--theme-blob-3)",
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
