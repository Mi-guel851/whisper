import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CLOUDINARY_FOLDERS, cloudinaryPublicId } from "@/lib/cloudinary";
import { destroyCloudinaryImage } from "@/lib/cloudinary.server";

/**
 * Deletes an image the caller uploaded.
 *
 * Why a route at all: images now go straight from the browser to Cloudinary, and
 * deleting one needs the API secret, which a browser must never hold. Every
 * place that used to call `supabase.storage.from(...).remove([path])` to unwind a
 * half-finished action — a photo uploaded and then the coin spend failed, a
 * whisper the recipient deleted — calls this instead.
 *
 * The authorization is the folder. Assets are uploaded as
 * `whisper/<kind>/<owner-id>/<random>`, so the segment before the filename says
 * who may delete it, exactly the way the old storage policies read ownership out
 * of the object key (`split_part(name, '/', 1) = auth.uid()`). Anything outside
 * the caller's own folder is refused without a lookup.
 *
 * The one asymmetry worth naming: for an anonymous whisper photo the owner
 * segment is the *recipient's* id, not the sender's — the sender may not be
 * logged in at all. That is deliberate and matches the old
 * `message-images/<recipientId>/...` key: the recipient is the person who can
 * delete the message, so the recipient is the owner of its photo.
 */

/** Folders this route will touch. A typo'd or hostile prefix is not deletable. */
const DELETABLE = new Set<string>([
  CLOUDINARY_FOLDERS.avatars,
  CLOUDINARY_FOLDERS.messageImages,
  CLOUDINARY_FOLDERS.feedPhotos,
  CLOUDINARY_FOLDERS.viewOnce,
]);

/** Splits `whisper/<kind>/<owner>/<name>` into its folder and owner. */
function parseOwnership(publicId: string): { folder: string; owner: string } | null {
  const segments = publicId.split("/");
  if (segments.length < 4) return null;
  const owner = segments[segments.length - 2];
  const folder = segments.slice(0, segments.length - 2).join("/");
  if (!owner || !DELETABLE.has(folder)) return null;
  return { folder, owner };
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const accessToken = authHeader.slice("Bearer ".length);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      console.error("[cloudinary/destroy] Supabase environment variables are not set.");
      return NextResponse.json({ error: "Server not configured" }, { status: 500 });
    }

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const publicId = cloudinaryPublicId(url);
    if (!publicId) {
      return NextResponse.json({ error: "Not a Cloudinary image" }, { status: 400 });
    }

    const ownership = parseOwnership(publicId);
    if (!ownership || ownership.owner !== user.id) {
      return NextResponse.json({ error: "That image isn't yours." }, { status: 403 });
    }

    const result = await destroyCloudinaryImage(publicId);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[cloudinary/destroy] route error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
