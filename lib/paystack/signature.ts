/**
 * Paystack IPN signature verification — server-only (node:crypto).
 *
 * Paystack signs every webhook body: the raw request body, HMAC-SHA512 with
 * the endpoint's secret (created in the Paystack dashboard), sent as the
 * `x-paystack-signature` header. This is the ONLY thing that makes the
 * webhook endpoint trustworthy — the body alone can be sent by anyone who
 * knows the URL.
 *
 * The comparison is constant-time, and the signature is verified BEFORE the
 * body is parsed or any credit is attempted: an unauthenticated byte string
 * must not reach the ledger, in any shape.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export function paystackSignature(body: string, secret: string): string {
  return createHmac("sha512", secret).update(body, "utf8").digest("hex");
}

export function verifyPaystackSignature(body: string, signature: string | null): boolean {
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = paystackSignature(body, secret);
  const given = Buffer.from(signature, "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}
