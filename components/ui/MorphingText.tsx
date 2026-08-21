"use client";

import { useEffect, useRef, useState } from "react";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";

/**
 * Text that dissolves from one string into the next.
 *
 * React equivalent of the sv-animations / Magic UI `morphing-text`. Two layers
 * hold the outgoing and incoming strings; each gets a `blur()` and an opacity
 * driven from the same progress value, one rising while the other falls. The blur
 * is what makes it read as a morph instead of a crossfade — the letters lose their
 * edges before they change, so the eye never catches the swap.
 *
 * Implementation notes:
 *
 * * **One rAF loop, not a state update per frame.** The filter and opacity are
 *   written straight to the two nodes' styles through refs. A `setState` per frame
 *   would re-render the subtree 60 times a second for what is a purely visual
 *   change, which on the send page would be competing with someone typing.
 * * **The loop parks itself off-screen.** `filter` cannot be composited — it
 *   repaints — so leaving several of these running behind a scrolled-past viewport
 *   is exactly the kind of cost this app has been trimmed of elsewhere.
 * * **Reduced motion gets the first string, statically.** No cycling, no blur.
 */

type MorphingTextProps = {
  /** Two or more strings to cycle through. */
  texts: readonly string[];
  /** Seconds each string is held fully legible. */
  holdSeconds?: number;
  /** Seconds spent morphing between two strings. */
  morphSeconds?: number;
  /** Peak blur at the midpoint, in px. Higher dissolves harder. */
  blurPx?: number;
  /** Offsets where in the cycle this instance starts, so several on one screen
   *  do not change in lockstep. 0–1. */
  phase?: number;
  className?: string;
};

export default function MorphingText({
  texts,
  holdSeconds = 2.4,
  morphSeconds = 1.1,
  blurPx = 7,
  phase = 0,
  className = "",
}: MorphingTextProps) {
  const reduced = useSafeReducedMotion();
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const outRef = useRef<HTMLSpanElement | null>(null);
  const inRef = useRef<HTMLSpanElement | null>(null);

  /* Which pair is on screen. This is the only thing that re-renders, and it does
     so once per morph rather than once per frame. */
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || reduced) return;
    const observer = new IntersectionObserver(
      ([entry]) => setRunning(entry.isIntersecting),
      { rootMargin: "120px 0px" }
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [reduced]);

  useEffect(() => {
    if (reduced || !running || texts.length < 2) return;

    const cycle = holdSeconds + morphSeconds;
    let frame = 0;
    let start = 0;
    /* Tracked locally so the rAF loop never reads React state — it advances the
       index through the setter and keeps its own copy in step. */
    let shown = 0;
    /* Last value actually written. During the hold phase — around two thirds of
       every cycle — the target is unchanged, and re-writing an identical `filter`
       still costs a style invalidation. Several of these run at once on the send
       page, so the skip is worth the two lines. */
    let written = -1;

    function tick(now: number) {
      if (!start) start = now - phase * cycle * 1000;
      const elapsed = (now - start) / 1000;
      const step = Math.floor(elapsed / cycle);
      const within = elapsed - step * cycle;

      if (step !== shown) {
        shown = step;
        setIndex(step % texts.length);
      }

      /* 0 while held, then 0→1 across the morph window. */
      const t =
        within < holdSeconds ? 0 : (within - holdSeconds) / morphSeconds;
      /* Smoothstep: the ends are flat, so the string is fully sharp for a beat
         before it starts to go and after it arrives. A linear ramp never looks
         settled. */
      const eased = t * t * (3 - 2 * t);

      const outNode = outRef.current;
      const inNode = inRef.current;
      if (outNode && inNode && Math.abs(eased - written) > 0.002) {
        written = eased;
        outNode.style.opacity = String(1 - eased);
        outNode.style.filter = `blur(${eased * blurPx}px)`;
        inNode.style.opacity = String(eased);
        inNode.style.filter = `blur(${(1 - eased) * blurPx}px)`;
      }

      frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced, running, texts.length, holdSeconds, morphSeconds, blurPx, phase]);

  if (reduced || texts.length < 2) {
    return <span className={className}>{texts[0] ?? ""}</span>;
  }

  const next = texts[(index + 1) % texts.length];

  return (
    /* Grid-stacked rather than absolutely positioned: both layers occupy the same
       cell, so the host sizes itself to the widest string on its own and the text
       does not need a hardcoded width to stop it jumping. */
    <span ref={hostRef} className={`morph-host ${className}`}>
      <span ref={outRef} className="morph-layer">
        {texts[index]}
      </span>
      <span ref={inRef} className="morph-layer" style={{ opacity: 0 }} aria-hidden>
        {next}
      </span>
    </span>
  );
}
