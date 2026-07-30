"use client";

import type { HTMLAttributes } from "react";

type GlassPanelProps = HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
  className?: string;
  strong?: boolean;
  as?: "div" | "section";
};

export default function GlassPanel({
  children,
  className = "",
  strong = false,
  as = "div",
  ...props
}: GlassPanelProps) {
  const Tag = as;

  return (
    <Tag
      {...props}
      className={`${strong ? "premium-card-strong" : "premium-card"} ${className}`}
    >
      {children}
    </Tag>
  );
}
