"use client";

import { useEffect, useRef, useState } from "react";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";

/**
 * A continuously scrolling rail.
 *
 * React equivalent of the sv-animations / Magic UI `marquee`. The mechanism is a
 * single `transform: translateX` keyframe on a duplicated track: copy N of the
 * children is laid out end-to-end, and the track travels exactly one copy's width
 * plus one gap before looping, which puts copy 2 precisely where copy 1 started.
 * That is what makes the seam invisible — the loop point is a position the eye
 * has already accepted.
 *
 * Two things worth knowing about this implementation:
 *
 * 1. **Reduced motion falls back to a real scroll rail, not a frozen track.**
 *    The global `prefers-reduced-motion` block forces `animation-duration:
 *    0.01ms; animation-iteration-count: 1` on everything, which would slam this
 *    track to its *end* position and leave the first copy off-screen — the
 *    content would simply be gone. So when motion is reduced we render one copy
 *    in an overflow-scroll container instead, which is reachable by touch,
 *    trackpad and keyboard.
 *
 * 2. **It stops when it is off-screen.** An infinite transform animation is
 *    cheap but not free: the compositor keeps producing frames for it forever,
 *    on a landing page the user has probably scrolled past. An
 *    IntersectionObserver parks it, which matters on the mid-range Android this
 *    app is tuned for.
 */

type MarqueeProps = {
  children: React.ReactNode;
  /** Travel right-to-left (default) or left-to-right. */
  reverse?: boolean;
  /** Freeze while the pointer is over the rail, so a card can be read. */
  pauseOnHover?: boolean;
  /** Copies of `children` laid end-to-end. Two is the minimum for a seamless
   *  loop; three helps when one copy is narrower than the viewport. */
  repeat?: number;
  /** Seconds for one full traversal. Longer reads calmer. */
  durationSeconds?: number;
  gapRem?: number;
  /** Fades the two ends so items enter and leave instead of being clipped. */
  fadeEdges?: boolean;
  className?: string;
  itemsLabel?: string;
};

export default function Marquee({
  children,
  reverse = false,
  pauseOnHover = true,
  repeat = 3,
  durationSeconds = 42,
  gapRem = 1,
  fadeEdges = true,
  className = "",
  itemsLabel,
}: MarqueeProps) {
  const reduced = useSafeReducedMotion();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || reduced) return;

    /* `rootMargin` starts it slightly before it scrolls into view, so the first
       frame the user sees is already moving rather than jerking into life. */
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "150px 0px" }
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [reduced]);

  const edgeMask = fadeEdges
    ? {
        maskImage:
          "linear-gradient(to right, transparent, #000 10%, #000 90%, transparent)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent, #000 10%, #000 90%, transparent)",
      }
    : undefined;

  /* See note 1: a scroll rail, not a stalled animation. */
  if (reduced) {
    return (
      <div
        className={`marquee-static ${className}`}
        style={{ gap: `${gapRem}rem`, ...edgeMask }}
        tabIndex={0}
        role="group"
        aria-label={itemsLabel}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className={`marquee-host ${pauseOnHover ? "marquee-hoverable" : ""} ${className}`}
      style={
        {
          "--marquee-duration": `${durationSeconds}s`,
          "--marquee-gap": `${gapRem}rem`,
          ...edgeMask,
        } as React.CSSProperties
      }
      role="group"
      aria-label={itemsLabel}
    >
      {Array.from({ length: Math.max(2, repeat) }, (_, copy) => (
        <div
          key={copy}
          className="marquee-track"
          style={{ animationDirection: reverse ? "reverse" : "normal" }}
          data-paused={visible ? undefined : "true"}
          /* Only the first copy is real content. The duplicates exist to make
             the loop seamless, and a screen reader reading six testimonials
             three times over is a bug, not thoroughness. */
          aria-hidden={copy > 0 ? true : undefined}
        >
          {children}
        </div>
      ))}
    </div>
  );
}
