import type { NextRequest } from "next/server";
import { handleAdminError, requireAdmin } from "@/lib/admin/auth";

/**
 * The moderation queue.
 *
 * Reports already existed — `public_feed_reports`, filed by
 * components/feed/FeedReportSheet.tsx through lib/feedApi.ts — but nothing ever
 * read them and nothing ever moved them: the table had no status column, so a
 * report was filed and then forgotten. 202609080001 adds the verdict columns
 * (pending / reviewing / resolved / dismissed) without changing what a report
 * means, and this route is the reader.
 *
 * It is a server route because the rows include the reported author's username
 * and the reported post's body. Neither is public: a post expires after 24
 * hours, and the author is anonymous by design.
 */

const STATUSES = new Set(["all", "pending", "reviewing", "resolved", "dismissed"]);

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const params = new URL(req.url).searchParams;

    const statusParam = params.get("status") ?? "pending";
    const status = STATUSES.has(statusParam) ? statusParam : "pending";
    const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "25", 10) || 25, 1), 100);
    const offset = Math.min(Math.max(Number.parseInt(params.get("offset") ?? "0", 10) || 0, 0), 5000);

    const { data, error } = await admin.db.rpc("admin_reports_page", {
      p_status: status,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      const message =
        error.code === "42883"
          ? "The moderation read model is missing. Apply supabase/migrations/202609080001_admin_control_center.sql."
          : error.message;
      return Response.json({ error: message }, { status: 400 });
    }

    return Response.json(data);
  } catch (err) {
    return handleAdminError(err, "admin/reports");
  }
}
