import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FCM_PROJECT_ID = Deno.env.get("FCM_PROJECT_ID")!;
const FCM_SERVICE_ACCOUNT_JSON = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

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
  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsigned = `${encode(header)}.${encode(claims)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${btoa(
    String.fromCharCode(...new Uint8Array(signature))
  ).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
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

function routeFor(notification: {
  type?: string;
  metadata?: Record<string, unknown> | null;
}): string {
  const raw = String(notification.metadata?.type ?? notification.type ?? "").trim();
  if (raw === "public_feed") return "feed";
  if (raw === "reply") return "feed";
  if (raw === "coin_transfer") return "coins";
  return raw || "default";
}

const CHANNELS: Record<string, string> = {
  whisper: "whispers",
  message: "messages",
  friend_request: "friend_requests",
  feed: "feed",
  coins: "coins",
  call: "calls",
};

function toStringData(source: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;
    out[key] =
      typeof value === "string"
        ? value
        : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  }
  return out;
}

async function sendOne(
  accessToken: string,
  deviceToken: string,
  message: unknown
): Promise<{ ok: boolean; stale: boolean }> {
  const post = () =>
    fetch(
      `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      }
    ).catch(() => null);

  let response = await post();
  if (!response || response.status === 429 || response.status >= 500) {
    await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 400)));
    response = await post();
    if (!response) return { ok: false, stale: false };
  }
  if (response.ok) return { ok: true, stale: false };
  const body = (await response.text().catch(() => "")).slice(0, 300);
  const stale =
    response.status === 404 ||
    /UNREGISTERED|INVALID_ARGUMENT.*registration token/i.test(body);
  return { ok: false, stale };
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    console.log("[notify-on-notification] received payload:", JSON.stringify(payload).slice(0, 200));

    const notification = payload.record;
    if (!notification) {
      return new Response(JSON.stringify({ skipped: "no record" }), { status: 200 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("push_notifications")
      .eq("id", notification.user_id)
      .single();

    if (profile?.push_notifications === false) {
      return new Response(JSON.stringify({ skipped: "notifications disabled" }), { status: 200 });
    }

    const { data: tokens } = await supabase
      .from("device_tokens")
      .select("fcm_token")
      .eq("user_id", notification.user_id);

    if (!tokens || tokens.length === 0) {
      console.log("[notify-on-notification] no tokens for user:", notification.user_id);
      return new Response(JSON.stringify({ skipped: "no tokens" }), { status: 200 });
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
      console.error("[notify-on-notification] FCM auth failed");
      return new Response(JSON.stringify({ error: "fcm auth failed" }), { status: 500 });
    }

    const route = routeFor(notification);
    const meta = notification.metadata ?? {};
    const isCall = route === "call";

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
              default_vibrate_timings: false,
              vibrate_timings: ["0s", "0.25s", "0.15s", "0.25s"],
            },
          },
          apns: {
            headers: { "apns-priority": "10" },
            payload: { aps: { sound: "default" } },
          },
        };

        if (isCall && meta.call_id) {
          (message.android as Record<string, unknown>).collapse_key = `call-${meta.call_id}`;
          (message.android as Record<string, unknown>).ttl = "60s";
        } else {
          const collapse = meta.postId ?? meta.conversation_id ?? notification.id;
          if (collapse)
            (message.android as Record<string, unknown>).collapse_key = `${route}-${collapse}`;
        }

        return sendOne(accessToken, t.fcm_token, message);
      })
    );

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
      await supabase.from("device_tokens").delete().in("fcm_token", deadTokens);
    }

    console.log(`[notify-on-notification] sent:${sent} failed:${failed} route:${route}`);
    return new Response(
      JSON.stringify({ sent, failed, pruned: deadTokens.length, route }),
      { status: 200 }
    );
  } catch (err) {
    console.error("[notify-on-notification] error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});