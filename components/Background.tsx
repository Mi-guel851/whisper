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
 *
 * The blobs carry no `blur()` filter, and each is sized to the footprint its
 * blur used to paint. `--theme-blob-N` is already a
 * `radial-gradient(circle, <colour>, transparent 68%)` — there is no edge and no
 * detail in that image for a blur to soften, so `blur-[180px]` was spending one
 * of the widest blur radii the platform supports to produce a wider, dimmer copy
 * of a gradient that can simply be authored wider. Each element grew by roughly
 * twice its old radius to land in the same place at the same extent.
 *
 * To be precise about what this buys: the win is rasterization, not per-frame
 * scrolling. Only `y` animates here, and transforming an already-rasterized
 * layer doesn't re-run its filter — so this was never costing three blurs per
 * frame. It was costing them whenever the layer is rasterized, which includes
 * first paint of the landing page and every theme switch, and a 220px-radius
 * blur over a 550px box is slow enough on mid-range mobile GPUs to be visible
 * there. Removing it also keeps these layers well inside texture limits, where
 * an oversized blur can tip into a software fallback and become far worse.
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
      {/* 500px + ~180px of blur spread each way ≈ 860px, centred on (90, 90). */}
      <motion.div
        className="absolute -left-[340px] -top-[340px] h-[860px] w-[860px] rounded-full"
        style={{
          background: "var(--theme-blob-1)",
          y: still ?? blob1,
          animation: reduced ? undefined : "blobDrift 14s ease-in-out infinite",
        }}
      />

      {/* 420px + ~180px each way ≈ 780px, centred 90px off the right edge. */}
      <motion.div
        className="absolute right-[-300px] top-[-100px] h-[780px] w-[780px] rounded-full"
        style={{
          background: "var(--theme-blob-2)",
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
