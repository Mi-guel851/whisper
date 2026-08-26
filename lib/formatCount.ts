/**
 * Reusable, app-wide number abbreviation for engagement counters.
 *
 * The raw value always stays a full integer in the database (and in React
 * state). Only what we *show* is abbreviated:
 *
 *   0–999          exact number          999 → "999"
 *   1,000+         K, up to 2 decimals   1,010 → "1.01K"  1,100 → "1.1K"
 *   1,000,000+     M                      1,010,000 → "1.01M"
 *   1,000,000,000+ B, then T, Qa, Qi, Sx… for larger magnitudes
 *
 * Trailing zeros are dropped (1.00K → "1K", 1.10K → "1.1K", 1.01K stays).
 * Rounding is correct, and a value is never promoted into the next unit by
 * rounding: 999,999 rounds to 1000.00K but is clamped back to "999.99K" rather
 * than jumping to "1M".
 *
 * Use {@link formatFullCount} for the exact value — e.g. an `aria-label` or
 * tooltip — so assistive tech and hover states read the real integer.
 */

const UNITS = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];

/** Abbreviated engagement counts (999 → "999", 1,010 → "1.01K", 1M → "1M"). */
export function formatCount(value: number): string {
  // Defensive: a non-finite or NaN value must not crash a feed card.
  if (!Number.isFinite(value)) return "0";

  const sign = value < 0 ? "-" : "";
  let n = Math.abs(value);

  if (n < 1000) {
    // Below a thousand the raw integer is exact — keep every digit.
    return sign + Math.trunc(n).toLocaleString();
  }

  // The unit whose boundary the (unrounded) number sits at or above.
  let unit = 0;
  while (n >= 1000 && unit < UNITS.length - 1) {
    n /= 1000;
    unit += 1;
  }

  // Round to at most two decimals.
  let scaled = Math.round(n * 100) / 100;

  const unitBoundary = Math.pow(1000, unit);
  const dangerBoundary = Math.pow(1000, unit + 1);
  // If rounding pushed us across into the next unit, but the true value was
  // still inside this one, hold at the unit's ceiling instead of rolling over.
  if (scaled >= 1000 && value < dangerBoundary && unit < UNITS.length - 1) {
    scaled = 999.99;
  }
  void unitBoundary;

  // Drop unnecessary trailing zeros: 1.00 → "1", 1.10 → "1.1", 1.01 stays.
  const text = scaled
    .toFixed(2)
    .replace(/\.?0+$/, "");

  return `${sign}${text}${UNITS[unit]}`;
}

/** The exact, comma-grouped integer — for aria-labels and tooltips. */
export function formatFullCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.trunc(value).toLocaleString();
}
