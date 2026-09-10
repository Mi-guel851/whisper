/**
 * RETIRED (202609100003) — kept deployed so a leftover dashboard webhook
 * cannot double-notify.
 *
 * Whispers used to be pushed ONLY here, via a hand-made "Database Webhook"
 * on public.messages — the one path invisible to the repo, and the reason
 * whispers buzzed while inbox/friend/feed pushes did not. 202609100003
 * unified delivery: the trigger that writes the `notifications` row for a
 * whisper now also feeds `deliver_notification_push`, which calls
 * `notify-on-notification` for every notification type including whispers.
 *
 * With BOTH alive, every whisper would ring twice. So this function stays
 * service-role-gated and answers a deliberate no-op. The webhook should be
 * deleted in Dashboard -> Database -> Webhooks; until someone remembers, this
 * stub is what makes that mistake harmless. If delivery via
 * notify-on-notification ever proves broken, restoring the previous
 * implementation here is the documented fallback.
 */

async function requireServiceRole(req: Request): Promise<boolean> {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(token)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const ua = new Uint8Array(a), ub = new Uint8Array(b);
  if (ua.length !== ub.length) return false;
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  }
  if (!(await requireServiceRole(req))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  console.warn("[notify-new-whisper] retired; whispers are delivered by notify-on-notification (see supabase/migrations/202609100004_notification_targeting.sql). Safe to delete the database webhook for this path.");
  return new Response(
    JSON.stringify({
      skipped: "retired: unified push path (deliver_notification_push -> notify-on-notification)",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
