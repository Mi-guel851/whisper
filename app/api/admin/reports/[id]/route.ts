import type { NextRequest } from "next/server";
import { handleAdminError, logAdmin, requireAdmin } from "@/lib/admin/auth";

/**
 * Moving a report through the queue.
 *
 * PATCH, with the four states the schema allows. `resolved` and `dismissed`
 * stamp `reviewed_at`, because the difference between "reviewed and dismissed"
 * and "never looked at" is the whole value of a moderation queue six months
 * later.
 *
 * The note is optional and capped at 500 characters. It is stored on the report,
 * not in the audit metadata, so a moderator's reasoning lives next to the thing
 * it is about.
 */

const STATUSES = new Set(["pending", "reviewing", "resolved", "dismissed"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await req.json().catch(() => null);
    const admin = await requireAdmin(req, body);
    const { id } = await params;

    if (!UUID_PATTERN.test(id)) {
      return Response.json({ error: "That is not a valid report id." }, { status: 400 });
    }

    const status = typeof body?.status === "string" ? body.status : "";
    if (!STATUSES.has(status)) {
      return Response.json({ error: "Unknown report status." }, { status: 400 });
    }

    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : null;

    const { error } = await admin.db.rpc("admin_set_report_status", {
      p_report_id: id,
      p_status: status,
      p_note: note,
      p_by: admin.adminId,
    });

    if (error) return Response.json({ error: error.message }, { status: 400 });

    await logAdmin(admin.db, admin.adminId, `report.${status}`, null, {
      report_id: id,
      note: note?.slice(0, 200) ?? null,
    });

    return Response.json({ ok: true });
  } catch (err) {
    return handleAdminError(err, "admin/reports/[id]");
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
