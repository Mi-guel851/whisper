import { apiBase } from "./feed";
import { supabase } from "./supabase";

/**
 * Cloudinary uploads, signed by the deployment.
 *
 * WHY THERE IS A SERVER IN THE MIDDLE OF AN UPLOAD
 *
 * The unsigned preset applies the same rules to every caller and every folder.
 * A signature lets the server pin the folder, the byte ceiling, the image-only
 * resource type and no-overwrite per upload — so the abuse controls live at the
 * provider instead of "only in the client". `/api/cloudinary/sign` authenticates
 * the caller with their JWT, checks that the folder's owner segment is theirs
 * (with one deliberate exception for anonymous whispers, whose photo belongs to
 * the recipient), and answers 503 when the server itself has no signing key —
 * which is the one case where uploading with the unsigned preset is still better
 * than refusing every photo.
 *
 * Every URL produced here is what goes into the database, and the routes that
 * accept one re-check ownership against the same folder convention
 * (`cloudinary_asset_owned_by` in SQL, `cloudinaryPublicId` in the API).
 */

export const CLOUDINARY_CLOUD_NAME = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME || "w3a15ebq";
export const CLOUDINARY_UPLOAD_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET || "whisper_unsigned";

/** Folders, one per feature. Mirrors `CLOUDINARY_FOLDERS` on the server. */
export const CLOUDINARY_FOLDERS = {
  avatars: "whisper/avatars",
  messageImages: "whisper/message-images",
  feedPhotos: "whisper/feed-photos",
  viewOnce: "whisper/view-once",
  stickers: "whisper/stickers",
  chatGifs: "whisper/chat-gifs",
} as const;

export type CloudinaryFolderKind = (typeof CLOUDINARY_FOLDERS)[keyof typeof CLOUDINARY_FOLDERS];

/** 5 MB, matching `CLIENT_MAX_UPLOAD_BYTES` and the sign route's ceilings. */
export const MAX_UPLOAD_BYTES = 5_242_880;

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

export class UploadError extends Error {}

export type UploadedAsset = {
  url: string;
  publicId: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
};

export type LocalImage = {
  uri: string;
  mimeType: string;
  fileName: string;
};

/** The signed policy the server mints for one upload. */
type SignedPolicy = {
  cloudName: string;
  apiKey: string;
  signature: string;
  folder: string;
  timestamp: string;
  resource_type?: string;
  max_file_size?: string;
  unique_filename?: string;
  overwrite?: string;
};

/** Asks for a signed policy. Null means "signing is not configured here". */
async function getSignedPolicy(folder: string, accessToken: string): Promise<SignedPolicy | null> {
  try {
    const res = await fetch(`${apiBase()}/api/cloudinary/sign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ folder }),
    });

    if (res.status === 503) return null;
    if (!res.ok) return null;

    const policy = (await res.json()) as SignedPolicy;
    return policy?.signature && policy?.timestamp && policy?.folder ? policy : null;
  } catch {
    return null;
  }
}

/**
 * Uploads one image and returns its delivery URL.
 *
 * Signed when the server can sign, unsigned otherwise — the same two-step the
 * web client performs, and the only reason the unsigned path still exists.
 */
export async function uploadImage(
  image: LocalImage,
  folder: string,
  accessToken: string
): Promise<UploadedAsset> {
  if (image.mimeType && !ALLOWED_IMAGE_TYPES.has(image.mimeType)) {
    throw new UploadError("Only JPEG, PNG, WebP, GIF or AVIF images can be uploaded.");
  }

  const form = new FormData();

  /* React Native's FormData takes `{ uri, name, type }` for a file part; that
     is what triggers the native multipart encoder to stream the bytes rather
     than stringify them. */
  form.append("file", {
    uri: image.uri,
    name: image.fileName,
    type: image.mimeType,
  } as unknown as Blob);

  const policy = await getSignedPolicy(folder, accessToken);

  if (policy) {
    form.append("api_key", policy.apiKey);
    form.append("timestamp", policy.timestamp);
    form.append("signature", policy.signature);
    form.append("folder", policy.folder);
  } else {
    form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    form.append("folder", folder);
  }

  let response: Response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
      method: "POST",
      body: form,
    });
  } catch {
    throw new UploadError("Couldn't reach the image server. Check your connection.");
  }

  const payload = (await response.json().catch(() => null)) as {
    secure_url?: string;
    public_id?: string;
    format?: string;
    width?: number;
    height?: number;
    bytes?: number;
    error?: { message?: string };
  } | null;

  if (!response.ok || !payload?.secure_url) {
    const detail = typeof payload?.error?.message === "string" ? payload.error.message : null;
    throw new UploadError(
      detail && /preset/i.test(detail)
        ? "Photo uploads aren't set up on this server yet."
        : detail || "Image upload failed. Please try again."
    );
  }

  return {
    url: payload.secure_url,
    publicId: String(payload.public_id ?? ""),
    format: String(payload.format ?? ""),
    width: Number(payload.width ?? 0),
    height: Number(payload.height ?? 0),
    bytes: Number(payload.bytes ?? 0),
  };
}

/**
 * Deletes an asset the caller just uploaded but did not end up using.
 *
 * Called on every failed send. Without it, a rejected post leaves its photo in
 * the Cloudinary account forever — nobody can see it, and it still costs quota.
 */
export async function discardUpload(url: string, accessToken: string): Promise<void> {
  try {
    await fetch(`${apiBase()}/api/cloudinary/destroy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ url }),
    });
  } catch {
    /* Best-effort housekeeping: failing to clean up must never surface as a
       second error on top of the one the user is already looking at. */
  }
}

/**
 * Extracts the public id from a Cloudinary delivery URL.
 *
 * `.../<cloud>/image/upload[/<transforms>][/v<version>]/<folder>/<name>.<ext>`
 * — the public id is the folder-and-name part with the extension dropped. The
 * transform segment is optional, which is why this looks for the `v<digits>`
 * marker instead of assuming a fixed offset.
 */
export function cloudinaryPublicId(value: string | null | undefined): string | null {
  if (!value) return null;

  const uploadIndex = value.indexOf("/image/upload/");
  if (uploadIndex === -1) return null;

  let rest = value.slice(uploadIndex + "/image/upload/".length);
  if (!rest) return null;

  /* Strip a leading transform segment, if any, by finding the version marker. */
  const versionMatch = /(?:^|\/)v\d+\//.exec(rest);
  if (versionMatch) {
    rest = rest.slice(versionMatch.index + versionMatch[0].length);
  } else if (!rest.startsWith("whisper/")) {
    /* No version and not one of ours — could still be `<transforms>/whisper/...`. */
    const folderIndex = rest.indexOf("whisper/");
    if (folderIndex === -1) return null;
    rest = rest.slice(folderIndex);
  }

  const queryIndex = rest.search(/[?#]/);
  if (queryIndex !== -1) rest = rest.slice(0, queryIndex);

  const lastDot = rest.lastIndexOf(".");
  const lastSlash = rest.lastIndexOf("/");
  if (lastDot > lastSlash) rest = rest.slice(0, lastDot);

  return rest || null;
}

/** Does `url` live in this user's folder of this kind? */
export function isOwnedBy(url: string, kind: CloudinaryFolderKind, ownerId: string): boolean {
  const publicId = cloudinaryPublicId(url);
  if (!publicId) return false;
  return publicId.startsWith(`${kind}/${ownerId}/`);
}

/* ---------------------------------------------------------------------------
 * Avatars
 * ------------------------------------------------------------------------ */

/**
 * Avatar uploads go to `whisper/avatars/<uid>` and the URL is saved on the
 * profile. `profiles.avatar_url` is the only place a user-supplied image is
 * allowed to become their face — the generated DiceBear avatar is never
 * replaced by anything else.
 */
export async function uploadAvatar(image: LocalImage, userId: string, accessToken: string) {
  return uploadImage(image, `${CLOUDINARY_FOLDERS.avatars}/${userId}`, accessToken);
}

/** Persists an avatar URL onto the caller's own profile row. */
export async function saveAvatarUrl(userId: string, url: string): Promise<void> {
  const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", userId);
  if (error) throw error;
}
