import { useCallback, useState } from "react";
import { usePaystack } from "react-native-paystack-webview";

import { apiBase } from "./feed";
import { COIN_PACKAGES, MASKED_EMAIL, type CoinPackage } from "./coins";
import { supabase } from "./supabase";

/**
 * Buying coins.
 *
 * THE MONEY PATH IS THE SERVER'S, ALL OF IT.
 *
 * The Paystack checkout can only ever give us a reference — the browser/WebView
 * callback is just a hint that something happened. Coins are credited by
 * `/api/paystack/verify`, which re-reads the transaction from Paystack with the
 * secret key and runs the ownership/currency/package/amount/email rule chain
 * before calling the service-role `credit_verified_payment`. That function is
 * idempotent on the reference, so a double tap, a retry, or the IPN webhook
 * arriving at the same moment credits exactly once.
 *
 * There is deliberately no client-side credit anywhere in this file — not even
 * as a fallback. `purchase_whisper_coins`, which used to credit arbitrary
 * amounts to whoever called it, was revoked by 202609070001 §S1 precisely
 * because a "convenient" client-side credit is an infinite-money bug.
 *
 * TWO DETAILS THAT LOOK LIKE TYPOS AND ARE NOT
 *
 *  1. `email` is `MASKED_EMAIL`, not the signed-in user's address. This
 *     Paystack account bills through one masked address, and `settleVerifiedPayment`
 *     rejects a charge whose customer email is anything else. Sending the real
 *     address produces a charge the server refuses *after* the money moved.
 *  2. The amount is in KOBO — NGN × 100. Paystack's unit is the minor currency
 *     unit, and an amount in naira would charge 1/100th of the price.
 */

/** The 15-minute window a reference stays valid; also Paystack's own expiry. */
const REFERENCE_PREFIX = "whisper";

export type PurchaseOutcome =
  | { kind: "credited"; balance: number; coins: number }
  | { kind: "pending" }
  | { kind: "cancelled" }
  | { kind: "rejected"; error: string }
  | { kind: "network"; error: string };

/** The reference is what the server verifies against; it must be unique. */
export function buildReference(userId: string, coins: number): string {
  const stamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `${REFERENCE_PREFIX}_${userId}_${coins}_${stamp}_${random}`;
}

/**
 * The charge for a package, in kobo.
 *
 * The Paystack account behind this app has only the NGN channel active (USD
 * requires a separate international-payments approval), so every charge goes
 * out in naira — international cards work and the card network converts. The
 * `region` in the charge metadata records which price list the amount came
 * from, and the verify route uses it to check the amount against the right
 * package price.
 */
export function chargeFor(pkg: CoinPackage, ngnPerUsd = 1550) {
  const region: "ngn" | "usd_via_ngn" = "ngn";
  return {
    amountKobo: pkg.ngnAmount * 100,
    region,
    currency: "NGN" as const,
    ngnPerUsd,
  };
}

/**
 * Confirms a reference with the deployment and returns what actually happened.
 *
 * `202` means "still settling" (a bank transfer, USSD, a slow card) and is not
 * a failure: the webhook credits it the moment Paystack flips it to success,
 * whether or not this app is still open.
 */
export async function verifyReference(
  reference: string,
  accessToken: string
): Promise<PurchaseOutcome> {
  try {
    const res = await fetch(`${apiBase()}/api/paystack/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ reference }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      pending?: boolean;
      balance?: number;
      coins?: number;
      error?: string;
    };

    if (res.status === 202 || json.pending) return { kind: "pending" };

    if (!res.ok || !json.success) {
      return {
        kind: "rejected",
        error: json.error || "We couldn't confirm that payment.",
      };
    }

    return { kind: "credited", balance: Number(json.balance ?? 0), coins: Number(json.coins ?? 0) };
  } catch {
    /* A lost confirm is not a lost payment: the reference stays re-verifiable,
       and the webhook is the backstop. */
    return { kind: "network", error: "We couldn't reach the server to confirm that payment." };
  }
}

/**
 * The checkout hook.
 *
 * `purchase(pkg)` opens the Paystack sheet and resolves when the user has
 * either finished or dismissed it. Callers get a `PurchaseOutcome` in every
 * path — including cancel — so a screen can always leave its spinner behind.
 */
export function useCoinPurchase() {
  const { popup } = usePaystack();
  const [busyCoins, setBusyCoins] = useState<number | null>(null);

  const purchase = useCallback(
    async (pkg: CoinPackage): Promise<PurchaseOutcome> => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        return { kind: "rejected", error: "You need to be signed in to buy coins." };
      }

      const reference = buildReference(session.user.id, pkg.coins);
      const charge = chargeFor(pkg);
      setBusyCoins(pkg.coins);

      return new Promise<PurchaseOutcome>((resolve) => {
        let settled = false;

        /* One resolve per checkout. Paystack can fire `onCancel` after
           `onSuccess` on some Android WebView dismissals, and a second resolve
           would double-report a credited purchase as cancelled. */
        const finish = (outcome: PurchaseOutcome) => {
          if (settled) return;
          settled = true;
          setBusyCoins(null);
          resolve(outcome);
        };

        try {
          popup.checkout({
            email: MASKED_EMAIL,
            amount: charge.amountKobo,
            reference,
            metadata: {
              coins: pkg.coins,
              region: charge.region,
              user_id: session.user.id,
            },
            onSuccess: async () => {
              finish(await verifyReference(reference, session.access_token));
            },
            onCancel: () => finish({ kind: "cancelled" }),
            onError: (error: { message?: string }) =>
              finish({ kind: "rejected", error: error?.message || "The payment couldn't be started." }),
          });
        } catch {
          finish({ kind: "rejected", error: "Couldn't open the payment window." });
        }
      });
    },
    [popup]
  );

  /* Whether checkout can open at all. The public key is a build-time value, so
     this is knowable before the first tap — which is what makes it a warning on
     the screen rather than an error after it. */
  const ready = Boolean(process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY);

  return {
    purchase,
    busyCoins,
    ready,
    unavailableReason: ready
      ? null
      : "Payments aren't configured in this build. Set EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY to enable the store.",
  };
}

/** Looks a package up by its coin count — used when a reference comes back. */
export function packageForCoins(coins: number): CoinPackage | undefined {
  return COIN_PACKAGES.find((pkg) => pkg.coins === coins);
}

/** A sentence for each outcome, so every screen says the same things. */
export function describeOutcome(outcome: PurchaseOutcome, coins: number): { message: string; tone: "success" | "info" | "error" } {
  switch (outcome.kind) {
    case "credited":
      return { message: `🎉 ${outcome.coins || coins} Whisper Coins added to your wallet!`, tone: "success" };
    case "pending":
      return {
        message: "Your payment is being confirmed — coins will be added automatically.",
        tone: "info",
      };
    case "cancelled":
      return { message: "Payment cancelled. No coins were added.", tone: "info" };
    case "network":
      return { message: "We couldn't confirm your payment yet — we'll keep checking.", tone: "error" };
    default:
      return { message: outcome.error, tone: "error" };
  }
}
