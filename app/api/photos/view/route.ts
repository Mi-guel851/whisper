import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCloudinaryUrl } from "@/lib/cloudinary";
import { destroyCloudinaryUrl, fetchCloudinaryImage } from "@/lib/cloudinary.server";

/**
 * Serves a chat view-once photo, exactly once.
 *
 * `image_path` holds a Cloudinary delivery URL for anything sent since the
 * storage migration, and a `view-once-photos` object key for anything sent
 * before it. Both are still served: an unopened photo from last week must not
 * break because the upload path changed underneath it.
 *
 * What "once" rests on differs between the two, and it is worth being precise.
 * The old bucket was private, so the guarantee was that no URL existed. A
 * Cloudinary URL is publicly fetchable by anyone holding it, so the guarantee is
 * instead: the URL is never sent to a browser (these bytes are proxied), and the
 * asset is destroyed on first view. That makes the destroy call part of the
 * feature rather than cleanup — so it happens before the bytes are returned, and
 * a failure to destroy fails the request.
 */

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

    const storedPath = message.image_path as string;
    const markViewed = () =>
      supabaseAdmin
        .from("direct_messages")
        .update({ image_viewed_at: new Date().toISOString(), image_path: null })
        .eq("id", messageId);

    if (isCloudinaryUrl(storedPath)) {
      const image = await fetchCloudinaryImage(storedPath);
      if (!image) {
        return NextResponse.json({ error: "Photo unavailable" }, { status: 404 });
      }

      /**
       * Destroy before the row is touched, and fail closed.
       *
       * The order is the opposite of the legacy path below, for a reason. There,
       * nulling `image_path` was enough on its own — the bucket was private, so
       * the key was the only handle that existed. Here the URL is fetchable by
       * anyone holding it, so the destroy is the guarantee, not the tidy-up.
       *
       * Failing closed means a Cloudinary outage costs the viewer a retry rather
       * than the photo: `image_path` is still there, so the tap can be repeated.
       * The reverse order would spend the single view on a request that left the
       * asset alive.
       */
      const destroyed = await destroyCloudinaryUrl(storedPath);
      if (!destroyed.ok) {
        console.error("[photos/view] refusing to serve — destroy failed:", destroyed.reason);
        return NextResponse.json(
          { error: "Couldn't open that photo. Please try again." },
          { status: 502 }
        );
      }

      await markViewed();

      return new NextResponse(image.bytes, {
        status: 200,
        headers: {
          "Content-Type": image.contentType,
          "Cache-Control": "no-store",
        },
      });
    }

    /* Legacy: a `view-once-photos` object key, written before the migration. */
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from("view-once-photos")
      .download(storedPath);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: "Photo unavailable" }, { status: 404 });
    }

    await markViewed();

    await supabaseAdmin.storage.from("view-once-photos").remove([storedPath]);

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