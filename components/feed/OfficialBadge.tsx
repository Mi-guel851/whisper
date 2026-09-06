"use client";

import { BadgeCheck } from "lucide-react";
import { OFFICIAL_IDENTITY } from "@/lib/creator";

/**
 * The verified / official mark for Whisper creator content.
 *
 * Rendered only where the caller has already established, from a trusted
 * source, that the identity is official — i.e. `isCreatorPost(row)` on a row
 * the database returned, or `useCreatorAccess()` for the signed-in account. It
 * takes no "verified" prop for a reason: a badge that any component can switch
 * on is a badge that means nothing.
 */
export default function OfficialBadge({
  size = "sm",
  label = OFFICIAL_IDENTITY.badge,
}: {
  /** `sm` sits inline in a post head; `md` is for headers and the dashboard. */
  size?: "sm" | "md";
  label?: string;
}) {
  return (
    <span
      className={`official-badge ${size === "md" ? "is-md" : ""}`}
      title={`${OFFICIAL_IDENTITY.name} · ${label}`}
    >
      <BadgeCheck size={size === "md" ? 15 : 12} strokeWidth={2.6} aria-hidden />
      <span>{label}</span>
    </span>
  );
}
