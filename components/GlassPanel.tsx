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
  style,
  ...props
}: GlassPanelProps) {
  const Tag = as;

  return (
    <Tag
      {...props}
      className={`border border-white/10 ${className}`}
      style={{
        background: strong
          ? "rgba(255,255,255,0.08)"
          : "rgba(255,255,255,0.06)",
        backdropFilter: strong
          ? "blur(60px) saturate(180%)"
          : "blur(40px) saturate(180%)",
        WebkitBackdropFilter: strong
          ? "blur(60px) saturate(180%)"
          : "blur(40px) saturate(180%)",
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 1px rgba(255,255,255,0.15), inset 0 -1px 1px rgba(0,0,0,0.2)",
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}