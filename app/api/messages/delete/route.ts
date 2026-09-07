import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCloudinaryUrl } from "@/lib/cloudinary";
import { destroyCloudinaryUrl } from "@/lib/cloudinary.server";

/**
 * Deletes an anonymous whisper message COMPLETELY: its photo from Cloudinary (or
 * the legacy Supabase bucket), then the database row.
 *
 * The old client path deleted the image and the row as two independent calls.
 * Either half could silently fail and leave the other behind — a destroyed photo
 * with a row pointing at it, or a deleted row whose image was never reaped — and
 * the Cloudinary destroy went through a folder-ownership route that refused a
 * couple of real cases (an asset whose owner segment didn't match the caller).
 *
 * This route runs with the service role, so it can always remove the asset no
 * matter which folder segment it sits in; authorization is that the caller is
 * the message's recipient — the only person allowed to delete a whisper.
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
      .from("messages")
      .select("id, recipient_id, image_url")
      .eq("id", messageId)
      .single();

    if (msgError || !message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    /* Only the recipient may delete a whisper — the sender is often anonymous
       and not even signed in. */
    if (message.recipient_id !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const imageUrl: string | null = message.image_url;

    /* Purge the media first. A Cloudinary failure is logged but does not block
       the row delete — the row is the thing the user sees, and an orphaned asset
       in an unlisted folder is strictly better than a delete that reports an
       error and leaves both in place. */
    if (imageUrl) {
      if (isCloudinaryUrl(imageUrl)) {
        const destroyed = await destroyCloudinaryUrl(imageUrl);
        if (!destroyed.ok) {
          console.error("[messages/delete] cloudinary destroy failed:", destroyed.reason);
        }
      } else {
        /* Legacy `message-images` object key. */
        const marker = "/message-images/";
        const idx = imageUrl.indexOf(marker);
        if (idx !== -1) {
          const path = imageUrl.slice(idx + marker.length);
          const { error: storageError } = await supabaseAdmin.storage
            .from("message-images")
            .remove([path]);
          if (storageError) {
            console.error("[messages/delete] legacy storage remove failed:", storageError.message);
          }
        }
      }
    }

    const { error: deleteError } = await supabaseAdmin
      .from("messages")
      .delete()
      .eq("id", messageId)
      .eq("recipient_id", user.id);

    if (deleteError) {
      console.error("[messages/delete] row delete failed:", deleteError.message);
      return NextResponse.json({ error: "Couldn't delete that message." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[messages/delete] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
