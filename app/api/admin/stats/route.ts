import type { NextRequest } from "next/server";
import { handleAdminError, requireAdmin } from "@/lib/admin/auth";

/**
 * Dashboard statistics.
 *
 * One call, one round trip, one server-side aggregate. The client never issues
 * a count of its own, because there is nothing it could count that this does
 * not already return — and every alternative it could reach would be a
 * full-table scan against a table this panel is meant to stay fast on.
 *
 * Cost per render: a cached JSON row, refreshed at most every five minutes by
 * `admin_platform_stats` (202609080001 §B6), plus a handful of index-bounded
 * `created_at >= today` counts. No `count(*)` over `messages`,
 * `direct_messages` or `public_feed_posts` happens on this path at all; those
 * totals come from `pg_class.reltuples`, the same trade 202609070001 §S10 made
 * for the public activity strip.
 */
export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);

    /* `?refresh=1` forces a recompute. Deliberately not the default: the point
       of the cache is that opening the panel twice in a minute is one
       aggregate, not two. */
    const force = new URL(req.url).searchParams.get("refresh") === "1";

    const { data, error } = await admin.db.rpc("admin_platform_stats", { p_force: force });
    if (error) {
      if (error.code === "42883") {
        return Response.json(
          { error: "The statistics function is missing. Apply supabase/migrations/202609080001_admin_control_center.sql." },
          { status: 400 }
        );
      }
      /* Admin-only route (requireAdmin above): the allowlisted accounts get
         the real text; the same detail goes to the deployment log. */
      console.error("[admin/stats] query failed:", error.code, error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }

    /* Read-only, so it is not audited per view: an admin opening the panel
       fifty times an hour would bury the entries that matter. Viewed accounts
       ARE logged, in app/api/admin/users/[id]. */
    return Response.json(
      data,
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (err) {
    return handleAdminError(err, "admin/stats");
  }
}
