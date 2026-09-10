import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CLOUDINARY_FOLDERS, CLOUDINARY_CLOUD_NAME } from "@/lib/cloudinary";
import { signUploadParams } from "@/lib/cloudinary.server";
import { consume, rateLimitedResponse } from "@/lib/apiGuard";

/**
 * Mints a signed Cloudinary upload policy for one authenticated image upload.
 *
 * WHY: every image in the app is uploaded straight from the browser, and the
 * unsigned preset applies the same (weakest) rules to every caller and every
 * folder. A signature lets the SERVER pin the folder, the byte ceiling, the
 * image-only resource type and no-overwrite per upload, so abuse controls live
 * at the provider — not "only in the browser".
 *
 * WHAT IS AND IS NOT AUTHORIZATION:
 *   - identity comes from the Bearer JWT (`auth.getUser`), never the body;
 *   - the folder's owner segment must be the caller, with one deliberate
 *     exception: `whisper/message-images/<recipientId>` is written by the
 *     *sender* but owned by the *recipient* (the destroy route treats the
 *     folder owner as the deletion right; an anonymous whisper's photo must be
 *     deletable by whoever receives it). The recipient id is therefore only
 *     required to be a uuid — a fresh, uniquely-named object in someone's
 *     folder is the entire exposure, which the per-user budget below bounds;
 *   - rows that reference an asset are STILL checked against their owner by
 *     the feed/chat routes and the DB CHECK (cloudinary_asset_owned_by) — this
 *     endpoint authorizes an upload, not a post.
 *
 * If CLOUDINARY_API_KEY/SECRET are not configured the route answers 503 and
 * the client falls back to the unsigned preset — an unconfigured server
 * degrades to yesterday's behavior instead of bricking every photo.
 */

const UUID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Hard ceilings, per folder kind, in bytes. */
const MAX_BYTES: Record<string, number> = {
  [CLOUDINARY_FOLDERS.avatars]: 1_048_576,
  [CLOUDINARY_FOLDERS.feedPhotos]: 5_242_880,
  [CLOUDINARY_FOLDERS.viewOnce]: 5_242_880,
  [CLOUDINARY_FOLDERS.messageImages]: 5_242_880,
  [CLOUDINARY_FOLDERS.stickers]: 2_097_152,
  [CLOUDINARY_FOLDERS.chatGifs]: 5_242_880,
};

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const accessToken = authHeader.slice("Bearer ".length);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
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

    /* One signature per upload, rate-paced per user: cheap on its own, but it
       is the key to an external storage account, so it is not free-pour. */
    const guard = await consume("cloudinary-sign", `u:${user.id}`, 40, 60_000);
    if (guard) return rateLimitedResponse(guard);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Malformed request" }, { status: 400 });
    }
    const folder = typeof (body as { folder?: unknown })?.folder === "string" ? (body as { folder: string }).folder : "";

    const known = Object.values(CLOUDINARY_FOLDERS) as string[];
    const kind = known.find((prefix) => folder.startsWith(`${prefix}/`));
    if (!kind || !folder.startsWith(`${kind}/`)) {
      return NextResponse.json({ error: "Unknown upload folder." }, { status: 400 });
    }

    const rest = folder.slice(kind.length + 1);
    const owner = rest.split("/")[0] ?? "";

    const isOwn = owner === user.id;
    const isWhisperToRecipient = kind === CLOUDINARY_FOLDERS.messageImages && UUID_RE.test(owner);
    if (!isOwn && !isWhisperToRecipient) {
      return NextResponse.json({ error: "That upload folder is not yours." }, { status: 403 });
    }
    if (rest !== owner) {
      // No deeper nesting than the owner segment: paths are exactly
      // whisper/<kind>/<owner>, matching every DB ownership predicate.
      return NextResponse.json({ error: "Unknown upload folder." }, { status: 400 });
    }

    const signedParams: Record<string, string> = {
      folder,
      timestamp: String(Math.floor(Date.now() / 1000)),
      resource_type: "image",
      max_file_size: String(MAX_BYTES[kind] ?? 5_242_880),
      unique_filename: "true",
      overwrite: "false",
    };

    const signed = signUploadParams(signedParams);
    if (!signed) {
      return NextResponse.json({ error: "SIGNING_UNAVAILABLE" }, { status: 503 });
    }

    return NextResponse.json({
      cloudName: CLOUDINARY_CLOUD_NAME,
      apiKey: signed.apiKey,
      signature: signed.signature,
      ...signedParams,
    });
  } catch (err) {
    console.error("[cloudinary/sign]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
