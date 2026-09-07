import type { NextRequest } from "next/server";
import { handleAdminError, logAdmin, requireAdmin } from "@/lib/admin/auth";

/**
 * Banning an account.
 *
 * WHAT ACTUALLY STOPS A BANNED USER
 *
 * Three layers, and it matters which one is load-bearing:
 *
 *   1. THE DATABASE (load-bearing). `user_bans` plus the before-insert triggers
 *      on `messages`, `direct_messages`, `public_feed_posts`,
 *      `public_feed_likes`, `message_reactions` and `coin_transactions`
 *      (202609080001 §B2), and the extra clause in `can_send_direct_message`.
 *      Most of Whisper's writes go from the browser straight to PostgREST under
 *      the visitor's own JWT, so this is the only layer a hand-written fetch
 *      cannot route around. It is the reason a ban here is not a UI state.
 *
 *   2. GOTRUE (session revocation). `auth.admin.updateUserById` with
 *      `ban_duration` sets `auth.users.banned_until`, after which GoTrue refuses
 *      to issue or refresh tokens for the account. This is what actually ends an
 *      already-signed-in session, at the next refresh (access tokens live about
 *      an hour, so an existing session keeps its access token until it expires —
 *      but layer 1 already makes that token useless for anything that matters).
 *
 *   3. THE CLIENT (UX only). components/BanGate.tsx and middleware.ts send a
 *      banned account to /banned. Neither is security; both exist so the person
 *      is told why instead of watching their sends fail.
 *
 * Data is never deleted. A ban flips a boolean and, at most, suspends the auth
 * account; every whisper, message and post the account ever made stays exactly
 * where it is, and an unban restores full access.
 */

const DURATIONS: Record<string, { label: string; go: string }> = {
  permanent: { label: "Permanent", go: "none" },
  "1h": { label: "1 hour", go: "1h" },
  "24h": { label: "24 hours", go: "24h" },
  "7d": { label: "7 days", go: "168h" },
  "30d": { label: "30 days", go: "720h" },
  "90d": { label: "90 days", go: "2160h" },
};

/**
 * The moderation queue of bans.
 *
 * `?scope=active` (the default) returns bans in force right now; `?scope=all`
 * includes lifted ones, which is what makes "has this account been banned before"
 * answerable from one screen. Capped at 200 rows and newest-first, so the panel
 * never asks for the whole history.
 */
export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const scopeParam = new URL(req.url).searchParams.get("scope") ?? "active";
    const scope = scopeParam === "all" ? "all" : "active";

    const { data, error } = await admin.db.rpc("admin_bans_page", {
      p_scope: scope,
      p_limit: 200,
    });

    if (error) {
      const message =
        error.code === "42883"
          ? "The ban system is missing. Apply supabase/migrations/202609080001_admin_control_center.sql."
          : error.message;
      return Response.json({ error: message }, { status: 400 });
    }

    return Response.json({ bans: data ?? [] });
  } catch (err) {
    return handleAdminError(err, "admin/bans");
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const admin = await requireAdmin(req, body);

    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
    if (!UUID_PATTERN.test(userId)) {
      return Response.json({ error: "That is not a valid user id." }, { status: 400 });
    }

    /* Reason is required and capped. Required because a ban with no reason is
       unappealable and unauditable — the person reading it six weeks later,
       including the person who wrote it, cannot tell what happened. Capped
       because it is rendered verbatim on the banned user's screen. */
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!reason) {
      return Response.json({ error: "A reason is required." }, { status: 400 });
    }

    const durationKey = typeof body?.duration === "string" ? body.duration : "permanent";
    const duration = DURATIONS[durationKey];
    if (!duration) {
      return Response.json({ error: "Unknown ban duration." }, { status: 400 });
    }

    const isPermanent = durationKey === "permanent";
    const expiresAt = isPermanent
      ? null
      : new Date(Date.now() + parseGoDurationMs(duration.go)).toISOString();

    const { data: ban, error } = await admin.db.rpc("admin_ban_user", {
      p_user_id: userId,
      p_reason: reason,
      p_duration: isPermanent ? "permanent" : "temporary",
      p_expires_at: expiresAt,
      p_banned_by: admin.adminId,
    });

    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    /* Session revocation. Best-effort and reported honestly: if GoTrue rejects
       the call the database ban still enforces everything, so the failure is
       surfaced in the response rather than swallowed, and `sessions_revoked`
       stays false so the panel shows the difference. */
    let sessionsRevoked = false;
    let revokeError: string | null = null;
    try {
      const { error: authError } = await admin.db.auth.admin.updateUserById(userId, {
        ban_duration: duration.go,
      });
      if (authError) {
        revokeError = authError.message;
      } else {
        sessionsRevoked = true;
        await admin.db.rpc("admin_mark_sessions_revoked", { p_ban_id: (ban as { id?: string })?.id ?? null });
      }
    } catch (err) {
      revokeError = err instanceof Error ? err.message : String(err);
    }

    await logAdmin(admin.db, admin.adminId, "user.banned", userId, {
      reason: reason.slice(0, 200),
      duration: durationKey,
      expires_at: expiresAt,
      sessions_revoked: sessionsRevoked,
    });

    return Response.json({
      ban,
      sessionsRevoked,
      revokeError,
      /* Echoed so the panel can say "session revoked" or "database ban only"
         without guessing which of the two happened. */
      enforcement: sessionsRevoked ? "database + session revoked" : "database",
    });
  } catch (err) {
    return handleAdminError(err, "admin/bans");
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parses the subset of Go duration syntax this route emits: `<int>h`. */
function parseGoDurationMs(go: string): number {
  const match = /^(\d+)h$/.exec(go);
  if (!match) throw new Error(`Unsupported ban duration: ${go}`);
  return Number.parseInt(match[1], 10) * 60 * 60 * 1000;
}
