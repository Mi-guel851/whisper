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
      .select("id, conversation_id, sender_id, image_path, is_view_once, image_viewed_at")
      .eq("id", messageId)
      .single();

    if (msgError || !message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    if (!message.is_view_once || !message.image_path) {
      return NextResponse.json({ error: "No photo to view" }, { status: 400 });
    }

    if (message.image_viewed_at) {
      return NextResponse.json({ error: "This photo has already been viewed" }, { status: 410 });
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
      return NextResponse.json({ error: "You can't view your own sent photo" }, { status: 403 });
    }

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from("view-once-photos")
      .download(message.image_path);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: "Photo unavailable" }, { status: 404 });
    }

    await supabaseAdmin
      .from("direct_messages")
      .update({ image_viewed_at: new Date().toISOString(), image_path: null })
      .eq("id", messageId);

    await supabaseAdmin.storage.from("view-once-photos").remove([message.image_path]);

    const arrayBuffer = await fileData.arrayBuffer();
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": fileData.type || "image/jpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Photo view error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}