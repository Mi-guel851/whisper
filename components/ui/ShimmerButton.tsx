"use client";

import useSafeReducedMotion from "@/lib/useSafeReducedMotion";

/**
 * The shimmer treatment for the primary call to action.
 *
 * React equivalent of the sv-animations / Magic UI `shimmer-button`: a spark of
 * light travels continuously around the border while a gloss sweeps across the
 * face, so the button reads as lit rather than painted.
 *
 * **It is a frame, not a replacement button.** It wraps whatever control you give
 * it instead of reimplementing one. That is deliberate: `Button`/`ButtonLink`
 * already carry the variants, sizes, press spring, pointer-origin ripple, loading
 * state and focus ring, and a parallel "shimmer button" would either duplicate all
 * of that or quietly drop some of it. Here the shimmer is additive — the CTA keeps
 * every behaviour every other button in the app has.
 *
 * The colours come from `--theme-accent-*`, so this is Whisper's palette in both
 * themes rather than the reference component's blue.
 *
 * Width: pass sizing to this frame, not the child — the frame is the outer box.
 * The child should be `w-full` so it fills it.
 */

type ShimmerButtonProps = {
  /** The real control — a `Button` or `ButtonLink`. */
  children: React.ReactNode;
  /** Seconds per full rotation of the border spark. */
  speedSeconds?: number;
  /** Seconds between gloss sweeps across the face. */
  glossSeconds?: number;
  className?: string;
};

export default function ShimmerButton({
  children,
  speedSeconds = 3.6,
  glossSeconds = 4.8,
  className = "",
}: ShimmerButtonProps) {
  const reduced = useSafeReducedMotion();

  return (
    <span
      className={`shimmer-frame ${className}`}
      style={
        {
          "--shimmer-speed": `${speedSeconds}s`,
          "--shimmer-gloss-speed": `${glossSeconds}s`,
        } as React.CSSProperties
      }
    >
      {/* The rotating spark. Oversized past the frame's bounds so the conic
          gradient still covers the corners as it turns — a conic sized to the box
          leaves the diagonals visibly thin. */}
      <span className="shimmer-spark" aria-hidden />
      <span className="shimmer-content">{children}</span>
      {/* Above the content on purpose: the gloss passes over the face of the
          button, not behind it. `pointer-events: none` keeps the press on the
          real control underneath. Dropped entirely when motion is reduced —
          a frozen diagonal white band is just a smudge. */}
      {!reduced && <span className="shimmer-gloss" aria-hidden />}
    </span>
  );
}
