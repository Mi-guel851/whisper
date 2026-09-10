import type { NextRequest } from "next/server";
import { handleAdminError, logAdmin, requireAdmin } from "@/lib/admin/auth";
import { validateAnnouncement } from "@/lib/admin/announcements";

/**
 * Editing, publishing, scheduling, disabling and deleting an announcement.
 *
 * PATCH takes a partial body. It is validated with the same rules as POST, and
 * `admin_update_announcement` applies it field by field, so a PATCH that only
 * flips `active` cannot silently blank the title.
 *
 * `{"active": true}` is publish, `{"active": false}` is disable. They are the
 * same field because in the schema they are the same fact: whether the row is
 * live is `active` combined with its time window, and a fourth stored status
 * would be a third thing able to disagree with the clock.
 *
 * DELETE is a separate verb on purpose. Disabling is reversible and is the
 * action the panel offers by default; deleting discards the row and every vote
 * cast on it, and has to be chosen explicitly.
 */

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await req.json().catch(() => null);
    const admin = await requireAdmin(req, body);
    const { id } = await params;

    if (!UUID_PATTERN.test(id)) {
      return Response.json({ error: "That is not a valid announcement id." }, { status: 400 });
    }

    const raw = (body ?? {}) as Record<string, unknown>;

    /* Only the keys the composer can actually send. An unexpected key is
       dropped rather than forwarded, so a hand-written PATCH cannot reach a
       column the form does not expose. */
    const patch: Record<string, unknown> = {};
    for (const key of [
      "kind",
      "title",
      "body",
      "imageUrl",
      "ctaLabel",
      "ctaHref",
      "audience",
      "audienceIds",
      "startsAt",
      "endsAt",
      "pollOptions",
      "active",
    ]) {
      if (key in raw) patch[key] = raw[key];
    }

    if (Object.keys(patch).length === 0) {
      return Response.json({ error: "Nothing to update." }, { status: 400 });
    }

    /* Validated as a whole document rather than as a diff: the composer always
       sends the full form, and validating the merged shape is what catches
       "cleared the CTA label but left the href", which no per-field check can. */
    const validation = validateAnnouncement(patch);
    if (!validation.ok) {
      return Response.json({ error: validation.error }, { status: 400 });
    }

    const { error } = await admin.db.rpc("admin_update_announcement", {
      p_id: id,
      p_payload: validation.value,
      p_by: admin.adminId,
    });

    if (error) {
      /* Admin-only route (requireAdmin above): the allowlisted accounts get
         the real text; the same detail goes to the deployment log. */
      console.error("[admin/announcements/[id]] update failed:", error.code, error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (validation.value.active) {
      await logAdmin(admin.db, admin.adminId, "announcement.published", null, {
        announcement_id: id,
      });
    }

    return Response.json({ ok: true });
  } catch (err) {
    return handleAdminError(err, "admin/announcements/[id]");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;

    if (!UUID_PATTERN.test(id)) {
      return Response.json({ error: "That is not a valid announcement id." }, { status: 400 });
    }

    const { error } = await admin.db.rpc("admin_delete_announcement", {
      p_id: id,
      p_by: admin.adminId,
    });

    if (error) {
      /* Admin-only route (requireAdmin above): the allowlisted accounts get
         the real text; the same detail goes to the deployment log. */
      console.error("[admin/announcements/[id]] delete failed:", error.code, error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }

    /* `admin_delete_announcement` writes the audit entry before the delete,
       because afterwards there is nothing left to describe. */
    return Response.json({ ok: true });
  } catch (err) {
    return handleAdminError(err, "admin/announcements/[id]");
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
