import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Feed-post pushes, addressed ONLY to the recipient list the database hands it.
 *
 * The previous version ran its own `profiles` query — every profile not the
 * author — which is how "a friend posts" became "everyone gets a push", and
 * which kept doing it even after the SQL triggers learned about friends,
 * because this function re-derived the audience instead of consuming it. The
 * audience is now computed once, server-side, inside
 * `notify_new_public_feed_post` (202609100003: accepted friends, minus
 * author/blocks/bans/muted), chunked to <=200 ids per invocation, and this
 * function refuses to send anything when the list is absent. There is
 * deliberately NO fallback query: "send to everyone when targeting is
 * missing" is the exact bug this file used to be.
 *
 * Delivery hygiene, shared with notify-on-notification: invalid/unregistered
 * device tokens are pruned on the way out, transient 5xx/429s get one retry,
 * and the FCM payload carries a stable collapse key so a burst of posts to the
 * same person does not stack banners.
 */

const projectId = Deno.env.get("FCM_PROJECT_ID")!;
const serviceAccountJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON")!;
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const UUID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function pemToBuffer(pem: string) {
  const binary = atob(pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function accessToken() {
  const account = JSON.parse(serviceAccountJson);
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now })}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToBuffer(account.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` });
  return (await response.json()).access_token as string;
}

/* Caller gate — see the other notify-* functions. Only the database webhook
   (authenticated with the service role key) may drive this one; any valid
   user JWT otherwise lets a caller forge a fan-out push. */
async function requireServiceRole(req: Request): Promise<boolean> {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(token)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const ua = new Uint8Array(a), ub = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

async function sendFcm(token: string, projectId: string, message: unknown): Promise<{ ok: boolean; stale: boolean; retry: boolean }> {
  const doFetch = async () => {
    try {
      return await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
    } catch {
      return null;
    }
  };

  let response = await doFetch();
  // One retry for genuine transient faults (network, 429, 5xx). A 200-class
  // or a permanent 400 must never be replayed.
  if (!response || response.status === 429 || (response && response.status >= 500)) {
    await new Promise((resolve) => setTimeout(resolve, 400 + Math.floor(Math.random() * 400)));
    response = await doFetch();
    if (!response) return { ok: false, stale: false, retry: true };
  }
  if (response.ok) return { ok: true, stale: false, retry: false };
  const body = (await response.text().catch(() => "")).slice(0, 300);
  const stale = response.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*registration token/i.test(body);
  return { ok: false, stale, retry: response.status >= 500 };
}

Deno.serve(async (request) => {
  try {
    if (!(await requireServiceRole(request))) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    const payload = await request.json();
    const post = payload?.record ?? payload; // webhook-shaped or trigger-shaped
    const postId = String(payload?.post_id ?? post?.id ?? "");
    const preview = typeof payload?.preview === "string" && payload.preview.trim()
      ? payload.preview.trim().slice(0, 120)
      : typeof post?.body === "string" && post.body.trim()
      ? post.body.trim().slice(0, 120)
      : "A friend shared something on the Whisper public feed.";

    /* The audience. Anything that is not a list of real uuids ends delivery —
       no fallback to a broadcast, ever. */
    const rawRecipients = Array.isArray(payload?.recipients) ? payload.recipients : [];
    const recipients = [...new Set(rawRecipients.map((id: unknown) => String(id).toLowerCase()))].filter((id: string) =>
      UUID_RE.test(id)
    ).slice(0, 200);
    if (!postId || !recipients.length) {
      return new Response(JSON.stringify({ skipped: "no explicit recipients" }), { status: 200 });
    }

    const { data: tokens, error: tokenError } = await supabase
      .from("device_tokens")
      .select("fcm_token,user_id")
      .in("user_id", recipients);
    if (tokenError) {
      console.error("[notify-new-feed-post] device_tokens read failed:", tokenError.message);
      return new Response(JSON.stringify({ error: "token lookup failed" }), { status: 500 });
    }
    if (!tokens?.length) return new Response(JSON.stringify({ skipped: "no device tokens" }), { status: 200 });

    const fcmToken = await accessToken();
    if (!fcmToken) {
      console.error("[notify-new-feed-post] could not mint an FCM access token");
      return new Response(JSON.stringify({ error: "fcm auth failed" }), { status: 500 });
    }

    let sent = 0;
    let failed = 0;
    const deadTokens: string[] = [];
    const results = await Promise.all(
      tokens.map(async (row: { fcm_token: string; user_id: string }) => {
        const outcome = await sendFcm(fcmToken, projectId, {
          token: row.fcm_token,
          notification: { title: "A friend posted 📣", body: preview },
          /* `type` is what FCMMessagingService switches on to pick the channel
             and the deep link; postId powers /public-feed?post=. All values
             must be strings — FCM v1 rejects the whole message otherwise. */
          data: { type: "feed", postId, route: "/public-feed" },
          android: {
            priority: "high",
            collapse_key: `feed-post-${postId}`,
            notification: {
              channel_id: "feed",
              default_vibrate_timings: false,
              vibrate_timings: ["0s", "0.25s", "0.15s", "0.25s"],
            },
          },
          apns: { headers: { "apns-priority": "10" }, payload: { aps: { sound: "default" } } },
        });
        if (outcome.ok) {
          sent++;
          return;
        }
        failed++;
        if (outcome.stale) deadTokens.push(row.fcm_token);
      })
    );
    void results;

    /* Expired tokens must stop being retried forever — pruning here keeps
       dead installs from riding along on every future fan-out. */
    if (deadTokens.length) {
      const { error: pruneError } = await supabase.from("device_tokens").delete().in("fcm_token", deadTokens);
      if (pruneError) console.error("[notify-new-feed-post] token prune failed:", pruneError.message);
    }

    return new Response(
      JSON.stringify({ sent, failed, pruned: deadTokens.length, audience: recipients.length }),
      { status: 200 }
    );
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
});
