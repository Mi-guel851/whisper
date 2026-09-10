import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const projectId = Deno.env.get("FCM_PROJECT_ID")!;
const serviceAccountJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON")!;
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")!
);

const UUID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function pemToBuffer(pem: string) {
  const binary = atob(
    pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s/g, "")
  );
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function accessToken() {
  const account = JSON.parse(serviceAccountJson);
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBuffer(account.private_key),
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
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  return (await response.json()).access_token as string;
}

async function sendFcm(
  token: string,
  projectId: string,
  message: unknown
): Promise<{ ok: boolean; stale: boolean }> {
  const doFetch = async () => {
    try {
      return await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        }
      );
    } catch {
      return null;
    }
  };

  let response = await doFetch();
  if (!response || response.status === 429 || response.status >= 500) {
    await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 400)));
    response = await doFetch();
    if (!response) return { ok: false, stale: false };
  }
  if (response.ok) return { ok: true, stale: false };
  const body = (await response.text().catch(() => "")).slice(0, 300);
  const stale =
    response.status === 404 ||
    /UNREGISTERED|INVALID_ARGUMENT.*registration token/i.test(body);
  return { ok: false, stale };
}

Deno.serve(async (request) => {
  try {
    const payload = await request.json();
    console.log("[notify-new-feed-post] payload:", JSON.stringify(payload).slice(0, 200));

    const postId = String(payload?.post_id ?? payload?.record?.id ?? "");
    const preview =
      typeof payload?.preview === "string" && payload.preview.trim()
        ? payload.preview.trim().slice(0, 120)
        : typeof payload?.record?.body === "string"
        ? payload.record.body.trim().slice(0, 120)
        : "A friend shared something on the Whisper public feed.";

    const rawRecipients = Array.isArray(payload?.recipients) ? payload.recipients : [];
    const recipients = [...new Set(rawRecipients.map((id: unknown) => String(id).toLowerCase()))]
      .filter((id: string) => UUID_RE.test(id))
      .slice(0, 200);

    if (!postId || !recipients.length) {
      console.log("[notify-new-feed-post] skipped — no recipients or postId");
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

    if (!tokens?.length) {
      return new Response(JSON.stringify({ skipped: "no device tokens" }), { status: 200 });
    }

    const fcmToken = await accessToken();
    if (!fcmToken) {
      console.error("[notify-new-feed-post] FCM auth failed");
      return new Response(JSON.stringify({ error: "fcm auth failed" }), { status: 500 });
    }

    let sent = 0;
    let failed = 0;
    const deadTokens: string[] = [];

    await Promise.all(
      tokens.map(async (row: { fcm_token: string; user_id: string }) => {
        const outcome = await sendFcm(fcmToken, projectId, {
          token: row.fcm_token,
          notification: { title: "A friend posted 📣", body: preview },
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
          apns: {
            headers: { "apns-priority": "10" },
            payload: { aps: { sound: "default" } },
          },
        });
        if (outcome.ok) sent++;
        else {
          failed++;
          if (outcome.stale) deadTokens.push(row.fcm_token);
        }
      })
    );

    if (deadTokens.length) {
      await supabase.from("device_tokens").delete().in("fcm_token", deadTokens);
    }

    console.log(`[notify-new-feed-post] sent:${sent} failed:${failed} pruned:${deadTokens.length}`);
    return new Response(
      JSON.stringify({ sent, failed, pruned: deadTokens.length, audience: recipients.length }),
      { status: 200 }
    );
  } catch (error) {
    console.error("[notify-new-feed-post] error:", error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
});