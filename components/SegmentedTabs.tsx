"use client";

import { motion } from "framer-motion";
import { useId } from "react";
import { spring, tween } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

export type SegmentedTab<T extends string> = {
  value: T;
  label: string;
  /** Rendered as a pill on the tab. Omit or pass 0 to hide. */
  badge?: number;
};

type SegmentedTabsProps<T extends string> = {
  tabs: SegmentedTab<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group, e.g. "Friends sections". */
  label: string;
  className?: string;
};

/**
 * Sliding segmented control.
 *
 * The selected pill is ONE shared element moved between tabs with a layout
 * animation, rather than a background that fades in and out per tab. That's
 * what makes it read as a physical control: the indicator travels, so the eye
 * tracks it instead of re-finding it.
 *
 * Label colour is on the label itself and always explicit — never inherited.
 * The previous version set `bg-white` and relied on a text utility that the
 * unlayered `button { color: inherit }` base rule outranked, which rendered
 * white-on-white and made the active tab look empty.
 */
export default function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className = "",
}: SegmentedTabsProps<T>) {
  const reduced = useSafeReducedMotion();
  // Scopes the shared layout animation to this instance, so two segmented
  // controls on one screen don't animate their indicators into each other.
  const layoutId = useId();

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`relative flex gap-1 rounded-2xl p-1 ${className}`}
      style={{
        background: "var(--theme-glass)",
        border: "1px solid var(--theme-glass-border)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;

        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className="segmented-tab relative flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2"
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                // Behind the label, not around it — a wrapper would make the
                // text animate its own position as the pill travels.
                className="absolute inset-0 rounded-xl"
                style={{
                  background:
                    "linear-gradient(135deg, var(--theme-accent-purple), var(--theme-accent-pink))",
                  boxShadow: "var(--elev-2)",
                }}
                transition={reduced ? { duration: 0 } : spring.snappy}
              />
            )}

            <span
              className="relative truncate text-xs font-bold"
              // Explicit on both branches. An active tab that inherits its
              // colour is one cascade change away from being invisible.
              style={{ color: active ? "#ffffff" : "var(--theme-text-muted)" }}
            >
              {tab.label}
            </span>

            {Boolean(tab.badge) && (
              <motion.span
                key={tab.badge}
                initial={reduced ? false : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={tween.fast}
                className="relative grid h-4 min-w-4 place-items-center rounded-full px-1 text-[0.625rem] font-black tabular-nums"
                style={{
                  background: active
                    ? "rgba(255, 255, 255, 0.28)"
                    : "color-mix(in srgb, var(--theme-accent-purple) 26%, transparent)",
                  color: active ? "#ffffff" : "var(--theme-accent-purple)",
                }}
              >
                {tab.badge}
              </motion.span>
            )}
          </button>
        );
      })}
    </div>
  );
}
