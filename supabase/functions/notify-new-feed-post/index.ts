import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const projectId = Deno.env.get("FCM_PROJECT_ID")!;
const serviceAccountJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON")!;
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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

Deno.serve(async (request) => {
  try {
    const post = (await request.json()).record;
    if (!post?.id) return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    const { data: users } = await supabase.from("profiles").select("id").neq("id", post.author_id).eq("push_notifications", true);
    const userIds = (users || []).map((user) => user.id);
    const { data: tokens } = await supabase.from("device_tokens").select("fcm_token").in("user_id", userIds);
    if (!tokens?.length) return new Response(JSON.stringify({ skipped: "no device tokens" }), { status: 200 });
    const token = await accessToken();
    const results = await Promise.all(tokens.map((row: { fcm_token: string }) => fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token: row.fcm_token, notification: { title: "New Public Feed post", body: "Someone shared a new thought on Whisper." }, data: { postId: post.id, route: "/public-feed" } } }),
    })));
    return new Response(JSON.stringify({ sent: results.length }), { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
});
