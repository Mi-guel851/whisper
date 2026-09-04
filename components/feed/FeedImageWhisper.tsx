"use client";

import { memo } from "react";
import { Eye, EyeOff, ImageOff, Loader2 } from "lucide-react";
import { vibrate, HAPTIC } from "@/lib/haptics";
import type { FeedImageState } from "./types";

/**
 * A photo whisper before it has been opened — as a small chip, not a casement.
 *
 * WHAT IS ACTUALLY ON SCREEN, AND WHY IT IS SAFE
 *
 * The thumbnail renders `image_preview` — a ~32px JPEG encoded on the poster's
 * device and stored inline on the row. It is *not* the photo with a blur over
 * it. That distinction is the entire security model: a CSS blur is presentation
 * and one devtools toggle away from being removed, so a feed that shipped the
 * full image and blurred it would be showing everybody the photo. Downscaling
 * to 32px destroys the information before it ever leaves the device, which
 * cannot be undone by anyone at any layer.
 *
 * The blur here is therefore cosmetic — it hides the soft interpolation edges of
 * a 32px image stretched across a thumbnail, so the chip reads as a photograph
 * out of focus rather than as a grid of coloured squares.
 *
 * WHY A CHIP RATHER THAN A FULL-WIDTH PLATE
 *
 * The plate treated a locked photo as the post's main event, and it isn't one —
 * most viewers will never spend the look, so the row was paying full-media
 * height for something that stays shut. A chip says what the plate said —
 * there is a photo here, it opens once — at the height of a line of text, which
 * is what X does for a link or a quote and what keeps a timeline scannable.
 * The fullscreen viewer still opens at the photo's true shape; the chip just
 * stops promising that scale up front.
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

  const title = gone
    ? "Photo unavailable"
    : spent
      ? "Photo viewed"
      : busy
        ? "Opening…"
        : isAuthor
          ? "Your view-once photo"
          : "View-once photo";

  /* The rule of the feed — one look, then it's gone — travels with the chip as
     its second line, so the promise is read before the tap, not after. */
  const subtitle = gone
    ? "It expired or was removed"
    : spent
      ? "One look is all it gets"
      : busy
        ? "Hold on"
        : isAuthor
          ? "Tap to view it"
          : "Tap to open — it won’t come back";

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
        aria-label={`${title} — ${subtitle}`}
        className={`feed-photo-chip ${spent || gone ? "is-spent" : ""}`}
      >
        <span className="feed-photo-chip-thumb">
          {preview ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={preview}
              alt=""
              aria-hidden
              /* The preview is inline data, so there is nothing to lazy-load and
                 nothing to fetch — it decodes off the main thread instead. */
              decoding="async"
              className="feed-photo-chip-img"
            />
          ) : (
            /* No preview encoded — an older post, or a browser whose canvas
               refused. The gradient carries the thumbnail's shape on its own. */
            <span aria-hidden className="feed-photo-chip-fallback" />
          )}
          <span className="feed-photo-chip-ring" aria-hidden>
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Glyph size={14} strokeWidth={2.2} />
            )}
          </span>
        </span>

        <span className="feed-photo-chip-text">
          <span className="feed-photo-chip-title">{title}</span>
          <span className="feed-photo-chip-sub">{subtitle}</span>
        </span>
      </button>
    </div>
  );
}

export const FeedImageWhisper = memo(FeedImageWhisperBase);
export default FeedImageWhisper;
