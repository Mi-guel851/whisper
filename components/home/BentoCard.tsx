"use client";

import type { ReactNode } from "react";
import { motion, useMotionTemplate, useMotionValue, useSpring } from "framer-motion";
import { respectMotion, staggerItem } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

/**
 * A single tile in the feature bento.
 *
 * It owns two things and nothing else: the stagger entrance, and a glow that
 * tracks the pointer across the card face. Content is entirely the caller's, so
 * a tile can be a paragraph, a chart, or a mini conversation without this file
 * growing a `variant` prop per shape.
 *
 * The previous feature cards also did a 3D pointer tilt. That's gone, for two
 * reasons. It needed `perspective` on the wrapper, and `perspective` creates a
 * backdrop root — which silently disabled the `backdrop-filter` on the glass
 * card inside it, so the tiles were never actually frosted. And on a bento of
 * eight unequal tiles, eight independently tilting planes reads as a toy. The
 * lift on `.bento-card` does the same job at a whisper.
 */
export default function BentoCard({
  children,
  className = "",
  /** Tailwind column spans for the `lg` 12-column grid. */
  span = "lg:col-span-3",
}: {
  children: ReactNode;
  className?: string;
  span?: string;
}) {
  const reduced = useSafeReducedMotion();

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  // Springs rather than raw values: a glow pinned exactly to the cursor feels
  // mechanical, because nothing physical tracks that precisely.
  const glowX = useSpring(x, { stiffness: 260, damping: 34 });
  const glowY = useSpring(y, { stiffness: 260, damping: 34 });
  const glowOpacity = useSpring(0, { stiffness: 200, damping: 30 });

  const glow = useMotionTemplate`radial-gradient(300px circle at ${glowX}px ${glowY}px, color-mix(in srgb, var(--theme-accent-purple) 20%, transparent), transparent 72%)`;

  function handleMove(event: React.MouseEvent<HTMLDivElement>) {
    if (reduced) return;
    const rect = event.currentTarget.getBoundingClientRect();
    x.set(event.clientX - rect.left);
    y.set(event.clientY - rect.top);
  }

  return (
    <motion.div
      variants={respectMotion(staggerItem, reduced)}
      onMouseMove={handleMove}
      onMouseEnter={() => !reduced && glowOpacity.set(1)}
      onMouseLeave={() => glowOpacity.set(0)}
      className={`premium-card bento-card flex flex-col p-6 sm:col-span-3 ${span} ${className}`}
    >
      {/* Its own layer so it composites, rather than repainting the card's
          background on every pointer move. */}
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: glow, opacity: glowOpacity }}
      />
      {/* Content is raised above the glow; the glow is a sibling, not a
          backdrop, so without this the text would sit under the wash. */}
      <div className="relative flex h-full flex-col">{children}</div>
    </motion.div>
  );
}
