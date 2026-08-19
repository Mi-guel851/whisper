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

  const jwt = `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")}`;

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

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const message = payload.record;

    if (!message) {
      return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    }

    const senderId = message.sender_id;
    const conversationId = message.conversation_id;

    // 1. Get conversation to find the recipient
    const { data: convo, error: convoError } = await supabase
      .from("conversations")
      .select("user_a, user_b")
      .eq("id", conversationId)
      .single();

    if (convoError || !convo) {
      return new Response(JSON.stringify({ error: "conversation not found" }), { status: 200 });
    }

    const receiverId = convo.user_a === senderId ? convo.user_b : convo.user_a;

    // 2. Check push notification preference
    const { data: profile } = await supabase
      .from("profiles")
      .select("push_notifications")
      .eq("id", receiverId)
      .single();

    // Null means "never opened the setting", which the rest of the app treats as
    // opted-in. Only an explicit false stops a push.
    if (profile?.push_notifications === false) {
      return new Response(JSON.stringify({ skipped: "user disabled notifications" }), { status: 200 });
    }

    // 3. Get FCM tokens
    const { data: tokens } = await supabase
      .from("device_tokens")
      .select("fcm_token")
      .eq("user_id", receiverId);

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ skipped: "no device tokens" }), { status: 200 });
    }

    // 4. Build notification body
    const accessToken = await getAccessToken();
    const body = message.image_path
      ? "📷 Sent you a photo"
      : message.audio_path
      ? "🎙️ Sent you a voice note"
      : (message.content || "New message").slice(0, 120);

    // 5. Send FCM push to all devices
    const results = await Promise.all(
      tokens.map((t: { fcm_token: string }) =>
        fetch(
          `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: {
                token: t.fcm_token,
                notification: {
                  title: "New chat message 💬",
                  body,
                },
                data: {
                  /* Was "direct_message", which FCMMessagingService matches
                     against nothing — so every inbox push landed on the default
                     channel and its tap opened the dashboard instead of the
                     conversation. "message" is the value that switch expects. */
                  type: "message",
                  conversationId: String(conversationId ?? ""),
                  messageId: String(message.id ?? ""),
                },
                android: {
                  priority: "high",
                  notification: {
                    channel_id: "messages",
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
          }
        )
      )
    );

    const failures: string[] = [];
    for (const response of results) {
      if (response.ok) continue;
      failures.push(`${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    if (failures.length) console.error("[notify-new-direct-message] FCM rejected:", failures);

    return new Response(
      JSON.stringify({ sent: results.length - failures.length, failed: failures.length }),
      { status: 200 }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});