/**
 * Shared Paystack rules — the single source of truth for the masked email
 * and the amount check, used by the client checkout, the /verify route and
 * the webhook. Keep this file import-safe on both sides: no Node-only APIs,
 * no env reads, no database.
 *
 * Why this file exists
 *
 * The verify route and the page each carried their own copy of the masked
 * email and (part of) the amount rule. Two copies of a money rule is a
 * future "Email mismatch" or "Amount mismatch" bug that only appears after
 * someone changes one side — the same drift class that killed the dead
 * relay default. One definition, three importers.
 */

import { COIN_PACKAGES } from "@/lib/coins";
import { getLiveRatesPerUsd } from "@/lib/currency";

export const MASKED_EMAIL = "whisper.anonymous.app@gmail.com";

/** The transaction shape both the verify API and the IPN webhook carry. */
export type PaystackTransaction = {
  reference?: unknown;
  status?: unknown;
  amount?: unknown;
  currency?: unknown;
  metadata?: {
    coins?: unknown;
    region?: unknown;
    user_id?: unknown;
    [key: string]: unknown;
  } | null;
  customer?: { email?: unknown } | null;
};

export type ChargeRegion = "ngn" | "usd_via_ngn";

/**
 * Does the amount actually paid (NGN, kobo) match the package it claims?
 *
 *   - NGN region: the charge is flat-priced, so it must match exactly.
 *   - Foreign buyers: their $ price was converted to NGN at checkout, and
 *     the rate may have drifted by settlement time — a 5% band absorbs
 *     drift and still catches a tampered amount.
 *
 * `ngnPerUsd` is injectable: the routes pass undefined to fetch the live
 * rate, tests pass a fixed one so no network is involved.
 */
export async function validateAmount(
  region: ChargeRegion,
  coins: number,
  amountKobo: number,
  ngnPerUsd?: number
): Promise<boolean> {
  const pkg = COIN_PACKAGES.find((p) => p.coins === coins);
  if (!pkg) return false;

  if (region === "ngn") {
    // Flat ₦ pricing for Africa/India — must match exactly.
    return amountKobo === pkg.ngnAmount * 100;
  }

  let ngn = ngnPerUsd;
  if (ngn === undefined) {
    const { rates } = await getLiveRatesPerUsd();
    ngn = rates.NGN ?? 1550;
  }
  const expectedKobo = Math.round(pkg.usdAmount * ngn * 100);
  const tolerance = expectedKobo * 0.05;
  return Math.abs(amountKobo - expectedKobo) <= tolerance;
}

/**
 * The region a charge was made under, from the gateway's metadata. Absent
 * or malformed means "ngn" — the flat-priced default — never a guess that
 * widens the tolerance.
 */
export function chargeRegion(metadata: PaystackTransaction["metadata"]): ChargeRegion {
  return metadata?.region === "usd_via_ngn" ? "usd_via_ngn" : "ngn";
}

/** The package size the charge claims, or null when the metadata is not one. */
export function claimedCoins(metadata: PaystackTransaction["metadata"]): number | null {
  const coins = Number(metadata?.coins);
  return Number.isFinite(coins) && coins > 0 ? coins : null;
}
