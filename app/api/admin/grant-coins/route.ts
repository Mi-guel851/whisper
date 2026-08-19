import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";

/**
 * The only path to a coin grant.
 *
 * The grant used to run as `supabase.rpc("admin_grant_coins")` straight from
 * app/admin/grant-coins/page.tsx, which meant the browser held the authority to
 * change a balance and the database's `is_admin` check was the sole thing
 * stopping it. The PIN could not do that job from there: verifying it only
 * flipped a React boolean, and any signed-in user could call the RPC directly
 * and never see the PIN screen.
 *
 * So the PIN is checked here, and 202608190004 makes the RPC refuse anything but
 * the service role. That key exists only in server environment variables, so this
 * route is the sole way in and the check cannot be walked around.
 */

/** Constant-time compare, so a wrong PIN takes the same time whatever it is. */
function pinMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws outright on a length mismatch, so that case is
  // answered first. It leaks the PIN's length and nothing else, which is not
  // worth defending against here; what matters is that two equal-length guesses
  // are indistinguishable by timing.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    const { pin, username, amount, note } = await req.json();

    /* Checked before the PIN comparison. Without it an unset variable makes
       `pin !== undefined` true for every input, so a correct PIN is reported as
       "Incorrect PIN" and the real problem — a missing deploy variable — stays
       invisible. */
    const expectedPin = process.env.ADMIN_GRANT_PIN;
    if (!expectedPin) {
      return NextResponse.json(
        { error: "ADMIN_GRANT_PIN is not set on the server. Add it to the deployment environment and redeploy." },
        { status: 500 }
      );
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server." },
        { status: 500 }
      );
    }

    /* Being signed in is still required. It is not what authorizes the grant —
       the PIN is — but it puts a real user id in the ledger's `granted_by`, so a
       grant can be traced to an account afterwards. */
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(authHeader.slice("Bearer ".length));

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    if (typeof pin !== "string" || !pinMatches(pin, expectedPin)) {
      return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
    }

    const cleanUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
    if (!cleanUsername) {
      return NextResponse.json({ error: "Enter a username." }, { status: 400 });
    }

    /* Parsed here rather than trusting the client's number: the form sends a
       string, and Number("") is 0 while parseInt("500abc") is 500. */
    const coinAmount = Number.parseInt(String(amount), 10);
    if (!Number.isFinite(coinAmount) || coinAmount <= 0) {
      return NextResponse.json({ error: "Enter a coin amount greater than zero." }, { status: 400 });
    }

    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabaseAdmin.rpc("admin_grant_coins", {
      target_username: cleanUsername,
      coin_amount: coinAmount,
      grant_note: typeof note === "string" && note.trim() ? note.trim() : "Premium Grant",
      granted_by_user: user.id,
    });

    if (error) {
      /* 42883 is "function does not exist" — 202608190004 has not been applied,
         or only the old three-argument signature is present. Worth naming, because
         the generic message reads as a permissions problem. */
      const message =
        error.code === "42883"
          ? "The grant function is missing or out of date. Apply supabase/migrations/202608190004_admin_pin_grants.sql."
          : error.message;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ balance: data });
  } catch (err) {
    console.error("[admin/grant-coins]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
