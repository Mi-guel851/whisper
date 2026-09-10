import type { NextRequest } from "next/server";
import { handleAdminError, requireAdmin } from "@/lib/admin/auth";

/**
 * The coin ledger, newest first.
 *
 * Serves the Coins section of the panel: who granted what, when, with which
 * note, resolved to usernames on both sides. The granting admin's id lives in
 * `coin_transactions.metadata ->> 'granted_by'`, written by
 * `admin_grant_coins` itself (202608190004), so this route only reads what the
 * grant already recorded — it cannot be told a different story by a caller.
 *
 * Keyset-paged on `created_at`, capped at 200 rows per page. The ledger is the
 * one table here that grows without bound and is never pruned, which is exactly
 * why the panel must not be able to ask for all of it.
 */
export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const params = new URL(req.url).searchParams;

    const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "50", 10) || 50, 1), 200);
    const before = params.get("before");

    const { data, error } = await admin.db.rpc("admin_coin_history", {
      p_limit: limit,
      p_before_ts: before ?? null,
    });

    if (error) {
      if (error.code === "42883") {
        return Response.json(
          { error: "The coin history function is missing. Apply supabase/migrations/202609080001_admin_control_center.sql." },
          { status: 400 }
        );
      }
      /* Admin-only route (requireAdmin above): the allowlisted accounts get
         the real text; the same detail goes to the deployment log. */
      console.error("[admin/coins/history] list failed:", error.code, error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as Array<{ created_at: string }>;
    const last = rows[rows.length - 1];

    return Response.json({
      transactions: rows,
      nextCursor: rows.length === limit && last ? { before: last.created_at } : null,
    });
  } catch (err) {
    return handleAdminError(err, "admin/coins/history");
  }
}
