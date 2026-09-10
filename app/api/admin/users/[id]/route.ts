import type { NextRequest } from "next/server";
import { handleAdminError, logAdmin, requireAdmin } from "@/lib/admin/auth";
import { maskEmail, maskPhone } from "@/lib/admin/mask";

/**
 * One account, in full.
 *
 * This is the ONLY endpoint that returns an unmasked email and phone number, and
 * it is the reason the audit log exists: `admin_log('user.viewed', …)` runs on
 * every call, so the record of who opened whose private details is as complete
 * as the record of who changed them. An admin who reads a phone number they had
 * no business reading is traceable afterwards; that is the whole point of
 * logging a read.
 *
 * `?masked=1` returns the same shape with the two sensitive fields redacted.
 * The panel uses it for a re-render that does not need them (after a ban, after
 * a coin grant), so the sensitive values are fetched once per session per
 * account rather than on every refresh.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;

    if (!UUID_PATTERN.test(id)) {
      return Response.json({ error: "That is not a valid user id." }, { status: 400 });
    }

    const { data, error } = await admin.db.rpc("admin_user_detail", { p_user_id: id });
    if (error) {
      if (error.code === "42883") {
        return Response.json(
          { error: "The admin read model is missing. Apply supabase/migrations/202609080001_admin_control_center.sql." },
          { status: 400 }
        );
      }
      /* Admin-only route (requireAdmin above): the allowlisted accounts get
         the real text; the same detail goes to the deployment log. */
      console.error("[admin/users/[id]] detail failed:", error.code, error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }

    /* Audited before the response is built, not after: a route that returns and
       then logs can lose the log entry when the invocation is frozen, and the
       entry is the more important of the two. */
    await logAdmin(admin.db, admin.adminId, "user.viewed", id, {
      username: (data as DetailShape)?.profile?.username ?? null,
    });

    const detail = data as DetailShape;
    const masked = new URL(req.url).searchParams.get("masked") === "1";

    if (masked && detail?.profile) {
      detail.profile = {
        ...detail.profile,
        email: maskEmail(detail.profile.email),
        phone_number: maskPhone(detail.profile.phone_number),
      };
    }

    return Response.json(detail);
  } catch (err) {
    return handleAdminError(err, "admin/users/[id]");
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DetailShape = {
  profile?: {
    username?: string;
    email?: string | null;
    phone_number?: string | null;
  } & Record<string, unknown>;
} & Record<string, unknown>;
