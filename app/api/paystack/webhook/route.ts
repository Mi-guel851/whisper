import { NextRequest, NextResponse } from "next/server";
import { verifyPaystackSignature } from "@/lib/paystack/signature";
import { settleVerifiedPayment, type CreditResult } from "../credit";
import type { PaystackTransaction } from "@/lib/paystack/shared";

/**
 * The Paystack IPN endpoint: coins are released when PAYSTACK confirms the
 * charge, not when the browser happens to be around.
 *
 * WHY THIS ROUTE EXISTS
 *
 * Until now the only credit path was the Paystack iframe's callback in the
 * browser: pay → callback fires → POST /api/paystack/verify. That path loses
 * the payment whenever the page is not alive to finish the fetch — the user
 * closes the app right after the success screen, the network blips exactly
 * at hangover, the Android WebView is backgrounded mid-verify, or a bank
 * transfer is still settling ("pending") when the only verify attempt runs.
 * The money is charged at the gateway; the coins never move. Paystack's IPN
 * is the fix: it POSTs the confirmed transaction to this endpoint with an
 * HMAC-SHA512 signature, and we credit it — same rules, same idempotent
 * ledger write — no browser required.
 *
 * SECURITY
 *
 *   * `x-paystack-signature` is verified against PAYSTACK_WEBHOOK_SECRET
 *     BEFORE the body is even parsed. An unverified body is a public-URL
 *     byte string and must never reach the ledger.
 *   * Without a configured secret the endpoint answers 503 and says so in
 *     the logs — it does not open up "in the meantime".
 *   * The owner comes from the gateway's own metadata (or the legacy
 *     reference), checked by the same paymentBelongsToUser chain the
 *     /verify path uses. There is no session here; the HMAC is the session.
 *
 * IDEMPOTENCE
 *
 * credit_verified_payment's reference guard means an IPN replay, or an IPN
 * racing the browser's own verify, credits exactly once. The response is a
 * 200 in every processed case (including logged skips) so a rejected
 * payment is not retried into a Paystack retry storm.
 *
 * CONFIGURATION
 *
 *   1. Paystack dashboard → Webhooks → Add endpoint:
 *        URL:    https://<your-deployment>/api/paystack/webhook
 *        Event:  charge.success   (add charge.pending too if you like — it
 *                is acked and ignored)
 *   2. Copy the endpoint's secret into the deployment environment as
 *        PAYSTACK_WEBHOOK_SECRET
 */

export async function POST(req: NextRequest) {
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      "[paystack-webhook] PAYSTACK_WEBHOOK_SECRET is not set — refusing to accept IPN. " +
        "Set the endpoint secret from the Paystack dashboard; credits will not " +
        "happen automatically until then."
    );
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const rawBody = await req.text();

  if (!verifyPaystackSignature(rawBody, req.headers.get("x-paystack-signature"))) {
    console.warn("[paystack-webhook] rejected: bad or missing signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { event?: string; data?: PaystackTransaction };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  /* Only a confirmed charge moves coins. charge.pending and everything else
     is acked and ignored — the client's own verify (and its pending-payment
     reconciliation) covers the not-yet-settled window. */
  if (event?.event !== "charge.success" || !event.data) {
    return NextResponse.json({ success: true, credited: false, note: "ack" });
  }

  const tx = event.data;
  const reference = typeof tx.reference === "string" ? tx.reference : "";

  /* The owner: the gateway's metadata first (every modern checkout carries
     it), the legacy reference format second. Neither → fail closed below;
     an admin grant from /admin/grant-coins remains the manual path. */
  const metaUserId = typeof tx.metadata?.user_id === "string" ? tx.metadata.user_id : null;
  const legacy = /^whisper_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(\d+)_(\d+)$/.exec(reference);
  const userId = metaUserId || legacy?.[1] || null;

  const result: CreditResult = await settleVerifiedPayment(tx, reference, userId);

  if (!result.ok) {
    /* Ack anyway: this is a policy rejection (tampered amount, unknown
       owner, currency drift), not a transient failure — Paystack must not
       retry it forever. The log line is the audit trail for support. */
    console.warn(
      `[paystack-webhook] skipped credit for ${reference || "(no reference)"}: ${result.error}`
    );
    return NextResponse.json({ success: true, credited: false, reason: result.error });
  }

  console.log(
    `[paystack-webhook] credited ${result.coins} coins (balance ${result.balance}) for ${reference}`
  );
  return NextResponse.json({ success: true, credited: true });
}
