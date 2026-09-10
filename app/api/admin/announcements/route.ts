import type { NextRequest } from "next/server";
import { handleAdminError, logAdmin, requireAdmin } from "@/lib/admin/auth";
import { validateAnnouncement } from "@/lib/admin/announcements";

/**
 * Creating and listing announcements.
 *
 * Every field the client sends is validated in lib/admin/announcements.ts
 * against the same rules the table's constraints enforce, for the same reason
 * app/api/coins/feed-post does it: the constraint is the guarantee, and the
 * validator is what turns a violation into a sentence instead of a 500.
 */

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const state = new URL(req.url).searchParams.get("state") ?? "all";

    const { data, error } = await admin.db.rpc("admin_announcements_page", {
      p_state: ["all", "draft", "scheduled", "active", "expired"].includes(state) ? state : "all",
    });

    if (error) {
      if (error.code === "42883") {
        return Response.json(
          { error: "The announcement system is missing. Apply supabase/migrations/202609080002_announcements.sql." },
          { status: 400 }
        );
      }
      /* Only the two allowlisted admin accounts can reach this route
         (requireAdmin above), so they get the real text — a SQLSTATE or a
         missing-function error is what makes a broken migration findable.
         The same detail goes to the deployment log. */
      console.error("[admin/announcements] list failed:", error.code, error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ announcements: data ?? [] });
  } catch (err) {
    return handleAdminError(err, "admin/announcements");
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const admin = await requireAdmin(req, body);

    const validation = validateAnnouncement(body);
    if (!validation.ok) {
      return Response.json({ error: validation.error }, { status: 400 });
    }
    const payload = validation.value;

    const { data: id, error } = await admin.db.rpc("admin_create_announcement", {
      p_payload: payload,
      p_by: admin.adminId,
    });

    if (error) {
      /* Admin-only route (requireAdmin above): the allowlisted accounts get
         the real text; the same detail goes to the deployment log. */
      console.error("[admin/announcements] create failed:", error.code, error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }

    /* `admin_create_announcement` logs 'announcement.created'; publishing is a
       separate decision and gets its own entry, so the log can answer "was this
       ever live" independently of "was it ever edited". */
    if (payload.active) {
      await logAdmin(admin.db, admin.adminId, "announcement.published", null, {
        announcement_id: id,
        audience: payload.audience,
      });
    }

    return Response.json({ id });
  } catch (err) {
    return handleAdminError(err, "admin/announcements");
  }
}
