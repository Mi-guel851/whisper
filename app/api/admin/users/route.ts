import type { NextRequest } from "next/server";
import { handleAdminError, requireAdmin } from "@/lib/admin/auth";
import { maskEmail, maskPhone } from "@/lib/admin/mask";

/**
 * The Users table.
 *
 * WHY THIS IS A SERVER ROUTE AND NOT A SUPABASE QUERY
 *
 * The rows include `email` (from `auth.users`) and `phone_number`. Those are the
 * two fields on the platform that must never be legible to another user, and a
 * client-side query cannot make that promise: anything the browser can ask for,
 * the browser can ask for about anyone. `admin_users_page` is EXECUTE-revoked
 * from `anon` and `authenticated` (202609080001 §B5), so this route — behind the
 * PIN — is the only reader that exists.
 *
 * It is also the only reader that scales. Search, filtering and pagination all
 * happen in one indexed query; the browser never receives more than one page,
 * and never receives a row it did not ask for.
 */

const STATUSES = new Set(["all", "active", "banned", "new", "high_coins", "recently_active"]);
const MAX_PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const params = new URL(req.url).searchParams;

    const search = (params.get("q") ?? "").trim().slice(0, 120) || null;
    const statusParam = params.get("status") ?? "all";
    const status = STATUSES.has(statusParam) ? statusParam : "all";

    /* Clamped server-side. A client asking for 10,000 rows is either a bug or
       an attempt to export the user base, and both are answered the same way. */
    const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "25", 10) || 25, 1), MAX_PAGE_SIZE);

    /* Keyset cursor, not OFFSET: see the note on admin_users_page. */
    const afterTs = params.get("afterTs");
    const afterId = params.get("afterId");

    const [{ data: rows, error: rowsError }, { data: total, error: countError }] = await Promise.all([
      admin.db.rpc("admin_users_page", {
        p_search: search,
        p_status: status,
        p_limit: limit,
        p_after_ts: afterTs ?? null,
        p_after_id: afterId ?? null,
      }),
      admin.db.rpc("admin_users_count", { p_search: search, p_status: status }),
    ]);

    if (rowsError) {
      if (rowsError.code === "42883") {
        return Response.json(
          { error: "The admin read model is missing. Apply supabase/migrations/202609080001_admin_control_center.sql." },
          { status: 400 }
        );
      }
      /* Admin-only route (requireAdmin above): the allowlisted accounts get
         the real text; the same detail goes to the deployment log. */
      console.error("[admin/users] list failed:", rowsError.code, rowsError.message);
      return Response.json({ error: rowsError.message }, { status: 500 });
    }
    if (countError) {
      console.error("[admin/users] count failed:", countError.code, countError.message);
      return Response.json({ error: countError.message }, { status: 500 });
    }

    /* Masked here rather than in the component, so the panel cannot be made to
       show a full phone number by editing React state. The detail view is the
       one place the full value is rendered, and it is separately audited. */
    const users = (rows ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      phone_masked: maskPhone(row.phone_number as string | null),
      email_masked: maskEmail(row.email as string | null),
    }));

    const last = users[users.length - 1] as { created_at?: string; id?: string } | undefined;

    return Response.json({
      users,
      total,
      nextCursor:
        users.length === limit && last?.created_at && last?.id
          ? { afterTs: last.created_at, afterId: last.id }
          : null,
    });
  } catch (err) {
    return handleAdminError(err, "admin/users");
  }
}
