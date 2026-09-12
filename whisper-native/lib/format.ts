/**
 * Number and date formatting, matching the web app's `lib/formatCount.ts` and
 * the inbox's `chatListTime`.
 *
 * Copied rather than re-invented because these strings are user-visible and the
 * two clients are supposed to be indistinguishable: `1.2K` on the site has to
 * be `1.2K` in the app.
 */

/** Compact form for engagement counts: 999, 1.2K, 15K, 2.4M. */
export function formatCount(value: number | null | undefined): string {
  const count = Number(value) || 0;
  if (count < 1000) return String(count);
  if (count < 10_000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}K`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

/** Same as `formatCount`; the separate name documents intent at call sites. */
export function compactCount(value: number | null | undefined): string {
  return formatCount(value);
}

/** The exact integer, grouped. Used for accessibility labels. */
export function formatFullCount(value: number | null | undefined): string {
  return (Number(value) || 0).toLocaleString();
}

/** Coin balances are always exact — never abbreviated. */
export function formatCoins(value: number | null | undefined): string {
  return (Number(value) || 0).toLocaleString();
}

/**
 * Compact relative time for the feed, Twitter style: 45s, 12m, 5h, 3d.
 * Anything past a week becomes an explicit date, because "9d" stops meaning
 * anything at the point the feed's own 24-hour window has long expired.
 */
export function timeAgo(value: string | null | undefined): string {
  if (!value) return "";
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return shortDate(value);
}

/**
 * The inbox stamp: a time today, "Yesterday", a weekday within the week, then
 * a date. Calendar keys rather than subtracting 24-hour periods, because a
 * daylight-saving transition makes two adjacent local dates 23 or 25 hours
 * apart and the naive arithmetic then labels a message with the wrong day.
 */
export function chatListTime(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";

  const date = new Date(timestamp);
  const dateKey = (entry: Date) => Date.UTC(entry.getFullYear(), entry.getMonth(), entry.getDate());
  const dayDiff = Math.floor((dateKey(now) - dateKey(date)) / 86_400_000);

  if (dayDiff === 0) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff >= 2 && dayDiff < 7) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }

  return date.toLocaleDateString(
    undefined,
    date.getFullYear() === now.getFullYear()
      ? { day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" }
  );
}

/** `12 Mar` / `12 Mar 2025`. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

/** A day heading for a message list: "Today", "Yesterday", or a date. */
export function dayDivider(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const key = (entry: Date) => Date.UTC(entry.getFullYear(), entry.getMonth(), entry.getDate());
  const diff = Math.floor((key(now) - key(date)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return shortDate(value);
}

/** `3:41` — a clip length, for voice notes. */
export function formatDuration(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** `0:07` while recording, from elapsed milliseconds. */
export function formatElapsed(ms: number): string {
  return formatDuration(ms);
}

/**
 * `3:41 PM` — the time under a chat bubble.
 *
 * The device's own locale rather than a hand-rolled format, because 12- vs
 * 24-hour is not something to guess at: a user who reads `15:41` every day
 * should not be handed `3:41 PM` by an app that decided for them.
 */
export function clockTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** A price in NGN: `₦1,000`. */
export function formatNaira(amount: number): string {
  return `₦${Math.round(amount).toLocaleString()}`;
}
