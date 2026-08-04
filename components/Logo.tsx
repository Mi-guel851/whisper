"use client";

import Image from "next/image";

/**
 * Wordmark.
 *
 * `animate-pulse` was removed from the ghost: a permanently pulsing logo in a
 * fixed header is motion the user can never scroll away from, and pulsing
 * opacity is the browser's own idiom for "this is loading".
 */
export default function Logo({
  compact = false,
  showTagline = true,
}: {
  /** Header variant — smaller mark, tighter type. */
  compact?: boolean;
  showTagline?: boolean;
}) {
  const size = compact ? 34 : 48;

  return (
    <div className="flex items-center gap-2.5">
      <Image
        src="/ghost.png"
        alt=""
        width={size}
        height={size}
        priority
        className="drop-shadow-[0_0_14px_rgba(34,211,238,0.55)]"
      />

      <div className="leading-none">
        <span
          className={`block ${compact ? "text-xl" : "text-3xl"}`}
          style={{
            color: "var(--bridge-text)",
            fontWeight: 800,
            letterSpacing: "var(--tracking-2xl)",
          }}
        >
          Whisper
        </span>

        {showTagline && (
          <span
            className={`mt-0.5 block ${compact ? "text-[0.6875rem]" : "text-sm"}`}
            style={{ color: "var(--theme-accent-purple)" }}
          >
            Anonymous Messaging
          </span>
        )}
      </div>
    </div>
  );
}
