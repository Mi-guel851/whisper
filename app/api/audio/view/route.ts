import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const { messageId } = await req.json();
    if (!messageId) {
      return NextResponse.json({ error: "Missing messageId" }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const accessToken = authHeader.replace("Bearer ", "");

    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(accessToken);
    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: message, error: msgError } = await supabaseAdmin
      .from("direct_messages")
      .select("id, conversation_id, sender_id, audio_path, audio_mime, is_view_once, audio_viewed_at")
      .eq("id", messageId)
      .single();

    if (msgError || !message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    if (!message.is_view_once || !message.audio_path) {
      return NextResponse.json({ error: "No audio available" }, { status: 400 });
    }

    if (message.audio_viewed_at) {
      return NextResponse.json({ error: "This audio has already been played" }, { status: 410 });
    }

    const { data: convo } = await supabaseAdmin
      .from("conversations")
      .select("user_a, user_b")
      .eq("id", message.conversation_id)
      .single();

    const isParticipant = convo && (convo.user_a === user.id || convo.user_b === user.id);
    if (!isParticipant) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    if (message.sender_id === user.id) {
      return NextResponse.json({ error: "You can't listen to your own voice note" }, { status: 403 });
    }

    /* Notes recorded before the dedicated audio bucket existed were uploaded
       into the photo bucket. Both are searched, and whichever one holds the
       object is the one the delete targets — otherwise playing a legacy note
       would 404, or worse, null the row while leaving the file behind. */
    const BUCKETS = ["voice-messages", "view-once-photos"] as const;
    let bucket: string | null = null;
    let fileData: Blob | null = null;

    for (const candidate of BUCKETS) {
      const { data, error } = await supabaseAdmin.storage
        .from(candidate)
        .download(message.audio_path);
      if (!error && data) { bucket = candidate; fileData = data; break; }
    }

    if (!fileData || !bucket) {
      return NextResponse.json({ error: "Audio unavailable" }, { status: 404 });
    }

    await supabaseAdmin
      .from("direct_messages")
      .update({ audio_viewed_at: new Date().toISOString(), audio_path: null })
      .eq("id", messageId);

    await supabaseAdmin.storage.from(bucket).remove([message.audio_path]);

    const arrayBuffer = await fileData.arrayBuffer();
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        /* The recorded container is authoritative. `fileData.type` is whatever
           storage reports and the hardcoded webm fallback was wrong on every
           WebKit client, where MediaRecorder writes MP4. */
        "Content-Type": message.audio_mime || fileData.type || "audio/webm",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Audio view error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
