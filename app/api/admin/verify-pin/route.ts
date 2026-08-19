import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";

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

    if (typeof pin !== "string" || !pinMatches(pin, expectedPin)) {
      return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}