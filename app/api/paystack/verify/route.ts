import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const PREMIUM_PACKAGE_COINS = 1500;
const PREMIUM_PACKAGE_AMOUNT_KOBO = 200000; // ₦2,000

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

    if (tx.currency !== "NGN" || tx.amount !== PREMIUM_PACKAGE_AMOUNT_KOBO) {
      return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
    }

    if (tx.customer?.email && tx.customer.email !== "whisper.anonymous.app@gmail.com") {
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
        amount_kobo_paid: tx.amount,
        coin_amount: PREMIUM_PACKAGE_COINS,
        grant_premium: true,
      }
    );

    if (creditError) {
      console.error("Credit error:", creditError.message);
      return NextResponse.json({ error: "Failed to credit account" }, { status: 500 });
    }

    return NextResponse.json({ success: true, balance: newBalance });
  } catch (err) {
    console.error("Verify route error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}