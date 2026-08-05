"use client";

import { Heart, Camera, ImageIcon, AudioLines } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The glass chips drifting around the phone mockup.
 *
 * Each one names a message type Whisper supports, so the fold shows the product
 * surface without a feature list — the chips are the caption for the device
 * beside them.
 *
 * Positions are percentages of the wrapper, not pixel offsets, so the ring
 * scales with the phone instead of collapsing onto it at narrow widths. They're
 * hidden below `lg` entirely: on a phone the mockup already fills the column,
 * and chips over it would sit on top of the conversation it's demonstrating.
 */

type Chip = {
  icon: LucideIcon;
  /** Positions read as CSS values so a chip can anchor to either edge. */
  top: string;
  left?: string;
  right?: string;
  tint: string;
  /** Seconds. Detuned per chip so the group never bobs in unison. */
  duration: number;
  delay: number;
  label: string;
};

const CHIPS: readonly Chip[] = [
  { icon: Heart, top: "12%", left: "-4%", tint: "var(--theme-accent-pink)", duration: 6.5, delay: 0, label: "Reactions" },
  { icon: Camera, top: "40%", left: "-11%", tint: "var(--theme-accent-from)", duration: 7.4, delay: 0.9, label: "Anonymous photos" },
  { icon: ImageIcon, top: "68%", left: "-3%", tint: "var(--theme-accent-purple)", duration: 6.1, delay: 1.7, label: "Media" },
  { icon: AudioLines, top: "48%", right: "-9%", tint: "var(--theme-accent-from)", duration: 7.9, delay: 0.5, label: "Voice notes" },
];

export default function OrbitChips() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden lg:block">
      {CHIPS.map((chip) => {
        const Icon = chip.icon;

        return (
          <div
            key={chip.label}
            className="home-float absolute grid h-12 w-12 place-items-center rounded-2xl"
            style={{
              top: chip.top,
              left: chip.left,
              right: chip.right,
              ["--float-duration" as string]: `${chip.duration}s`,
              ["--float-delay" as string]: `${chip.delay}s`,
              color: chip.tint,
              background: "rgba(14, 10, 26, 0.66)",
              border: `1px solid color-mix(in srgb, ${chip.tint} 42%, transparent)`,
              // The chips sit over the page backdrop, not over a card, so they
              // need their own blur to read as glass rather than as flat tiles.
              backdropFilter: "blur(18px) saturate(170%)",
              WebkitBackdropFilter: "blur(18px) saturate(170%)",
              boxShadow: `0 12px 34px rgba(0, 0, 0, 0.45), 0 0 26px color-mix(in srgb, ${chip.tint} 28%, transparent)`,
            }}
          >
            <Icon size={20} strokeWidth={2.1} />
          </div>
        );
      })}
    </div>
  );
}
