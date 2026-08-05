"use client";

/**
 * Deterministic identity avatar.
 *
 * The home page needs faces — a social-proof stack in the hero and one per
 * testimonial — but Whisper ships no photography, and stock portraits of people
 * who never used the product are a lie told in the first fold of a page whose
 * entire pitch is honesty. So senders get what they get inside the app: a
 * generated mark.
 *
 * The gradient is derived from the seed rather than random, so the same handle
 * is the same colour on every render, on the server and the client. A random
 * palette would hydrate mismatched and flicker on load.
 */

/** Hue pairs sampled around the brand triad — purple, pink, cyan, indigo. */
const RAMPS: ReadonlyArray<readonly [number, number]> = [
  [265, 315], // purple → magenta
  [330, 285], // pink → violet
  [190, 255], // cyan → indigo
  [225, 280], // blue → purple
  [300, 200], // magenta → cyan
  [250, 195], // indigo → cyan
];

/**
 * FNV-1a. A plain character sum collides constantly on short handles
 * ("@amy"/"@may" land on the same ramp), which is exactly the input here.
 */
function hash(seed: string) {
  let value = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    value ^= seed.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

export default function Avatar({
  seed,
  size = 40,
  className = "",
  ring = true,
}: {
  /** Handle or name. Drives both the colour and the monogram. */
  seed: string;
  size?: number;
  className?: string;
  /** The contrasting rim that separates overlapping avatars in a stack. */
  ring?: boolean;
}) {
  const digest = hash(seed);
  const [from, to] = RAMPS[digest % RAMPS.length];
  const initial = seed.replace(/^@/, "").charAt(0).toUpperCase() || "?";

  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full font-black ${className}`}
      style={{
        height: size,
        width: size,
        fontSize: Math.round(size * 0.4),
        color: "#ffffff",
        background: `linear-gradient(135deg, hsl(${from} 82% 62%), hsl(${to} 78% 52%))`,
        // A solid ring, not a translucent one: these overlap in the hero stack,
        // and a translucent rim lets the avatar underneath bleed through it.
        boxShadow: ring
          ? "0 0 0 2px var(--theme-bg), inset 0 1px 0 rgba(255, 255, 255, 0.28)"
          : "inset 0 1px 0 rgba(255, 255, 255, 0.28)",
      }}
    >
      {initial}
    </span>
  );
}
