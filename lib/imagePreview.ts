/**
 * Feed photo preparation.
 *
 * Two artefacts come out of one pass over a picked image:
 *
 *   `upload`  — the real photo, downscaled and re-encoded. Goes to the private
 *               `feed-photos` bucket and is only ever served through
 *               /api/feed/photo, once per viewer.
 *   `preview` — a ~32px JPEG as a data URI, inlined into the post row.
 *
 * The preview is why this file exists. A feed that shipped the full image and
 * put `filter: blur(24px)` over it would be showing everybody the photo — the
 * bytes are in the browser, and the blur is one devtools toggle away. So the
 * preview is a *separate, destroyed* copy: downscaling to 32px throws the
 * information away irreversibly before it ever leaves the device, and the blur
 * on top is presentation rather than protection.
 *
 * At 32px a data URI runs around 700–1100 bytes, so a page of ten photo
 * whispers carries roughly 10KB of preview inline and makes zero extra
 * requests for it. That matters more than it sounds on a slow Android
 * connection, where ten thumbnail round-trips is the whole cost of the feed.
 */

/** Longest edge of the stored photo. Beyond this is invisible on a phone. */
const MAX_UPLOAD_EDGE = 1600;

/** Longest edge of the blurred preview. Small enough to be unreadable. */
const MAX_PREVIEW_EDGE = 32;

/** Matches `public_feed_posts_image_preview_check`. */
const MAX_PREVIEW_CHARS = 4000;

export type PreparedFeedImage = {
  /** Bytes to upload. */
  upload: Blob;
  contentType: string;
  /** File extension for the storage key, without the dot. */
  extension: string;
  /** Blurred data-URI preview, or null if the browser could not encode one. */
  preview: string | null;
  width: number;
  height: number;
};

export class ImagePrepError extends Error {}

/**
 * Decodes a picked file into something drawable.
 *
 * `createImageBitmap` is the fast path and the only one that reliably applies
 * EXIF orientation, but it rejects formats the browser can decode in an `<img>`
 * but not off-thread — HEIC on some Android builds, most notably. Falling back
 * rather than failing is the difference between "photo attached" and "your
 * camera roll doesn't work".
 */
async function decode(file: Blob): Promise<{
  draw: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        draw: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      /* Fall through to the <img> path. */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new ImagePrepError("That image could not be read."));
      el.src = url;
    });
    return {
      draw: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** Fits `width × height` inside a square of `maxEdge`, never scaling up. */
function fit(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImagePrepError("This browser cannot process images.");
  return { canvas, ctx };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImagePrepError("Could not encode that image."))),
      type,
      quality
    );
  });
}

/**
 * The blurred preview.
 *
 * Drawn in two steps on purpose. Downscaling straight to 32px in one draw makes
 * the browser point-sample, which turns a face into a handful of hard-edged
 * blocks that read as noise rather than as a photograph. Halving through an
 * intermediate canvas averages the pixels, so the result still looks like the
 * picture it came from — which is the point of a preview.
 */
function encodePreview(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number
): string | null {
  try {
    const target = fit(sourceWidth, sourceHeight, MAX_PREVIEW_EDGE);

    let current = canvasOf(
      Math.max(target.width, Math.min(sourceWidth, MAX_UPLOAD_EDGE)),
      Math.max(target.height, Math.min(sourceHeight, MAX_UPLOAD_EDGE))
    );
    current.ctx.imageSmoothingEnabled = true;
    current.ctx.imageSmoothingQuality = "high";
    current.ctx.drawImage(source, 0, 0, current.canvas.width, current.canvas.height);

    // Halve until one more halving would undershoot the target.
    while (
      current.canvas.width > target.width * 2 &&
      current.canvas.height > target.height * 2
    ) {
      const next = canvasOf(
        Math.max(1, Math.round(current.canvas.width / 2)),
        Math.max(1, Math.round(current.canvas.height / 2))
      );
      next.ctx.imageSmoothingEnabled = true;
      next.ctx.imageSmoothingQuality = "high";
      next.ctx.drawImage(current.canvas, 0, 0, next.canvas.width, next.canvas.height);
      current = next;
    }

    const { canvas, ctx } = canvasOf(target.width, target.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    /* A touch of blur before encoding, where supported. It is not the security
       boundary — the downscale already is — it just stops JPEG from spending its
       bits on block edges that the CSS blur would smear away anyway. */
    if ("filter" in ctx) ctx.filter = "blur(1px)";
    ctx.drawImage(current.canvas, 0, 0, target.width, target.height);
    if ("filter" in ctx) ctx.filter = "none";

    const dataUri = canvas.toDataURL("image/jpeg", 0.5);
    return dataUri.length <= MAX_PREVIEW_CHARS ? dataUri : null;
  } catch {
    /* A missing preview degrades to a plain locked plate. Worth far less than
       failing the whole upload over. */
    return null;
  }
}

/**
 * Prepares a picked file for the feed.
 *
 * Animated GIFs pass through untouched when they are already small enough:
 * re-encoding one through a canvas keeps the first frame and silently throws the
 * animation away, which is worse than sending a slightly larger file.
 */
export async function prepareFeedImage(file: File): Promise<PreparedFeedImage> {
  if (!file.type.startsWith("image/")) {
    throw new ImagePrepError("That file isn't an image.");
  }

  const decoded = await decode(file);
  try {
    const { width: sourceWidth, height: sourceHeight } = decoded;
    const preview = encodePreview(decoded.draw, sourceWidth, sourceHeight);

    if (file.type === "image/gif" && file.size <= 5 * 1024 * 1024) {
      return {
        upload: file,
        contentType: "image/gif",
        extension: "gif",
        preview,
        width: sourceWidth,
        height: sourceHeight,
      };
    }

    const target = fit(sourceWidth, sourceHeight, MAX_UPLOAD_EDGE);
    const { canvas, ctx } = canvasOf(target.width, target.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    /* Photos are flattened onto black rather than left transparent: the target
       is JPEG, which has no alpha, and the default would composite to black
       anyway — doing it explicitly means a transparent PNG lands on the same
       colour as the plate behind it instead of on whatever the canvas had. */
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(decoded.draw, 0, 0, target.width, target.height);

    const upload = await toBlob(canvas, "image/jpeg", 0.82);

    return {
      upload,
      contentType: "image/jpeg",
      extension: "jpg",
      preview,
      width: target.width,
      height: target.height,
    };
  } finally {
    decoded.release();
  }
}
