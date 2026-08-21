"use client";

import { Fragment } from "react";
import { motion } from "framer-motion";
import { ease } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import SpecialText from "./ui/SpecialText";

const LEAD = "Honest conversations start with";
const ACCENT = "Whisper.";

/* Seconds between one word's highlight and the next. Six words at 0.4s means the
   band takes ~2s to cross the line, then the rest of the 6s cycle is the pause
   before it comes round again — a periodic sweep rather than a constant shimmer. */
const SWEEP_STEP = 0.4;

/**
 * The hero headline, revealed word by word, then swept by a travelling highlight.
 *
 * The entrance used to cascade per *character*. At 39 characters that's 39 motion
 * components, each animating `filter` — and `filter` can't be composited, so
 * every one of them forced a paint on the largest text on the page, during the
 * first second of the first render. It measured as the worst frame budget on
 * the site.
 *
 * Per-word is 6 nodes for the same read. The blur still resolves, the cascade
 * still reads left-to-right, and the LCP element stops thrashing.
 *
 * The highlight is a separate, cheaper thing: one CSS `background-position` per
 * word, no React and no layout, phase-offset so it reads as a single band. See
 * `SpecialText` for why that is not a repeat of the bug above.
 */
export default function AnimatedHeading({ className = "" }: { className?: string }) {
  const reduced = useSafeReducedMotion();

  const words = [...LEAD.split(" "), ACCENT];

  return (
    <h1 className={`hero-title ${className}`} style={{ color: "var(--bridge-text)" }}>
      {words.map((word, index) => (
        <Fragment key={`${word}-${index}`}>
          <motion.span
            // inline-block so the transform applies; the space that follows is
            // a real text node outside it, so the browser can still wrap here.
            className="inline-block"
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
            {/* Every word carries the highlight, not just the accent one. The
                band inside each word travels left to right, so for the sweep to
                read as one motion the leftmost word has to light first — which
                means the *most* advanced phase, i.e. the most negative offset.
                The last word gets 0 and lights last.

                `SpecialText` carries the gradient itself, including the static
                `theme-accent-text` fallback under reduced motion, so the class no
                longer belongs on the wrapper. "Whisper." keeps its full stop
                inside the same span so the punctuation is swept with it. */}
            <SpecialText delaySeconds={-(words.length - 1 - index) * SWEEP_STEP}>
              {word}
            </SpecialText>
          </motion.span>
          {index < words.length - 1 && " "}
        </Fragment>
      ))}
    </h1>
  );
}
