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
      className={`border ${className}`}
      style={{
        background: strong
          ? "var(--theme-surface-strong)"
          : "var(--theme-card)",
        backdropFilter: strong
          ? "blur(60px) saturate(180%)"
          : "blur(40px) saturate(180%)",
        WebkitBackdropFilter: strong
          ? "blur(60px) saturate(180%)"
          : "blur(40px) saturate(180%)",
        borderColor: "var(--theme-border)",
        boxShadow: "var(--theme-shadow)",
        transition: "background-color 260ms ease, border-color 220ms ease, box-shadow 260ms ease",
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}