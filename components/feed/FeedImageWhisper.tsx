"use client";

import { memo } from "react";
import { Eye, EyeOff, ImageOff, Loader2 } from "lucide-react";
import { vibrate, HAPTIC } from "@/lib/haptics";
import type { FeedImageState } from "./types";

/**
 * A photo whisper before it has been opened.
 *
 * WHAT IS ACTUALLY ON SCREEN, AND WHY IT IS SAFE
 *
 * The plate renders `image_preview` — a ~32px JPEG encoded on the poster's
 * device and stored inline on the row. It is *not* the photo with a blur over
 * it. That distinction is the entire security model: a CSS blur is presentation
 * and one devtools toggle away from being removed, so a feed that shipped the
 * full image and blurred it would be showing everybody the photo. Downscaling to
 * 32px destroys the information before it ever leaves the device, which cannot
 * be undone by anyone at any layer.
 *
 * The blur here is therefore cosmetic — it hides the soft interpolation edges of
 * a 32px image stretched across a phone, so the plate reads as a photograph out
 * of focus rather than as a grid of coloured squares.
 *
 * The `<img>` carries the preview's own aspect ratio, so the plate is the shape
 * of the real photo. That matters more than it sounds: a fixed-ratio box means
 * the timeline visibly jumps when the fullscreen viewer opens at the true shape.
 */

type FeedImageWhisperProps = {
  preview: string | null | undefined;
  state: FeedImageState;
  /** The author keeps access to their own photo; no receipt is written for them. */
  isAuthor: boolean;
  onOpen: () => void;
};

function FeedImageWhisperBase({ preview, state, isAuthor, onOpen }: FeedImageWhisperProps) {
  const spent = state === "spent";
  const gone = state === "unavailable";
  const busy = state === "loading";
  const openable = !spent && !gone && !busy;

  const label = gone
    ? "Photo unavailable"
    : spent
      ? "Photo viewed"
      : busy
        ? "Opening"
        : isAuthor
          ? "Your photo — tap to view"
          : "Tap to view once";

  const Glyph = gone ? ImageOff : spent ? EyeOff : Eye;

  return (
    <div className="feed-photo-frame mt-2.5">
      <button
        type="button"
        onClick={() => {
          if (!openable) return;
          vibrate(HAPTIC.select);
          onOpen();
        }}
        disabled={!openable}
        aria-label={label}
        className={`feed-photo-plate ${spent || gone ? "is-spent" : ""}`}
      >
        {preview ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={preview}
            alt=""
            aria-hidden
            /* The preview is inline data, so there is nothing to lazy-load and
               nothing to fetch — it decodes off the main thread instead. */
            decoding="async"
            className="feed-photo-preview"
          />
        ) : (
          /* No preview encoded — an older post, or a browser whose canvas
             refused. The gradient plate carries the shape on its own, the same
             way the chat bubble does when there is nothing to blur. */
          <span aria-hidden className="feed-photo-fallback" />
        )}

        <span className="feed-photo-veil" aria-hidden />

        <span className="feed-photo-badge">
          <span className="feed-photo-ring">
            {busy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Glyph size={16} strokeWidth={2.2} />
            )}
          </span>
          <span className="feed-photo-label">{label}</span>
        </span>
      </button>

      {/* Stated once, under the plate, rather than inside it. Inside, over a
          photograph, it competes with the image; here it reads as a rule of the
          feed — which is what it is. */}
      {openable && !isAuthor && (
        <p className="feed-photo-note">Opens once. It won&apos;t come back.</p>
      )}
    </div>
  );
}

export const FeedImageWhisper = memo(FeedImageWhisperBase);
export default FeedImageWhisper;
