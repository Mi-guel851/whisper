import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

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

  // ── Whisper (anonymous message) ──
  if (record?.recipient_id) {
    recipientId = record.recipient_id;
    notificationTitle = "New Whisper 👻";
    notificationBody = record.message
      ? record.message.slice(0, 100)
      : "You received an anonymous image";
    notificationUrl = "/dashboard";
  }

  // ── Direct message (inbox chat) ──
  else if (record?.conversation_id && record?.sender_id) {
    // Look up the conversation to find the recipient
    const { data: convo } = await supabaseAdmin
      .from("conversations")
      .select("user_a, user_b")
      .eq("id", record.conversation_id)
      .single();

    if (!convo) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    // Recipient is whoever is NOT the sender
    recipientId =
      convo.user_a === record.sender_id ? convo.user_b : convo.user_a;

    notificationTitle = "New chat message 💬";
    notificationBody = record.is_view_once
      ? "📷 Sent you a photo"
      : record.content
      ? record.content.slice(0, 100)
      : "You have a new message";
    notificationUrl = `/chat/${record.conversation_id}`;
  }

  if (!recipientId) {
    return NextResponse.json({ error: "could not determine recipient" }, { status: 400 });
  }

  // ── Check recipient has notifications enabled ──
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("notify")
    .eq("id", recipientId)
    .single();

  if (!profile?.notify) {
    return NextResponse.json({ sent: 0, reason: "notifications disabled" });
  }

  const payload = JSON.stringify({
    title: notificationTitle,
    body: notificationBody,
    url: notificationUrl,
  });

  let sent = 0;

  // ── Web push (browser) ──
  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", recipientId);

  if (subs && subs.length > 0) {
    await Promise.all(
      (subs as PushSubscriptionRow[]).map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload
          );
          sent++;
        } catch (err) {
          const statusCode =
            err instanceof Error && "statusCode" in err
              ? (err as unknown as { statusCode: number }).statusCode
              : undefined;
          if (statusCode === 410 || statusCode === 404) {
            await supabaseAdmin
              .from("push_subscriptions")
              .delete()
              .eq("id", sub.id);
          }
        }
      })
    );
  }

  // ── FCM push (mobile app) ──
  const fcmServerKey = process.env.FCM_SERVER_KEY;
  if (fcmServerKey) {
    const { data: deviceTokens } = await supabaseAdmin
      .from("device_tokens")
      .select("token")
      .eq("user_id", recipientId);

    if (deviceTokens && deviceTokens.length > 0) {
      await Promise.all(
        deviceTokens.map(async ({ token }: { token: string }) => {
          try {
            const fcmRes = await fetch(
              "https://fcm.googleapis.com/fcm/send",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `key=${fcmServerKey}`,
                },
                body: JSON.stringify({
                  to: token,
                  notification: {
                    title: notificationTitle,
                    body: notificationBody,
                  },
                  data: { url: notificationUrl },
                }),
              }
            );
            if (fcmRes.ok) sent++;
          } catch (err) {
            console.error("[send-push] FCM error:", err);
          }
        })
      );
    }
  }

  return NextResponse.json({ sent });
}