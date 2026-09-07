import type { NextRequest } from "next/server";
import { handleAdminError, requireAdmin } from "@/lib/admin/auth";

/**
 * The audit log.
 *
 * `admin_audit_logs` is append-only, has no client-readable policy, and has no
 * DELETE handler here: an audit log an admin can edit is not an audit log.
 * Retention, if it is ever wanted, belongs in a scheduled job with its own
 * credentials rather than in the panel.
 *
 * Usernames are resolved inside `admin_audit_page` (202609080001 §B3) rather
 * than by a follow-up query, because the foreign keys on this table point at
 * `auth.users` and there is no embeddable path to `profiles` — and resolving
 * them from the browser would mean asking for arbitrary accounts' profiles,
 * which is exactly the request shape this panel exists to prevent.
 *
 * Keyset-paged on `created_at desc`, filtered by the dotted action prefix, which
 * is why the names are `user.banned` and `announcement.published`: the filter
 * becomes an index scan instead of a scan-and-discard.
 */

const SCOPES = new Set(["all", "user", "report", "announcement", "coin"]);

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const params = new URL(req.url).searchParams;

    const scopeParam = params.get("scope") ?? "all";
    const scope = SCOPES.has(scopeParam) ? scopeParam : "all";
    const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "50", 10) || 50, 1), 200);
    const before = params.get("before");

    const { data, error } = await admin.db.rpc("admin_audit_page", {
      p_scope: scope,
      p_limit: limit,
      p_before_ts: before ?? null,
    });

    if (error) {
      const message =
        error.code === "42883"
          ? "The audit log is missing. Apply supabase/migrations/202609080001_admin_control_center.sql."
          : error.message;
      return Response.json({ error: message }, { status: 400 });
    }

    const rows = (data ?? []) as Array<{ created_at: string }>;
    const last = rows[rows.length - 1];

    return Response.json({
      entries: rows,
      nextCursor: rows.length === limit && last ? { before: last.created_at } : null,
    });
  } catch (err) {
    return handleAdminError(err, "admin/audit-logs");
  }
}
