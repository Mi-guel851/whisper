"use client";

import type { HTMLAttributes, ReactNode } from "react";

type EdgeLitCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /**
   * Rim brightness, 0–1. Lower it when several cards share a screen — the
   * effect reads as premium at a whisper and as a toy at full blast.
   */
  intensity?: number;
  /** Seconds for one full rotation. Slower reads as more expensive. */
  speed?: number;
  radius?: "lg" | "xl" | "2xl" | "3xl";
  innerClassName?: string;
};

const radiusMap = {
  lg: "var(--radius-lg)",
  xl: "var(--radius-xl)",
  "2xl": "var(--radius-2xl)",
  "3xl": "var(--radius-3xl)",
};

/**
 * Card with a conic-gradient rim that sweeps continuously — the same effect the
 * auth screens use, generalized. The rotation is a single registered
 * `<angle>` custom property animated in CSS, so it runs off the main thread and
 * costs nothing per card; `prefers-reduced-motion` freezes it at a fixed angle
 * in globals.css rather than removing the rim.
 *
 * Tune with `intensity`/`speed`, not by disabling the motion — the sweep is the
 * effect.
 */
export default function EdgeLitCard({
  children,
  intensity = 0.55,
  speed = 9,
  radius = "2xl",
  className = "",
  innerClassName = "",
  style,
  ...props
}: EdgeLitCardProps) {
  return (
    <div
      {...props}
      className={`edge-lit ${className}`}
      style={{
        // Consumed by the .edge-lit rules in globals.css.
        ["--edge-opacity" as string]: intensity,
        ["--edge-speed" as string]: `${speed}s`,
        borderRadius: radiusMap[radius],
        ...style,
      }}
    >
      <div
        className={`edge-lit-inner ${innerClassName}`}
        style={{ borderRadius: `calc(${radiusMap[radius]} - 1px)` }}
      >
        {children}
      </div>
    </div>
  );
}
