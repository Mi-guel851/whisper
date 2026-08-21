"use client";

import { useEffect, useRef, useState } from "react";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";

/**
 * A word with a highlight travelling through it.
 *
 * React equivalent of the sv-animations `special-text` — the treatment for the one
 * word in a headline that should hold the eye. Here that is "Whisper." in *Honest
 * conversations start with Whisper.*
 *
 * The effect is a single wide gradient clipped to the glyphs, with a bright band
 * built into it, slid across by animating `background-position`. That choice is
 * deliberate and constrained:
 *
 * `AnimatedHeading` used to cascade a `filter` animation per character across this
 * exact headline, and it measured as the worst frame budget on the site — `filter`
 * cannot be composited, and this is the LCP element. So the highlight here is
 * scoped to one short word rather than the whole line, and it parks itself the
 * moment the headline scrolls out of view. A calm sweep on eight characters is a
 * small paint; the same idea applied to the full sentence is the bug that was
 * already fixed once.
 *
 * Colours come from `--theme-accent-*`, so the word stays on Whisper's palette in
 * both themes rather than inheriting the reference component's own.
 */

type SpecialTextProps = {
  children: React.ReactNode;
  /** Seconds per pass of the highlight. Long is calmer and less distracting. */
  speedSeconds?: number;
  className?: string;
};

export default function SpecialText({
  children,
  speedSeconds = 6,
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

  /* Reduced motion keeps the app's existing static accent gradient — the word is
     still the emphasis, it just stops moving. */
  if (reduced) {
    return <span className={`theme-accent-text ${className}`}>{children}</span>;
  }

  return (
    <span
      ref={ref}
      className={`special-text ${className}`}
      style={{ "--special-speed": `${speedSeconds}s` } as React.CSSProperties}
      data-paused={running ? undefined : "true"}
    >
      {children}
    </span>
  );
}
