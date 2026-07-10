import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { collectSenderMetadata } from "@/lib/messageMetadata";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "missing-anon-key";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as {
      recipient_id?: string;
      message?: string | null;
      image_url?: string | null;
    } | null;

    const recipientId = body?.recipient_id?.trim();
    const text = body?.message?.trim() || null;
    const imageUrl = body?.image_url || null;

    if (!recipientId) {
      return NextResponse.json({ error: "Recipient is required." }, { status: 400 });
    }

    if (!text && !imageUrl) {
      return NextResponse.json({ error: "Write a message or attach an image." }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    let senderUserId: string | null = null;

    if (token) {
      const { data } = await supabase.auth.getUser(token);
      senderUserId = data.user?.id || null;
    }

    const metadata = collectSenderMetadata(request);

    const { error } = await supabase.from("messages").insert({
      recipient_id: recipientId,
      message: text,
      image_url: imageUrl,
      sender_is_registered: Boolean(senderUserId),
      sender_user_id: senderUserId,
      ...metadata,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[messages] submit failed", error);
    return NextResponse.json({ error: "Unable to send message right now." }, { status: 500 });
  }
}
