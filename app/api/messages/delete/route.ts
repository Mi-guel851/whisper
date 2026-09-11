import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCloudinaryUrl } from "@/lib/cloudinary";
import { destroyCloudinaryUrl } from "@/lib/cloudinary.server";

/**
 * Deletes anonymous whisper messages COMPLETELY: their photos from Cloudinary
 * (or the legacy Supabase bucket), then the database rows.
 *
 * ONE OR MANY
 *
 * The body takes `messageId` (the single-row button) or `messageIds` (the
 * multi-select: long-press, tick, delete). Both are here rather than a second
 * route because the work is identical per row and the authorization is the same
 * check — the caller must be the recipient. A "select all" on a busy inbox is
 * dozens of rows, and dozens of authenticated round trips from a phone is how a
 * delete turns into a spinner that some of the time half-fails.
 *
 * A partial delete is not an error: rows the caller does not own are dropped
 * from the request rather than failing the whole batch (they cannot be in a
 * selection built from this user's own inbox anyway).
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
    const body = (await req.json().catch(() => ({}))) as {
      messageId?: unknown;
      messageIds?: unknown;
    };

    /* Normalise both shapes into one deduped, bounded list. The cap is a guard
       on the request itself: a legitimate "select all" in this inbox is tens
       of rows, and an unbounded array is a way to make the server do an
       arbitrary amount of storage work in one call. */
    const MAX_BATCH = 200;
    const rawIds = Array.isArray(body.messageIds)
      ? body.messageIds
      : [body.messageId];
    const messageIds = [
      ...new Set(
        rawIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64)
      ),
    ].slice(0, MAX_BATCH);

    if (messageIds.length === 0) {
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

    const { data: messages, error: msgError } = await supabaseAdmin
      .from("messages")
      .select("id, recipient_id, image_url")
      .in("id", messageIds);

    if (msgError) {
      console.error("[messages/delete] lookup failed:", msgError.message);
      return NextResponse.json({ error: "Couldn't delete that message." }, { status: 500 });
    }

    /* Only the recipient may delete a whisper — the sender is often anonymous
       and not even signed in. Rows that are not this user's are dropped rather
       than refused, so a stale selection (deleted on another device, then
       deleted again here) still settles to the truth. */
    const owned = (messages ?? []).filter((row) => row.recipient_id === user.id);

    if (owned.length === 0) {
      const anyExists = (messages ?? []).length > 0;
      return NextResponse.json(
        { error: anyExists ? "Not authorized" : "Message not found" },
        { status: anyExists ? 403 : 404 }
      );
    }

    /* Purge the media first, in one wave. A Cloudinary failure is logged but
       does not block the row delete — the rows are what the user sees, and an
       orphaned asset in an unlisted folder is strictly better than a delete
       that reports an error and leaves everything in place. */
    await Promise.all(
      owned.map(async (message) => {
        const imageUrl: string | null = message.image_url;
        if (!imageUrl) return;
        if (isCloudinaryUrl(imageUrl)) {
          const destroyed = await destroyCloudinaryUrl(imageUrl);
          if (!destroyed.ok) {
            console.error("[messages/delete] cloudinary destroy failed:", destroyed.reason);
          }
          return;
        }
        /* Legacy `message-images` object key. */
        const marker = "/message-images/";
        const idx = imageUrl.indexOf(marker);
        if (idx === -1) return;
        const path = imageUrl.slice(idx + marker.length);
        const { error: storageError } = await supabaseAdmin.storage
          .from("message-images")
          .remove([path]);
        if (storageError) {
          console.error("[messages/delete] legacy storage remove failed:", storageError.message);
        }
      })
    );

    const ownedIds = owned.map((row) => row.id);
    const { error: deleteError } = await supabaseAdmin
      .from("messages")
      .delete()
      .in("id", ownedIds)
      .eq("recipient_id", user.id);

    if (deleteError) {
      console.error("[messages/delete] row delete failed:", deleteError.message);
      return NextResponse.json({ error: "Couldn't delete that message." }, { status: 500 });
    }

    return NextResponse.json({ success: true, deleted: ownedIds.length });
  } catch (err) {
    console.error("[messages/delete] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
