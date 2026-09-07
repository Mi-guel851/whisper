import type { NextRequest } from "next/server";
import { handleAdminError, requireAdmin } from "@/lib/admin/auth";

/**
 * Lifting a ban.
 *
 * Symmetric with POST /api/admin/bans: the database rows are deactivated (never
 * deleted, so the moderation history survives) and GoTrue's `banned_until` is
 * cleared with a zero duration, which is how that API expresses "not banned".
 *
 * DELETE rather than POST-with-a-flag because an unban is the removal of a
 * resource, and because it makes the audit log's action name match the verb an
 * admin actually performed.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    const { userId } = await params;

    if (!UUID_PATTERN.test(userId)) {
      return Response.json({ error: "That is not a valid user id." }, { status: 400 });
    }

    /* Runs first: it clears `auth.users.banned_until`, so an account whose
       database rows were already inactive (an expired temporary ban) still gets
       its session unblocked. Doing it in the other order would leave a window
       where the row says unbanned and GoTrue still refuses the token. */
    let sessionsRestored = false;
    let restoreError: string | null = null;
    try {
      const { error: authError } = await admin.db.auth.admin.updateUserById(userId, {
        ban_duration: "0s",
      });
      if (authError) restoreError = authError.message;
      else sessionsRestored = true;
    } catch (err) {
      restoreError = err instanceof Error ? err.message : String(err);
    }

    const { data: cleared, error } = await admin.db.rpc("admin_unban_user", {
      p_user_id: userId,
      p_by: admin.adminId,
    });

    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    /* `admin_unban_user` writes its own audit row (it is the one place that
       knows how many bans it cleared), so this route does not write a second. */

    return Response.json({ cleared: Boolean(cleared), sessionsRestored, restoreError });
  } catch (err) {
    return handleAdminError(err, "admin/bans/[userId]");
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
