import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { clientIp, consumeMulti, rateLimitedResponse } from "@/lib/apiGuard";
import { settleVerifiedPayment } from "../credit";

/**
 * Browser-side verification: the Paystack iframe's callback asks "was that
 * payment real?" and the coins are released here.
 *
 * This is still the fast, user-visible path — but it is no longer the only
 * path. /api/paystack/webhook credits the same transaction the moment
 * Paystack confirms it, with or without this tab, and the premium page
 * re-verifies any payment it started and never saw settled (its
 * pending-payment reconciliation). The three paths all run the same rule
 * chain in app/api/paystack/credit.ts and land on the same idempotent
 * credit_verified_payment write, so a payment is credited exactly once no
 * matter which path (or how many) arrive.
 *
 * NOTHING SECRETS: the request carries the user's session JWT (identity +
 * rate bucket) and a reference; the body says nothing about who the caller
 * is, and the account key stays server-side.
 */

export async function POST(req: NextRequest) {
  try {
    const { reference } = await req.json();

    if (typeof reference !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(reference)) {
      return NextResponse.json({ error: "Missing reference" }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const accessToken = authHeader.replace("Bearer ", "");

    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    /* A verification check costs a Paystack API call and, on success, a credit.
       Pace it per user so a stuck client (or an attacker probing references)
       can't hammer Paystack or re-run verify in a loop. A legitimate double-tap
       of the callback is well inside this; the DB-side reference guard in
       credit_verified_payment is what actually stops a double credit. */
    const verifyGuard = await consumeMulti("paystack-verify", [`u:${user.id}`, clientIp(req.headers)], 10, 60_000);
    if (verifyGuard) return rateLimitedResponse(verifyGuard);

    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      }
    );

    const paystackData = await paystackRes.json();

    if (!paystackRes.ok || !paystackData.status) {
      return NextResponse.json({ error: "Verification failed" }, { status: 400 });
    }

    const tx = paystackData.data;

    /* Still settling (bank transfer, USSD): not a failure. The page keeps
       the payment pending and re-verifies on the next visit — and the
       webhook credits it the instant Paystack flips it to success, even if
       the user never comes back to this tab. */
    if (tx.status === "pending") {
      return NextResponse.json(
        { success: false, pending: true, error: "Payment is being confirmed — coins will be added automatically." },
        { status: 202 }
      );
    }

    if (tx.status !== "success") {
      return NextResponse.json({ error: "Payment not successful" }, { status: 400 });
    }

    /* One rule chain, shared with the webhook: ownership, currency,
       package, amount, email, then the idempotent credit. */
    const result = await settleVerifiedPayment(tx, reference, user.id);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true, balance: result.balance, coins: result.coins });
  } catch (err) {
    console.error("Verify route error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
