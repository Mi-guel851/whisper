"use client";

import { useEffect, useRef, useState } from "react";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";

/**
 * Text with a highlight travelling through it.
 *
 * React equivalent of the sv-animations `special-text`. It carries the whole hero
 * headline — *Honest conversations start with Whisper.* — one instance per word,
 * phase-offset so the band reads as a single sweep crossing the sentence instead
 * of six words pulsing together.
 *
 * The effect is a single wide gradient clipped to the glyphs, with a bright band
 * built into it, slid across by animating `background-position`.
 *
 * On cost, because this headline has a history: `AnimatedHeading` used to cascade
 * a `filter` animation per *character* across this exact line, and it measured as
 * the worst frame budget on the site. This is not that. That was 39 motion
 * components each animating an uncompositable `filter` — which also forces the
 * blur to be recomputed over the largest text on the page — driven by React. This
 * is one CSS `background-position` per word, no layout, no React, no blur, and it
 * parks itself the moment the headline scrolls out of view. Six of them is a
 * repaint of one text block per frame.
 *
 * Which is also why `will-change` is deliberately absent from `.special-text`:
 * `background-position` cannot be composited, so the hint cannot save the paint —
 * it only asks the browser to hold a layer for text that is on screen for the
 * life of the page.
 *
 * Colours come from `--theme-accent-*`, so the words stay on Whisper's palette in
 * both themes rather than inheriting the reference component's own.
 */

type SpecialTextProps = {
  children: React.ReactNode;
  /** Seconds per pass of the highlight. Long is calmer and less distracting. */
  speedSeconds?: number;
  /**
   * Phase offset, in seconds. Negative starts the highlight already advanced, so
   * a run of words given decreasing offsets lights up left to right and the band
   * appears to travel across all of them. Positive would leave the word dark for
   * that long on load, which is why callers pass negatives.
   */
  delaySeconds?: number;
  className?: string;
};

export default function SpecialText({
  children,
  speedSeconds = 6,
  delaySeconds = 0,
  className = "",
}: SpecialTextProps) {
  const reduced = useSafeReducedMotion();
  const ref = useRef<HTMLSpanElement | null>(null);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced) return;
    const observer = new IntersectionObserver(([entry]) =>
      setRunning(entry.isIntersecting)
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced]);

  /* Reduced motion keeps the app's existing static accent gradient — the words are
     still the emphasis, they just stop moving. */
  if (reduced) {
    return <span className={`theme-accent-text ${className}`}>{children}</span>;
  }

  return (
    <span
      ref={ref}
      className={`special-text ${className}`}
      style={
        {
          "--special-speed": `${speedSeconds}s`,
          "--special-delay": `${delaySeconds}s`,
        } as React.CSSProperties
      }
      data-paused={running ? undefined : "true"}
    >
      {children}
    </span>
  );
}
