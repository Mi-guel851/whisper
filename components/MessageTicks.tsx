"use client";

/**
 * WhatsApp-style delivery ticks.
 *
 * The pending/undelivered stroke is `currentColor` rather than a fixed grey, so
 * it inherits whatever the timestamp row is using — a hardcoded `#9ca3af` was
 * tuned for the dark bubble and read as a smudge on the light one. The
 * delivered/read accent stays a token so it keeps its meaning as "confirmed"
 * against either bubble fill.
 */
export default function MessageTicks({
  deliveredAt,
  readAt,
}: {
  deliveredAt: string | null;
  readAt: string | null;
}) {
  const accent = "var(--theme-accent-purple)";

  // Two accent ticks — read.
  if (readAt) {
    return (
      <span className="inline-flex items-center">
        <svg width="18" height="11" viewBox="0 0 18 11" fill="none" aria-label="Read">
          <path d="M1 5.5L5 9.5L13 1.5" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 5.5L9 9.5L17 1.5" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  // Two ticks, only the first accented — delivered but not read.
  if (deliveredAt) {
    return (
      <span className="inline-flex items-center">
        <svg width="18" height="11" viewBox="0 0 18 11" fill="none" aria-label="Delivered">
          <path d="M1 5.5L5 9.5L13 1.5" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 5.5L9 9.5L17 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  // One tick — sent, not yet delivered.
  return (
    <span className="inline-flex items-center">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-label="Sent">
        <path d="M1 5L4 8L9 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
