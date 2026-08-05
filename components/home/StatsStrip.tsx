"use client";

import { Heart, Camera, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Reveal from "./Reveal";
import CountUp from "./CountUp";

/**
 * The proof strip that sits directly under the fold.
 *
 * It's one card with internal dividers rather than three separate cards: three
 * cards read as three claims, one card reads as a single scoreboard, and the
 * scoreboard is the more credible object. The dividers come from
 * `.stat-strip` in globals.css so they can flip from vertical to horizontal
 * when the row stacks.
 */

type Stat = {
  icon: LucideIcon;
  to: number;
  decimals?: number;
  suffix: string;
  label: string;
  tint: string;
};

const STATS: readonly Stat[] = [
  {
    icon: Heart,
    to: 2.4,
    decimals: 1,
    suffix: "M+",
    label: "Anonymous messages",
    tint: "var(--theme-accent-pink)",
  },
  {
    icon: Camera,
    to: 870,
    suffix: "K+",
    label: "Anonymous images",
    tint: "var(--theme-accent-from)",
  },
  {
    icon: Zap,
    to: 99.99,
    decimals: 2,
    suffix: "%",
    label: "Real-time delivery",
    tint: "var(--theme-accent-purple)",
  },
];

export default function StatsStrip() {
  return (
    <section className="relative mx-auto max-w-7xl px-4 sm:px-8">
      <Reveal amount={0.4}>
        <div className="premium-card stat-strip grid grid-cols-1 rounded-3xl md:grid-cols-3">
          {STATS.map((stat) => {
            const Icon = stat.icon;

            return (
              <div
                key={stat.label}
                className="flex items-center justify-center gap-4 px-6 py-7 sm:py-8"
              >
                <span
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
                  style={{
                    color: stat.tint,
                    background: `color-mix(in srgb, ${stat.tint} 14%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${stat.tint} 26%, transparent)`,
                  }}
                >
                  <Icon size={20} strokeWidth={2.2} />
                </span>

                <div className="min-w-0">
                  <p
                    className="stat-value"
                    style={{ color: "var(--bridge-text)" }}
                  >
                    <CountUp
                      to={stat.to}
                      decimals={stat.decimals}
                      suffix={stat.suffix}
                    />
                  </p>
                  <p
                    className="mt-1 text-sm font-semibold"
                    style={{ color: "var(--bridge-text-muted)" }}
                  >
                    {stat.label}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </Reveal>
    </section>
  );
}
