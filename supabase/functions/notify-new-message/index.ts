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

    const { data: convo } = await supabase
      .from("conversations")
      .select("user_a, user_b")
      .eq("id", message.conversation_id)
      .single();

    if (!convo) {
      return new Response(JSON.stringify({ error: "conversation not found" }), { status: 404 });
    }

    const receiverId = convo.user_a === message.sender_id ? convo.user_b : convo.user_a;

    const { data: tokens } = await supabase
      .from("device_tokens")
      .select("fcm_token")
      .eq("user_id", receiverId);

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ skipped: "no device tokens" }), { status: 200 });
    }

    const accessToken = await getAccessToken();
    const body = message.is_view_once
      ? "👻 Sent you a photo"
      : (message.content || "New message").slice(0, 120);

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
                  title: "New anonymous message 👻",
                  body,
                },
                data: {
                  conversationId: message.conversation_id,
                },
              },
            }),
          }
        )
      )
    );

    return new Response(JSON.stringify({ sent: results.length }), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});