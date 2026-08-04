"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { staggerItem } from "@/lib/motion";

type PersonRowProps = {
  avatarUrl: string;
  name: string;
  /** Muted second line — "Active now", "Wants to be friends", mutuals. */
  subtitle: ReactNode;
  online?: boolean;
  /** Buttons. Laid out beside the name on wide rows, below it on narrow. */
  actions: ReactNode;
};

/**
 * One person, one row.
 *
 * Facebook's friends list is the reference: a large avatar, a name that owns
 * the line, a quiet second line, and actions that sit on their own row on
 * narrow screens instead of being squeezed next to the name. Cramming the
 * action beside the name is what made the old "Add Friend" button look
 * disfigured — it was competing with a truncating name for the same 80px.
 */
export default function PersonRow({
  avatarUrl,
  name,
  subtitle,
  online = false,
  actions,
}: PersonRowProps) {
  return (
    <motion.div
      variants={staggerItem}
      className="person-row flex items-center gap-3.5 rounded-2xl p-3.5 sm:gap-4 sm:p-4"
    >
      <div className="relative shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl}
          alt=""
          loading="lazy"
          className="h-14 w-14 rounded-full object-cover"
          style={{
            border: "1px solid var(--theme-glass-border)",
            background: "var(--fill-2)",
          }}
        />
        {online && (
          <span
            className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full"
            style={{
              background: "var(--theme-success)",
              // Rings against the row, not the page, so it reads as attached
              // to the avatar at any surface colour.
              boxShadow: "0 0 0 2.5px var(--theme-surface)",
            }}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="card-title truncate">{name}</p>
          <p className="truncate text-xs theme-text-muted">{subtitle}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    </motion.div>
  );
}
