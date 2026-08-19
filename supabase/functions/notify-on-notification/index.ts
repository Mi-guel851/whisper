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
  const b64 = pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * The route key FCMMessagingService switches on. Its `sendNotification` compares
 * against "whisper" | "message" | "friend_request" | "feed" and falls through to
 * the `default` channel and the dashboard deep link for anything else — so a
 * notification row typed `public_feed` has to be translated, not passed through.
 * The metadata's own `type` wins when present because that is what the triggers
 * set deliberately (whisper rows are typed `message` at the table level).
 */
function routeFor(notification: { type?: string; metadata?: Record<string, unknown> | null }): string {
  const raw = String(notification.metadata?.type ?? notification.type ?? "").trim();
  if (raw === "public_feed") return "feed";
  return raw || "default";
}

/** Vibration channels created up front by MainActivity, one per route. */
const CHANNELS: Record<string, string> = {
  whisper: "whispers",
  message: "messages",
  friend_request: "friend_requests",
  feed: "feed",
};

/**
 * FCM v1 rejects the entire message with a 400 if any value in `data` is not a
 * string — a single numeric or null field in the trigger's `jsonb_build_object`
 * would silently kill every push on that path. Objects are re-serialised rather
 * than dropped so nothing is lost, and nulls are omitted because Android reads
 * them back as the literal string "null".
 */
function toStringData(source: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;
    out[key] = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return out;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const notification = payload.record; // The notification table entry

    if (!notification) return new Response(JSON.stringify({ skipped: true }), { status: 200 });

    /* The per-table functions all check this and this one never did, so a user
       who turned notifications off still got everything routed through here. */
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

    /* `type` is written last so the route survives: several triggers put their
       own `type` in metadata, and spreading metadata over it would hand Android
       a value its switch does not recognise. */
    const messageData = toStringData({
      ...(notification.metadata ?? {}),
      type: route,
      notificationId: notification.id,
    });

    const results = await Promise.all(
      tokens.map((t: { fcm_token: string }) =>
        fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: {
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
            },
          }),
        })
      )
    );

    /* Counting attempts was reported as `sent`, so an FCM 400 — a stale token, a
       non-string data value — looked exactly like a delivered push. The response
       bodies are read and logged instead, which is the difference between "it
       says it worked" and knowing that it did. */
    const failures: string[] = [];
    for (const response of results) {
      if (response.ok) continue;
      failures.push(`${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    if (failures.length) console.error("[notify-on-notification] FCM rejected:", failures);

    return new Response(
      JSON.stringify({ sent: results.length - failures.length, failed: failures.length, route }),
      { status: 200 }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
