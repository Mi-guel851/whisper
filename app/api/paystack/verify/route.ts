import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { COIN_PACKAGES } from "@/lib/coins";
import { getLiveRatesPerUsd } from "@/lib/currency";

const MASKED_EMAIL = "whisper.anonymous.app@gmail.com";

// Paystack only ever settles in NGN on this account, so every charge —
// Africa/India flat-priced or foreign-converted — arrives as NGN. This
// figures out which package was paid for and whether the amount actually
// paid is close enough to what it should have been.
async function validateAmount(
  region: "ngn" | "usd_via_ngn",
  coins: number,
  amountKobo: number
): Promise<boolean> {
  const pkg = COIN_PACKAGES.find((p) => p.coins === coins);
  if (!pkg) return false;

  if (region === "ngn") {
    // Flat ₦ pricing for Africa/India — must match exactly.
    return amountKobo === pkg.ngnAmount * 100;
  }

  // Foreign buyer: their $ price was converted to NGN using the live rate
  // at checkout time, which may have drifted slightly by the time the
  // payment actually settles. Allow a 5% band either side to absorb that,
  // while still catching genuinely tampered amounts.
  const { rates } = await getLiveRatesPerUsd();
  const ngnPerUsd = rates.NGN ?? 1550;
  const expectedKobo = Math.round(pkg.usdAmount * ngnPerUsd * 100);
  const tolerance = expectedKobo * 0.05;
  return Math.abs(amountKobo - expectedKobo) <= tolerance;
}

export async function POST(req: NextRequest) {
  try {
    const { reference } = await req.json();

    if (!reference || typeof reference !== "string") {
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

    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const paystackData = await paystackRes.json();

    if (!paystackRes.ok || !paystackData.status) {
      return NextResponse.json({ error: "Verification failed" }, { status: 400 });
    }

    const tx = paystackData.data;

    if (tx.status !== "success") {
      return NextResponse.json({ error: "Payment not successful" }, { status: 400 });
    }

    const currency = String(tx.currency || "").toUpperCase();
    if (currency !== "NGN") {
      return NextResponse.json({ error: "Unsupported charge currency" }, { status: 400 });
    }

    const coins = Number(tx.metadata?.coins);
    const region = tx.metadata?.region === "usd_via_ngn" ? "usd_via_ngn" : "ngn";

    if (!coins || !Number.isFinite(coins)) {
      return NextResponse.json({ error: "Missing package metadata" }, { status: 400 });
    }

    const amountValid = await validateAmount(region, coins, tx.amount);
    if (!amountValid) {
      return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
    }

    if (tx.customer?.email && tx.customer.email !== MASKED_EMAIL) {
      return NextResponse.json({ error: "Email mismatch" }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: newBalance, error: creditError } = await supabaseAdmin.rpc(
      "credit_verified_payment",
      {
        target_user: user.id,
        payment_reference: reference,
        currency_code: currency,
        amount_minor_units: tx.amount,
        coin_amount: coins,
      }
    );

    if (creditError) {
      console.error("Credit error:", creditError.message);
      return NextResponse.json({ error: "Failed to credit account" }, { status: 500 });
    }

    return NextResponse.json({ success: true, balance: newBalance, coins });
  } catch (err) {
    console.error("Verify route error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}