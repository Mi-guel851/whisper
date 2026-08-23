import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

/**
 * One channel per route, created up front by MainActivity. The channel is what
 * actually owns the vibration pattern on Android 8+, so a push that names no
 * channel lands on "default" — which is the one channel that does not vibrate.
 *
 * Must stay in step with CHANNELS in supabase/functions/notify-on-notification
 * and the switch in FCMMessagingService.java.
 */
const FCM_CHANNELS: Record<string, string> = {
  whisper: "whispers",
  message: "messages",
  friend_request: "friend_requests",
  feed: "feed",
};

// ── Get FCM V1 access token using service account ──
async function getFCMAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const headerB64 = encode(header);
  const claimB64 = encode(claim);
  const signingInput = `${headerB64}.${claimB64}`;

  // Import private key
  const pemKey = serviceAccount.private_key.replace(/\\n/g, "\n");
  const keyData = pemKey
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binaryKey = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt = `${signingInput}.${sigB64}`;

  // Exchange JWT for access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-webhook-secret");
  if (secret !== process.env.PUSH_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const vapidSubject = process.env.VAPID_SUBJECT;
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

  if (!vapidSubject || !vapidPublicKey || !vapidPrivateKey) {
    return NextResponse.json({ error: "missing push configuration" }, { status: 500 });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const body = await req.json();
  const record = body.record;
  const supabaseAdmin = getSupabaseAdmin();

  let recipientId: string | null = null;
  let notificationTitle = "";
  let notificationBody = "";
  let notificationUrl = "/dashboard";
  /* The route key FCMMessagingService switches on, and the channel that decides
     whether the phone vibrates. Kept in step with CHANNELS in
     supabase/functions/notify-on-notification/index.ts. */
  let notificationType = "default";
  let notificationConversationId: string | null = null;

  // ── Whisper (anonymous message) ──
  if (record?.recipient_id) {
    recipientId = record.recipient_id;
    notificationTitle = "New Whisper 👻";
    notificationBody = record.message
      ? record.message.slice(0, 100)
      : "You received an anonymous image";
    notificationUrl = "/dashboard";
    notificationType = "whisper";
  }

  // ── Direct message (inbox chat) ──
  else if (record?.conversation_id && record?.sender_id) {
    const { data: convo } = await supabaseAdmin
      .from("conversations")
      .select("user_a, user_b")
      .eq("id", record.conversation_id)
      .single();

    if (!convo) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    recipientId =
      convo.user_a === record.sender_id ? convo.user_b : convo.user_a;

    notificationTitle = "New chat message 💬";
    notificationBody = record.is_view_once
      ? "📷 Sent you a photo"
      : record.content
      ? record.content.slice(0, 100)
      : "You have a new message";
    notificationUrl = `/chat/${record.conversation_id}`;
    notificationType = "message";
    notificationConversationId = record.conversation_id;
  }

  if (!recipientId) {
    return NextResponse.json({ error: "could not determine recipient" }, { status: 400 });
  }

  // ── Check recipient has notifications enabled ──
  /*
   * `push_notifications`, not `notify`. This route was the only place in the app
   * reading `profiles.notify` — every other gate (the registration hook, both
   * notify-* edge functions, notify_new_public_feed_post) reads
   * `push_notifications`. So a user with push switched on registered a token,
   * passed every other check, and was dropped here because a column nothing else
   * maintains was null.
   *
   * `!== false` for the same reason those do: the column is nullable and null
   * means opted in, so a profile created before the column existed still gets
   * notifications rather than silently never receiving one.
   */
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("push_notifications")
    .eq("id", recipientId)
    .single();

  if (profile?.push_notifications === false) {
    return NextResponse.json({ sent: 0, reason: "notifications disabled" });
  }

  let sent = 0;

  // ── Web push (browser) ──
  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", recipientId);

  if (subs && subs.length > 0) {
    const webPayload = JSON.stringify({
      title: notificationTitle,
      body: notificationBody,
      url: notificationUrl,
    });

    await Promise.all(
      (subs as PushSubscriptionRow[]).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            webPayload
          );
          sent++;
        } catch (err) {
          const statusCode =
            err instanceof Error && "statusCode" in err
              ? (err as unknown as { statusCode: number }).statusCode
              : undefined;
          if (statusCode === 410 || statusCode === 404) {
            await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
          }
        }
      })
    );
  }

  // ── FCM V1 push (mobile app) ──
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    try {
      const serviceAccount: ServiceAccount = JSON.parse(serviceAccountJson);
      const accessToken = await getFCMAccessToken(serviceAccount);

      /*
       * `fcm_token`, not `token`. This was the reason no notification from this
       * route ever reached the Android app: the column is `fcm_token` — it is what
       * lib/push/useRegisterPushNotifications.ts writes and what both notify-*
       * edge functions read — so selecting `token` returned an error and a null
       * set, the `if` below was never entered, and the route still answered
       * 200 with a `sent` count made up entirely of web-push deliveries. A
       * silent, successful-looking no-op. See 202608230001_device_tokens.sql.
       */
      const { data: deviceTokens, error: tokenError } = await supabaseAdmin
        .from("device_tokens")
        .select("fcm_token")
        .eq("user_id", recipientId);

      if (tokenError) {
        console.error("[send-push] device_tokens read failed:", tokenError.message);
      }

      if (deviceTokens && deviceTokens.length > 0) {
        await Promise.all(
          deviceTokens.map(async ({ fcm_token: token }: { fcm_token: string }) => {
            try {
              const fcmRes = await fetch(
                `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${accessToken}`,
                  },
                  body: JSON.stringify({
                    message: {
                      token,
                      notification: {
                        title: notificationTitle,
                        body: notificationBody,
                      },
                      /*
                       * `type` and `route` are what FCMMessagingService switches
                       * on to pick a channel and build its `whisperapp://` deep
                       * link. Without them every push from this route landed on
                       * the "default" channel — which is the channel with no
                       * vibration pattern — and opened the dashboard whatever it
                       * was about.
                       */
                      data: {
                        url: notificationUrl,
                        route: notificationUrl,
                        type: notificationType,
                        ...(notificationConversationId
                          ? { conversationId: notificationConversationId }
                          : {}),
                      },
                      /*
                       * High priority plus an explicit channel, matching
                       * notify-on-notification. Android holds a normal-priority
                       * message until the next maintenance window when the device
                       * is dozing, which is exactly when a notification most needs
                       * to arrive.
                       */
                      android: {
                        priority: "high",
                        notification: {
                          channel_id: FCM_CHANNELS[notificationType] ?? "default",
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
              );

              if (fcmRes.ok) {
                sent++;
              } else {
                const errData = await fcmRes.json();
                console.error("[send-push] FCM V1 error:", errData);

                // Remove invalid tokens
                if (
                  errData?.error?.status === "UNREGISTERED" ||
                  errData?.error?.status === "INVALID_ARGUMENT"
                ) {
                  await supabaseAdmin
                    .from("device_tokens")
                    .delete()
                    .eq("fcm_token", token);
                }
              }
            } catch (err) {
              console.error("[send-push] FCM request error:", err);
            }
          })
        );
      }
    } catch (err) {
      console.error("[send-push] FCM service account error:", err);
    }
  }

  return NextResponse.json({ sent });
}