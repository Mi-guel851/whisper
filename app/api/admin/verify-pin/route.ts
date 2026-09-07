import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { clientIp, consume, rateLimitedResponse } from "@/lib/apiGuard";
import { isAdminEmail } from "@/lib/admin/emails";

/**
 * Unlocks the grant form's UI. It does not authorize a grant — /api/admin/grant-coins
 * re-checks the PIN on every request, because a route that only gates rendering
 * can be skipped by not rendering.
 *
 * The `profiles.is_admin` lookup that used to be here is gone: the PIN is the
 * credential now, so requiring a hand-set database flag as well meant the page
 * bounced to /dashboard until someone remembered to run one SQL statement per
 * admin account.
 */

/** Constant-time compare, so a wrong PIN takes the same time whatever it is. */
function pinMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    /* PIN attempts are bucketed before anything else: a numeric or short PIN is
       otherwise brute-forceable at network speed, spread across every warm
       serverless instance. This per-instance floor slows one client dramatically;
       Vercel Firewall rules are the distributed ceiling (see audit report). */
    const limited = consume("admin-verify-pin", clientIp(req.headers), 6, 10 * 60_000);
    if (limited) return rateLimitedResponse(limited);

    const { pin } = await req.json();

    /* Checked before comparing. An unset variable makes `pin !== undefined` true
       for every input, so a correct PIN gets reported as "Incorrect PIN" and the
       real cause — a missing deploy variable — never surfaces. */
    const expectedPin = process.env.ADMIN_GRANT_PIN;
    if (!expectedPin) {
      return NextResponse.json(
        { error: "ADMIN_GRANT_PIN is not set on the server. Add it to the deployment environment and redeploy." },
        { status: 500 }
      );
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const accessToken = authHeader.slice("Bearer ".length);

    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    /* The allowlist, before the PIN — same order as requireAdmin, same reason.

       This route is currently unreferenced: the Grant Coins page it unlocked is
       now a redirect to /admin/coins, and the panel unlocks through
       /api/admin/session instead. It is kept because a deployed client from
       before that change may still call it, and because deleting a route that
       something might POST to is a worse failure than keeping one that nothing
       does. But an orphaned endpoint that answers "is this the PIN?" for any
       signed-in account is a brute-force oracle, so it gets the same account
       check as every other admin surface. */
    if (!isAdminEmail(user.email, "server")) {
      return NextResponse.json(
        { error: "This account is not authorized to use the admin panel." },
        { status: 403 }
      );
    }

    if (typeof pin !== "string" || !pinMatches(pin, expectedPin)) {
      return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}