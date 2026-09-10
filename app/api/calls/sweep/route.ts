import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { clientIp, consume, rateLimitedResponse } from "@/lib/apiGuard";

/**
 * Closes calls that were left "ringing" by a dead tab or a dead phone.
 *
 * WHY THE SCHEDULED BACKSTOP EXISTS AT ALL
 *
 * The caller's client also finalizes its own call after 45 unanswered seconds
 * (useVoiceCall → end_call_log). That path is fast and precise, but it is a
 * browser path: the tab can be backgrounded, the process killed, or the phone
 * rebooted mid-ring, and then the callee is left with a ringing row whose push
 * nobody can retract. "Do not depend solely on a browser timer" has an equally
 * blunt converse: a missed call must be RECORDED even when every browser in
 * the story has gone. `expire_stale_calls()` (202609100006) is that recorder —
 * this route is only its scheduler.
 *
 * Authorization: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` to
 * routes in vercel.json. Nothing else may call it, and nothing client-side
 * needs to: start_call_log sweeps its own stale rows lazily, so the cron is
 * an accelerator, not a dependency.
 *
 * Schedule: vercel.json runs this DAILY on purpose — Hobby accounts are limited
 * to a daily cron and the build FAILS on a denser schedule. Correctness never
 * depended on cadence (lazy sweep covers live calls); if the project ever
 * moves to Pro, `* * * * *` is the value to switch to, not the other way round.
 */
const uuid = (s: string | null) => (s && /^[0-9a-f-]{36}$/i.test(s) ? s : null);

export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: "Sweeping is not configured on this server." }, { status: 501 });
    }
    const header = req.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token || token !== cronSecret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    /* The secret gates this route; the bucket only stops a misfiring cron (or
       a leaked secret) from becoming a write flood. */
    const guard = await consume("calls-sweep", uuid(token) ? "cron" : clientIp(req.headers), 120, 60_000);
    if (guard) return rateLimitedResponse(guard);

    const admin = getSupabaseAdmin();
    const { data, error } = await admin.rpc("expire_stale_calls");
    if (error) {
      console.error("[calls/sweep] expire_stale_calls failed:", error.message);
      return NextResponse.json({ error: "sweep failed" }, { status: 500 });
    }

    return NextResponse.json({ expired: Number(data ?? 0) });
  } catch (err) {
    console.error("[calls/sweep]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
