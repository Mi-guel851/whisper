/**
 * Cloudinary image storage.
 *
 * Every image in Whisper — avatars, anonymous whisper photos, feed photos and
 * chat view-once photos — is uploaded from the browser straight to Cloudinary
 * through this module. Voice notes are *not* here: audio stays in the Supabase
 * `voice-messages` bucket, and the routes that serve it are untouched.
 *
 * This file is client-safe by construction. It reads only `NEXT_PUBLIC_*`
 * variables and the unsigned upload preset, so importing it into a component
 * cannot leak `CLOUDINARY_API_SECRET`. Anything that needs the secret — deleting
 * an asset, in particular — lives in `lib/cloudinary.server.ts` and is only ever
 * imported by API routes.
 *
 * Folder convention: `whisper/<kind>/<owner-id>/<random>`. The owner segment is
 * load-bearing, not decoration — it is what `/api/cloudinary/destroy` checks
 * before it will delete anything, the same way the old storage policies checked
 * `split_part(name, '/', 1) = auth.uid()`. Keep it as the last folder segment.
 */

/** Hardcoded fallback so a missing env var degrades to the right cloud. */
export const CLOUDINARY_CLOUD_NAME =
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || "w3a15ebq";

export const CLOUDINARY_UPLOAD_PRESET =
  process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || "whisper_unsigned";

/** Folders, one per feature. Mirrors what the Supabase buckets used to be. */
export const CLOUDINARY_FOLDERS = {
  avatars: "whisper/avatars",
  messageImages: "whisper/message-images",
  feedPhotos: "whisper/feed-photos",
  viewOnce: "whisper/view-once",
} as const;

export type CloudinaryFolderKind =
  (typeof CLOUDINARY_FOLDERS)[keyof typeof CLOUDINARY_FOLDERS];

export class CloudinaryUploadError extends Error {}

export type CloudinaryUpload = {
  /** `secure_url` — the https delivery URL. This is what goes in the database. */
  url: string;
  /** Identifier the Admin API needs to delete the asset. */
  publicId: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
};

/**
 * Uploads one image and returns its delivery URL.
 *
 * Unsigned, straight from the browser to Cloudinary — the bytes never transit a
 * Vercel function, which is the same shape the Supabase Storage uploads had and
 * the reason a 5MB photo on a phone doesn't burn function time.
 *
 * `Blob` is accepted alongside `File` because `prepareFeedImage` hands back a
 * canvas-encoded Blob rather than the original File. Cloudinary derives the
 * format from the bytes, so a nameless Blob uploads fine; the third argument
 * only exists to give it a nicer `original_filename`.
 */
export async function uploadToCloudinary(
  file: File | Blob,
  folder?: string,
  filename?: string
): Promise<CloudinaryUpload> {
  const form = new FormData();
  const name = filename || (file instanceof File ? file.name : "upload");
  form.append("file", file, name);
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  if (folder) form.append("folder", folder);

  let response: Response;
  try {
    response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
      { method: "POST", body: form }
    );
  } catch {
    /* Offline, or the request was cut off mid-body. Worth its own message: the
       generic Cloudinary error text below would read as a rejection. */
    throw new CloudinaryUploadError("Couldn't reach the image server. Check your connection.");
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.secure_url) {
    const detail =
      typeof payload?.error?.message === "string" ? payload.error.message : null;
    throw new CloudinaryUploadError(
      /* The one misconfiguration worth naming, because it is the only failure
         here that a user retrying cannot fix. */
      detail && /preset/i.test(detail)
        ? "Photo uploads aren't set up on this server yet."
        : detail || "Image upload failed. Please try again."
    );
  }

  return {
    url: payload.secure_url as string,
    publicId: payload.public_id as string,
    format: String(payload.format ?? ""),
    width: Number(payload.width ?? 0),
    height: Number(payload.height ?? 0),
    bytes: Number(payload.bytes ?? 0),
  };
}

/**
 * True for a delivery URL from *our* cloud.
 *
 * Used everywhere a stored value has to be classified: rows written before this
 * migration hold a Supabase object key, rows written after hold a Cloudinary
 * URL, and both have to keep working. The cloud-name check is the security half
 * — a server route that fetches whatever URL a column happens to contain is an
 * SSRF, so the host and the cloud are both pinned.
 */
export function isCloudinaryUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "res.cloudinary.com" &&
      url.pathname.startsWith(`/${CLOUDINARY_CLOUD_NAME}/`)
    );
  } catch {
    return false;
  }
}

/**
 * Recovers the `public_id` from a delivery URL.
 *
 * Nothing stores the public id separately — the database columns hold the URL —
 * so deletion has to read it back out. The shape is
 * `/<cloud>/image/upload[/<transforms>][/v<version>]/<folder>/<name>.<ext>`,
 * and the public id is the folder-and-name part with the extension dropped.
 *
 * Returns null rather than a guess for anything that isn't one of our URLs;
 * every caller treats null as "don't delete".
 */
export function cloudinaryPublicId(value: string | null | undefined): string | null {
  if (!isCloudinaryUrl(value)) return null;

  const segments = new URL(value as string).pathname.split("/").filter(Boolean);
  const uploadAt = segments.indexOf("upload");
  if (uploadAt === -1) return null;

  let rest = segments.slice(uploadAt + 1);

  /* Transformation segments, if the URL was built for rendering rather than read
     straight from an upload response. They are `w_400,c_fill` style — a leading
     two-or-three letter key and an underscore. Our folder names ("whisper") do
     not match that, so this cannot eat a real path segment. */
  while (rest.length > 1 && /^[a-z]{1,3}_[^/]*$/.test(rest[0])) rest = rest.slice(1);

  // `v1712345678` — a version pin, not part of the id.
  if (rest.length > 1 && /^v\d+$/.test(rest[0])) rest = rest.slice(1);
  if (rest.length === 0) return null;

  const joined = rest.join("/");
  const dot = joined.lastIndexOf(".");
  const slash = joined.lastIndexOf("/");
  // Only strip a real extension — a dot inside a folder name is not one.
  return dot > slash ? joined.slice(0, dot) : joined;
}

/**
 * Throws away an upload the caller has just made.
 *
 * The rollback half of every "upload, then do the risky thing" flow: a photo is
 * in Cloudinary before the coins are spent or the row is inserted, so a failure
 * after that point has to take the asset with it or it becomes an orphan nobody
 * will ever collect. Deleting needs the API secret, so this goes through
 * `/api/cloudinary/destroy` rather than talking to Cloudinary directly.
 *
 * Deliberately never throws. Every caller is already on a failure path with a
 * message to show the user, and "the rollback also failed" is a log line, not a
 * second toast.
 */
export async function discardCloudinaryUpload(
  url: string | null | undefined,
  accessToken: string | null | undefined
): Promise<void> {
  if (!isCloudinaryUrl(url) || !accessToken) return;
  try {
    await fetch("/api/cloudinary/destroy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ url }),
    });
  } catch (error) {
    console.warn("[cloudinary] could not discard an orphaned upload:", error);
  }
}
