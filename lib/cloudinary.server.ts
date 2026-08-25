/**
 * Server-only Cloudinary operations.
 *
 * Split from `lib/cloudinary.ts` because everything in here needs
 * `CLOUDINARY_API_SECRET`. Importing this file from a client component would put
 * the secret in the browser bundle, so it is imported by API routes only. The
 * `node:crypto` import is the accidental guardrail — a "use client" module that
 * reached for this file fails to bundle rather than shipping the secret — but it
 * is a side effect, not a guarantee. Do not import this from a component.
 */

import { createHash } from "node:crypto";
import { CLOUDINARY_CLOUD_NAME, cloudinaryPublicId, isCloudinaryUrl } from "@/lib/cloudinary";

function credentials() {
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

/**
 * Signs an Admin API call.
 *
 * Cloudinary's scheme: the parameters that matter, sorted by key, joined
 * `k=v&k=v`, with the API secret appended, hashed SHA-1.
 */
function sign(params: Record<string, string>, apiSecret: string): string {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1").update(`${canonical}${apiSecret}`).digest("hex");
}

/**
 * Deletes one image, permanently.
 *
 * This is what makes view-once actually once. A Cloudinary delivery URL has no
 * ACL behind it — where the old `view-once-photos` bucket was private and only
 * the service role could read it, here the guarantee is that the asset stops
 * existing the moment it is opened. So this call is not cleanup, it is the
 * feature, and the routes that serve a view-once image treat a failure here as
 * a reason not to hand the bytes over.
 *
 * `invalidate` asks the CDN to drop its cached copies too. Without it an edge
 * node can keep serving a deleted asset to anyone who already has the URL.
 *
 * Idempotent: Cloudinary answers `result: "not found"` for an id that is already
 * gone, which is reported as success — a second view of an already-destroyed
 * photo should not read as a server error.
 */
export async function destroyCloudinaryImage(
  publicId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const creds = credentials();
  if (!creds) {
    console.error("[cloudinary] CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET are not set.");
    return { ok: false, reason: "Image server not configured" };
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const signed = { public_id: publicId, timestamp, invalidate: "true" };

  const form = new FormData();
  for (const [key, value] of Object.entries(signed)) form.append(key, value);
  form.append("api_key", creds.apiKey);
  form.append("signature", sign(signed, creds.apiSecret));

  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/destroy`,
      { method: "POST", body: form }
    );
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const detail =
        typeof payload?.error?.message === "string" ? payload.error.message : "destroy failed";
      console.error("[cloudinary] destroy failed:", detail);
      return { ok: false, reason: detail };
    }

    if (payload?.result === "ok" || payload?.result === "not found") return { ok: true };

    console.error("[cloudinary] destroy returned:", payload?.result);
    return { ok: false, reason: String(payload?.result ?? "destroy failed") };
  } catch (error) {
    console.error("[cloudinary] destroy error:", error);
    return { ok: false, reason: "Could not reach the image server" };
  }
}

/** `destroyCloudinaryImage`, addressed by delivery URL. Non-Cloudinary values are ignored. */
export async function destroyCloudinaryUrl(
  url: string | null | undefined
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const publicId = cloudinaryPublicId(url);
  if (!publicId) return { ok: false, reason: "Not a Cloudinary URL" };
  return destroyCloudinaryImage(publicId);
}

/**
 * Pulls the bytes of a stored image back to the server.
 *
 * The view-once routes proxy every image rather than redirecting to it, so that
 * the URL itself never reaches a browser — a redirect would put a permanently
 * fetchable address in the network panel, which is the whole thing these routes
 * exist to prevent.
 *
 * `isCloudinaryUrl` is re-checked here even though callers have already
 * classified the value: this function fetches a URL that came out of a database
 * column, and pinning the host is what keeps that from being an SSRF.
 */
export async function fetchCloudinaryImage(
  url: string
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  if (!isCloudinaryUrl(url)) {
    console.error("[cloudinary] refused to fetch a non-Cloudinary URL");
    return null;
  }

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      console.error("[cloudinary] image fetch failed:", response.status);
      return null;
    }
    return {
      bytes: await response.arrayBuffer(),
      contentType: response.headers.get("content-type") || "image/jpeg",
    };
  } catch (error) {
    console.error("[cloudinary] image fetch error:", error);
    return null;
  }
}

/**
 * Confirms an asset exists, without downloading it.
 *
 * Replaces the `storage.list()` existence check the feed-post route used to do:
 * a post that references a missing image renders as a locked plate that never
 * opens, and the author has been charged coins for it.
 */
export async function cloudinaryImageExists(url: string): Promise<boolean> {
  if (!isCloudinaryUrl(url)) return false;
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}
