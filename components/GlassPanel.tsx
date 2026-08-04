"use client";

import type { HTMLAttributes } from "react";

type GlassPanelProps = HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
  className?: string;
  /** Higher-opacity variant — use when content sits directly on the panel. */
  strong?: boolean;
  /** Adds a hover lift + deeper shadow. Only for panels that are clickable. */
  interactive?: boolean;
  /** Overrides the default shadow depth (3 for panels, 4 for strong). */
  elevation?: 1 | 2 | 3 | 4 | 5;
  as?: "div" | "section" | "article" | "aside";
};

export default function GlassPanel({
  children,
  className = "",
  strong = false,
  interactive = false,
  elevation,
  as = "div",
  style,
  ...props
}: GlassPanelProps) {
  const Tag = as;

  return (
    <Tag
      {...props}
      className={`${strong ? "premium-card-strong" : "premium-card"} ${
        interactive ? "premium-card-interactive" : ""
      } ${className}`}
      style={
        elevation
          ? { boxShadow: `var(--elev-${elevation}), var(--elev-rim)`, ...style }
          : style
      }
    >
      {children}
    </Tag>
  );
}
