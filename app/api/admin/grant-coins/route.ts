import { NextRequest, NextResponse } from "next/server";
import { handleAdminError, logAdmin, requireAdmin } from "@/lib/admin/auth";

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
 *
 * WHAT CHANGED WITH THE CONTROL PANEL
 *
 * The credential check moved into `requireAdmin` (lib/admin/auth.ts), which every
 * other admin route shares: one implementation of "is this an admin", verified
 * against GoTrue and compared in constant time, rather than a second copy here
 * that could drift from the first. The grant itself is untouched — same RPC, same
 * arguments, same per-grant cap — and it is now audited, so `admin_audit_logs`
 * answers "who granted what, when, and why" without reading the ledger.
 *
 * The request body still carries `pin` (accepted by `requireAdmin` as a
 * fallback), so the pre-panel page and this one keep working through a deploy.
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    /* Rate limiting, the authenticated-account check and the constant-time PIN
       comparison all happen inside. It throws before a client is created, so a
       failed attempt never touches the service role key. */
    const admin = await requireAdmin(req, body);

    const cleanUsername =
      typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    if (!cleanUsername) {
      return NextResponse.json({ error: "Enter a username." }, { status: 400 });
    }

    /* Parsed here rather than trusting the client's number: the form sends a
       string, and Number("") is 0 while parseInt("500abc") is 500. */
    const coinAmount = Number.parseInt(String(body?.amount), 10);
    if (!Number.isFinite(coinAmount) || coinAmount <= 0) {
      return NextResponse.json({ error: "Enter a coin amount greater than zero." }, { status: 400 });
    }

    const { data, error } = await admin.db.rpc("admin_grant_coins", {
      target_username: cleanUsername,
      coin_amount: coinAmount,
      grant_note:
        typeof body?.note === "string" && body.note.trim() ? body.note.trim() : "Premium Grant",
      granted_by_user: admin.adminId,
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

    await logAdmin(admin.db, admin.adminId, "coin.granted", null, {
      username: cleanUsername,
      amount: coinAmount,
      balance_after: data,
      note:
        typeof body?.note === "string" && body.note.trim()
          ? body.note.trim().slice(0, 200)
          : "Premium Grant",
    });

    return NextResponse.json({ balance: data });
  } catch (err) {
    return handleAdminError(err, "admin/grant-coins");
  }
}
