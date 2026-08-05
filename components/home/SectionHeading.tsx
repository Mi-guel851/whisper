"use client";

import type { ReactNode } from "react";
import Reveal from "./Reveal";

/**
 * The heading block above each marketing section.
 *
 * Every section had its own copy of this — same markup, subtly different
 * spacing and reveal timings. Centralising it is what makes the page scan as
 * one document rather than five sections that were each built on a different
 * afternoon.
 */
export default function SectionHeading({
  eyebrow,
  title,
  accent,
  description,
  align = "center",
}: {
  eyebrow?: string;
  title: ReactNode;
  /** Second line, painted in the brand gradient. */
  accent?: ReactNode;
  description?: ReactNode;
  align?: "center" | "left";
}) {
  const centered = align === "center";

  return (
    <Reveal
      className={`mb-10 sm:mb-14 ${centered ? "text-center" : "text-left"}`}
      amount={0.5}
    >
      {eyebrow && (
        <p className={`eyebrow mb-3 ${centered ? "" : ""}`}>{eyebrow}</p>
      )}

      <h2 className="marketing-title" style={{ color: "var(--bridge-text)" }}>
        {title}
        {accent && <span className="theme-accent-text block">{accent}</span>}
      </h2>

      {description && (
        <p
          className={`mt-4 text-base leading-7 sm:text-lg ${
            centered ? "mx-auto max-w-2xl" : "max-w-2xl"
          }`}
          style={{ color: "var(--bridge-text-secondary)" }}
        >
          {description}
        </p>
      )}
    </Reveal>
  );
}
