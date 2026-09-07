import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCloudinaryUrl } from "@/lib/cloudinary";
import { destroyCloudinaryUrl } from "@/lib/cloudinary.server";

/**
 * Deletes a direct message COMPLETELY.
 *
 * The old client path issued `supabase.from("direct_messages").delete()`, which
 * removed the row but never reaped its view-once media: an unopened photo kept
 * its Cloudinary asset (the destroy only ever happened inside /api/photos/view),
 * and an unplayed voice note kept its `voice-messages` object (the remove only
 * happened inside /api/audio/view). Those are the two media types a view-once
 * app must never leave behind — they exist to be forgotten — so the delete now
 * routes here, which removes the asset and the row in one authorized call.
 *
 * Pins and reactions reference the message with `on delete cascade`, so they go
 * with the row automatically.
 */

export async function POST(req: NextRequest) {
  try {
    const { messageId } = await req.json().catch(() => ({}));
    if (!messageId || typeof messageId !== "string") {
      return NextResponse.json({ error: "Missing messageId" }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const accessToken = authHeader.slice("Bearer ".length);

    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(accessToken);
    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { data: message, error: msgError } = await supabaseAdmin
      .from("direct_messages")
      .select("id, conversation_id, sender_id, image_path, audio_path")
      .eq("id", messageId)
      .single();

    if (msgError || !message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    /* Authorize: the caller must be a participant in the conversation.
       Matching the client delete rule, only the sender can delete a message —
       a delete is the sender taking it back, not the recipient. */
    const { data: convo } = await supabaseAdmin
      .from("conversations")
      .select("user_a, user_b")
      .eq("id", message.conversation_id)
      .single();

    const isParticipant =
      convo && (convo.user_a === user.id || convo.user_b === user.id);
    if (!isParticipant) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    if (message.sender_id !== user.id) {
      return NextResponse.json({ error: "Only the sender can delete this." }, { status: 403 });
    }

    /* Reap view-once media. A still-unopened photo is a Cloudinary URL; an
       unplayed voice note is a `voice-messages` object key (with a legacy
       presence in `view-once-photos`). Best-effort and logged: the row delete
       is the authoritative part, but for view-once media the asset is the
       payload and must not outlive the message. */
    if (message.image_path) {
      if (isCloudinaryUrl(message.image_path)) {
        const destroyed = await destroyCloudinaryUrl(message.image_path);
        if (!destroyed.ok) {
          console.error("[chat/delete-message] photo destroy failed:", destroyed.reason);
        }
      } else {
        /* Legacy supabase storage key (view-once-photos bucket). */
        const { error: storageError } = await supabaseAdmin.storage
          .from("view-once-photos")
          .remove([message.image_path]);
        if (storageError) {
          console.error("[chat/delete-message] legacy photo remove failed:", storageError.message);
        }
      }
    }

    if (message.audio_path) {
      /* Voice notes live in `voice-messages`; notes sent before that bucket
         existed live in `view-once-photos`. Whichever holds the object gets
         removed — the other remove is a harmless no-op on a missing key. */
      await supabaseAdmin.storage.from("voice-messages").remove([message.audio_path]);
      await supabaseAdmin.storage.from("view-once-photos").remove([message.audio_path]);
    }

    const { error: deleteError } = await supabaseAdmin
      .from("direct_messages")
      .delete()
      .eq("id", messageId);

    if (deleteError) {
      console.error("[chat/delete-message] row delete failed:", deleteError.message);
      return NextResponse.json({ error: "Couldn't delete that message." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[chat/delete-message] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
