import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FCM_PROJECT_ID = Deno.env.get("FCM_PROJECT_ID")!;
const FCM_SERVICE_ACCOUNT_JSON = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getAccessToken(): Promise<string> {
  const serviceAccount = JSON.parse(FCM_SERVICE_ACCOUNT_JSON);
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const encode = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsigned = `${encode(header)}.${encode(claims)}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(serviceAccount.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` });
  const data = await res.json();
  return data.access_token;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * The route key FCMMessagingService switches on. Its `sendNotification` compares
 * against "whisper" | "message" | "friend_request" | "feed" | "call" | "coins"
 * and falls through to the `default` channel and the dashboard deep link for
 * anything else — so notification-row types that are not route keys have to be
 * translated, not passed through. The metadata's own `type` wins when present
 * because that is what the triggers set deliberately (whisper rows are typed
 * `message` at the table level only for missed CALL entries; see 0005).
 */
function routeFor(notification: { type?: string; metadata?: Record<string, unknown> | null }): string {
  const raw = String(notification.metadata?.type ?? notification.type ?? "").trim();
  if (raw === "public_feed") return "feed";
  if (raw === "reply") return "feed";
  if (raw === "coin_transfer") return "coins";
  return raw || "default";
}

/** Vibration channels created up front by MainActivity, one per route. */
const CHANNELS: Record<string, string> = {
  whisper: "whispers",
  message: "messages",
  friend_request: "friend_requests",
  feed: "feed",
  coins: "coins",
  call: "calls",
};

/**
 * Stringify the data map FCM carries. FCM v1 rejects a non-JSON-string object
 * outright, so every value must be a string; ids are also what the native side
 * derives stable notification ids from.
 */
function toStringData(source: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;
    out[key] = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return out;
}

/* ------------------------------------------------------------------------- *
 * Caller gate: database-only.
 *
 * Supabase's verify_jwt on a deployed function accepts ANY valid JWT — an
 * ordinary signed-in user's token is one. This function trusts the `record`
 * in the request body to decide WHO gets notified, so an ungated endpoint
 * lets any user forge pushes and burn the FCM quota. The only legitimate
 * caller is the pg_net trigger / database webhook, which authenticates with
 * the service role key — so require exactly that, compared on SHA-256
 * digests to keep the check constant-time.
 * ------------------------------------------------------------------------- */
async function requireServiceRole(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(token)),
    crypto.subtle.digest("SHA-256", enc.encode(SUPABASE_SERVICE_ROLE_KEY)),
  ]);
  const ua = new Uint8Array(a), ub = new Uint8Array(b);
  if (ua.length !== ub.length) return false;
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

function unauthorized() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

async function sendOne(accessToken: string, deviceToken: string, message: unknown): Promise<{ ok: boolean; stale: boolean }> {
  const post = () =>
    fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    }).catch(() => null);

  let response = await post();
  /* Exactly one retry, and only for transient faults. A delivered-looking 400
     repeated is a quota burn, not a recovery. */
  if (!response || response.status === 429 || (response && response.status >= 500)) {
    await new Promise((resolve) => setTimeout(resolve, 400 + Math.floor(Math.random() * 400)));
    response = await post();
    if (!response) return { ok: false, stale: false };
  }
  if (response.ok) return { ok: true, stale: false };
  const body = (await response.text().catch(() => "")).slice(0, 300);
  const stale = response.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*registration token/i.test(body);
  return { ok: false, stale };
}

Deno.serve(async (req) => {
  try {
    if (!(await requireServiceRole(req))) return unauthorized();
    const payload = await req.json();

    /* ------------------------------------------------------------------
     * Cancel action (calls): a data-only message that removes the ringing
     * notification from every device of the peer when the call is answered
     * elsewhere, declined, hung up, or swept expired. No `notification`
     * block means nothing displays — this silently retracts, and
     * FCMMessagingService matches on `type: call_cancel` + callId.
     * ------------------------------------------------------------------ */
    if (payload?.action === "cancel") {
      const userId = String(payload.user_id ?? "");
      const callId = String(payload.call_id ?? "");
      if (!userId || !callId) return new Response(JSON.stringify({ skipped: "bad cancel" }), { status: 400 });

      const { data: tokens } = await supabase.from("device_tokens").select("fcm_token").eq("user_id", userId);
      if (!tokens?.length) return new Response(JSON.stringify({ skipped: "no tokens" }), { status: 200 });

      const accessToken = await getAccessToken();
      if (!accessToken) return new Response(JSON.stringify({ error: "fcm auth failed" }), { status: 500 });

      await Promise.all(
        tokens.map((t: { fcm_token: string }) =>
          fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              message: {
                token: t.fcm_token,
                data: { type: "call_cancel", callId },
                android: { priority: "high", collapse_key: `call-cancel-${callId}`, ttl: "60s" },
              },
            }),
          }).catch(() => null)
        )
      );
      return new Response(JSON.stringify({ cancelled: tokens.length }), { status: 200 });
    }

    const notification = payload.record; // The notification table entry

    if (!notification) return new Response(JSON.stringify({ skipped: true }), { status: 200 });

    /* The per-table functions all check this and this one never did, so a user
       who turned notifications off still got everything routed through here.
       Feed rows additionally filter at write time (202609100003). */
    const { data: profile } = await supabase
      .from("profiles")
      .select("push_notifications")
      .eq("id", notification.user_id)
      .single();

    if (profile?.push_notifications === false) {
      return new Response(JSON.stringify({ skipped: "user disabled notifications" }), { status: 200 });
    }

    const { data: tokens } = await supabase.from("device_tokens").select("fcm_token").eq("user_id", notification.user_id);
    if (!tokens || tokens.length === 0) return new Response(JSON.stringify({ skipped: "no tokens" }), { status: 200 });

    const accessToken = await getAccessToken();
    if (!accessToken) {
      console.error("[notify-on-notification] could not mint an FCM access token");
      return new Response(JSON.stringify({ error: "fcm auth failed" }), { status: 500 });
    }

    const route = routeFor(notification);
    const meta = notification.metadata ?? {};
    const isCall = route === "call";

    /* `type` is written last so the route survives: several triggers put their
       own `type` in metadata, and spreading metadata over it would hand Android
       a value its switch does not recognise. */
    const messageData = toStringData({
      ...meta,
      type: route,
      notificationId: notification.id,
    });

    const results = await Promise.all(
      tokens.map(async (t: { fcm_token: string }) => {
        const message: Record<string, unknown> = {
          token: t.fcm_token,
          notification: {
            title: notification.title,
            body: notification.body,
          },
          data: messageData,
          android: {
            priority: "high",
            notification: {
              channel_id: CHANNELS[route] ?? "default",
              /* Android only applies these if it is told not to use the
                 channel's own pattern. Without the opt-out the timings below
                 are parsed and then ignored. */
              default_vibrate_timings: false,
              vibrate_timings: ["0s", "0.25s", "0.15s", "0.25s"],
            },
          },
          apns: {
            headers: { "apns-priority": "10" },
            payload: { aps: { sound: "default" } },
          },
        };

        /* A ring is perishable: it must not arrive after the caller hung up.
           Collapse keeps replays/bursts to one banner, and the 60s TTL matches
           the server-side expiry window in 202609100005 — past that, FCM
           drops it rather than waking someone for a dead call. */
        if (isCall && meta.call_id) {
          (message.android as Record<string, unknown>).collapse_key = `call-${meta.call_id}`;
          (message.android as Record<string, unknown>).ttl = "60s";
        } else {
          const collapse = meta.postId ?? meta.conversation_id ?? notification.id;
          if (collapse) (message.android as Record<string, unknown>).collapse_key = `${route}-${collapse}`;
        }

        return sendOne(accessToken, t.fcm_token, message);
      })
    );

    /* Counting attempts was reported as `sent`, so an FCM 400 — a stale token,
       a non-string data value — looked exactly like a delivered push. The
       results are now truth-bearing, and unregistered tokens are pruned so a
       dead install stops riding every future notification. */
    let sent = 0;
    let failed = 0;
    const deadTokens: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const outcome = results[i];
      if (outcome.ok) sent++;
      else {
        failed++;
        if (outcome.stale) deadTokens.push(tokens[i].fcm_token);
      }
    }
    if (deadTokens.length) {
      const { error: pruneError } = await supabase.from("device_tokens").delete().in("fcm_token", deadTokens);
      if (pruneError) console.error("[notify-on-notification] token prune failed:", pruneError.message);
    }

    return new Response(
      JSON.stringify({ sent, failed, pruned: deadTokens.length, route }),
      { status: 200 }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
