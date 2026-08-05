"use client";

import { Fragment } from "react";
import { motion } from "framer-motion";
import { ease } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

const LEAD = "Honest conversations start with";
const ACCENT = "Whisper.";

/**
 * The hero headline, revealed word by word.
 *
 * This used to cascade per *character*. At 39 characters that's 39 motion
 * components, each animating `filter` — and `filter` can't be composited, so
 * every one of them forced a paint on the largest text on the page, during the
 * first second of the first render. It measured as the worst frame budget on
 * the site.
 *
 * Per-word is 6 nodes for the same read. The blur still resolves, the cascade
 * still reads left-to-right, and the LCP element stops thrashing.
 */
export default function AnimatedHeading({ className = "" }: { className?: string }) {
  const reduced = useSafeReducedMotion();

  const words = [
    ...LEAD.split(" ").map((word) => ({ word, accent: false })),
    { word: ACCENT, accent: true },
  ];

  return (
    <h1 className={`hero-title ${className}`} style={{ color: "var(--bridge-text)" }}>
      {words.map(({ word, accent }, index) => (
        <Fragment key={`${word}-${index}`}>
          <motion.span
            // inline-block so the transform applies; the space that follows is
            // a real text node outside it, so the browser can still wrap here.
            className={`inline-block ${accent ? "theme-accent-text" : ""}`}
            initial={
              reduced
                ? { opacity: 0 }
                : { opacity: 0, y: "0.35em", filter: "blur(10px)" }
            }
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{
              duration: reduced ? 0.2 : 0.66,
              delay: reduced ? 0 : index * 0.075,
              ease: ease.outExpo,
            }}
          >
            {word}
          </motion.span>
          {index < words.length - 1 && " "}
        </Fragment>
      ))}
    </h1>
  );
}
