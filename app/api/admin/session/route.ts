import type { NextRequest } from "next/server";
import { handleAdminError, requireAdmin } from "@/lib/admin/auth";

/**
 * "Is this caller an admin?" — and nothing else.
 *
 * The panel calls this once, on load, to decide whether to show its unlock screen
 * or its content. It returns no data, which is the point: a route whose only job
 * is answering a yes/no question cannot leak anything by answering it, and it is
 * cheap enough to call on every panel mount.
 *
 * Like /api/admin/verify-pin before it, this does NOT authorize anything. Every
 * data route re-runs the same check on its own request, because a route that only
 * gates rendering can be skipped by not rendering. What this buys is a good
 * unlock screen: the admin learns their PIN was wrong on the screen where they
 * typed it, not three sections deep into the panel.
 */
export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    return Response.json({ ok: true, adminId: admin.adminId, email: admin.adminEmail });
  } catch (err) {
    return handleAdminError(err, "admin/session");
  }
}
