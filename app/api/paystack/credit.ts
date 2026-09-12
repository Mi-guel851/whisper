/**
 * The one place a gateway-verified Paystack transaction becomes coins.
 *
 * Two callers, one rule chain:
 *
 *   - /api/paystack/verify — the browser callback path (the one the user
 *     sees the result of);
 *   - /api/paystack/webhook — the IPN path (the one that fires when Paystack
 *     itself confirms the charge, whether or not the app is alive).
 *
 * Both must run the SAME checks — ownership, currency, package, amount,
 * email — or one of them is a hole. The credit itself is idempotent at the
 * database (credit_verified_payment's reference guard), so the two paths
 * racing each other on the same payment credits exactly once: whichever
 * arrives second gets the current balance back, not a second ledger row.
 *
 * This file is server-only: it reads env and speaks to Supabase.
 */

import { createClient } from "@supabase/supabase-js";
import { paymentBelongsToUser } from "@/lib/paymentOwnership";
import {
  MASKED_EMAIL,
  claimedCoins,
  chargeRegion,
  validateAmount,
  type PaystackTransaction,
} from "@/lib/paystack/shared";

export type CreditResult =
  | { ok: true; balance: number; coins: number }
  | { ok: false; status: number; error: string };

/**
 * Settle a transaction the gateway has already told us about.
 *
 * `userId` is the expected owner: the verified session's user on the /verify
 * path, and the gateway's own metadata on the webhook path (where there is
 * no session — the HMAC is the session). Returns a structured result rather
 * than throwing so the callers can answer with the right status and the
 * webhook can ack (200) while logging a skip: a webhook that 500s on a
 * rejected payment makes Paystack retry forever.
 */
export async function settleVerifiedPayment(
  tx: PaystackTransaction,
  reference: string,
  userId: string | null
): Promise<CreditResult> {
  if (tx.status !== "success") {
    return { ok: false, status: 400, error: "Payment not successful" };
  }

  /* The gateway-verified transaction, not the request body, binds the payer. */
  if (!paymentBelongsToUser(tx as never, reference, userId ?? "")) {
    return { ok: false, status: 403, error: "Payment does not belong to this account" };
  }

  const currency = String(tx.currency || "").toUpperCase();
  if (currency !== "NGN") {
    return { ok: false, status: 400, error: "Unsupported charge currency" };
  }

  const coins = claimedCoins(tx.metadata);
  if (coins === null) {
    return { ok: false, status: 400, error: "Missing package metadata" };
  }

  const amountValid = await validateAmount(chargeRegion(tx.metadata), coins, Number(tx.amount));
  if (!amountValid) {
    return { ok: false, status: 400, error: "Amount mismatch" };
  }

  /* This Paystack account bills through one masked address. A charge that
     named a different email is not one of ours. */
  const email = typeof tx.customer?.email === "string" ? tx.customer.email : "";
  if (email && email !== MASKED_EMAIL) {
    return { ok: false, status: 400, error: "Email mismatch" };
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: newBalance, error: creditError } = await supabaseAdmin.rpc(
    "credit_verified_payment",
    {
      target_user: userId,
      payment_reference: reference,
      currency_code: currency,
      amount_minor_units: Number(tx.amount),
      coin_amount: coins,
    }
  );

  if (creditError) {
    console.error("[paystack] credit error:", creditError.message);
    return { ok: false, status: 500, error: "Failed to credit account" };
  }

  return { ok: true, balance: Number(newBalance ?? 0), coins };
}
