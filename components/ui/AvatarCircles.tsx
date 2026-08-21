"use client";

import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { motion } from "framer-motion";
import { Check, Lock } from "lucide-react";

/**
 * Overlapping avatar circles.
 *
 * React equivalent of the sv-animations / Magic UI `avatar-circles`. Two modes from
 * one component, because they are the same object in two states:
 *
 * * **Display** (default) — a stack of faces with a `+N` bubble once the list runs
 *   past `max`. Used for social proof.
 * * **Selectable** — the same stack, but each circle is a radio-ish button. Used by
 *   the avatar picker, where the overlap is doing real work: it shows at a glance
 *   that these are one set you pick *from*, and it fits a large set into a strip
 *   instead of a grid that would push the form off the screen.
 *
 * A circle can be marked `taken`, which renders it locked and unselectable. That is
 * presentation only — the actual guarantee that two people cannot hold the same
 * avatar is a unique constraint in the database, because a disabled button is a
 * suggestion and a unique index is a fact. See `AvatarPicker`.
 */

export type AvatarItem = {
  /** Stable identifier — this is what gets persisted, not the URL. */
  key: string;
  src?: string | null;
  label: string;
  /** Held by another user. Rendered locked. */
  taken?: boolean;
  /** Fallback wash when there is no image. */
  gradient?: string;
};

type AvatarCirclesProps = {
  items: readonly AvatarItem[];
  size?: number;
  /** Display mode only: collapse the remainder into a `+N` bubble. */
  max?: number;
  /** How far each circle sits under the previous one, in px. */
  overlap?: number;
  selectable?: boolean;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  className?: string;
};

export default function AvatarCircles({
  items,
  size = 40,
  max,
  overlap = 12,
  selectable = false,
  selectedKey = null,
  onSelect,
  className = "",
}: AvatarCirclesProps) {
  const reduced = useSafeReducedMotion();

  const shown = !selectable && max ? items.slice(0, max) : items;
  const overflow = !selectable && max ? Math.max(0, items.length - max) : 0;

  function circleBody(item: AvatarItem) {
    return item.src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.src}
        alt=""
        width={size}
        height={size}
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
      />
    ) : (
      <span
        className="grid h-full w-full place-items-center text-[0.65em] font-black uppercase"
        style={{
          background:
            item.gradient ??
            "linear-gradient(135deg, var(--theme-accent-from), var(--theme-accent-purple))",
          color: "var(--theme-accent-contrast)",
        }}
      >
        {item.label.slice(0, 2)}
      </span>
    );
  }

  return (
    <div
      className={`avatar-circles ${className}`}
      style={{ "--avatar-overlap": `${overlap}px` } as React.CSSProperties}
      role={selectable ? "radiogroup" : undefined}
      aria-label={selectable ? "Choose your avatar" : undefined}
    >
      {shown.map((item, index) =>
        selectable ? (
          <motion.button
            key={item.key}
            type="button"
            role="radio"
            aria-checked={selectedKey === item.key}
            aria-label={item.taken ? `${item.label} — already taken` : item.label}
            disabled={item.taken}
            onClick={() => !item.taken && onSelect?.(item.key)}
            whileTap={reduced || item.taken ? undefined : { scale: 0.92 }}
            /* Selected lifts clear of the stack and out of the overlap, so the
               choice is unmistakable without a separate preview slot. */
            animate={
              reduced
                ? undefined
                : { y: selectedKey === item.key ? -6 : 0, scale: selectedKey === item.key ? 1.1 : 1 }
            }
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className={`avatar-circle avatar-circle-pick ${
              selectedKey === item.key ? "avatar-circle-on" : ""
            } ${item.taken ? "avatar-circle-taken" : ""}`}
            style={{ width: size, height: size, zIndex: selectedKey === item.key ? 30 : index }}
          >
            {circleBody(item)}
            {item.taken && (
              <span className="avatar-circle-veil" aria-hidden>
                <Lock size={size * 0.3} />
              </span>
            )}
            {selectedKey === item.key && (
              <span className="avatar-circle-tick" aria-hidden>
                <Check size={11} strokeWidth={3.4} />
              </span>
            )}
          </motion.button>
        ) : (
          <span
            key={item.key}
            className="avatar-circle"
            style={{ width: size, height: size, zIndex: index }}
            title={item.label}
          >
            {circleBody(item)}
          </span>
        )
      )}

      {overflow > 0 && (
        <span
          className="avatar-circle avatar-circle-more"
          style={{ width: size, height: size, zIndex: shown.length }}
          aria-label={`and ${overflow} more`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
