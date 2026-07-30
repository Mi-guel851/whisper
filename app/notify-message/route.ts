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
  const { senderId, conversationId, content } = body;

  if (!senderId || !conversationId) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  // Get the conversation to find the recipient
  const { data: convo } = await supabaseAdmin
    .from("conversations")
    .select("user_a, user_b")
    .eq("id", conversationId)
    .single();

  if (!convo) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  }

  // Recipient is the other person
  const recipientId = convo.user_a === senderId ? convo.user_b : convo.user_a;

  // Get recipient's push subscriptions
  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", recipientId);

  if (!subs || subs.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  const payload = JSON.stringify({
    title: "New Message 💬",
    body: content ? content.slice(0, 100) : "📷 You received a photo",
    url: `/chat/${conversationId}`,
    conversationId,
  });

  let sent = 0;

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
        const statusCode = err instanceof Error && "statusCode" in err
          ? (err as { statusCode?: number }).statusCode
          : undefined;

        if (statusCode === 410 || statusCode === 404) {
          await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    })
  );

  return NextResponse.json({ sent });
}