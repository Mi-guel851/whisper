"use client";

/**
 * Renders a GIF or sticker inside a message.
 *
 * Stickers deliberately have no bubble — the transparent artwork *is* the
 * message, the way every modern messenger draws them; only the timestamp row
 * gets a floating chip so it stays legible over the wallpaper. GIFs keep a
 * clipped rounded frame because they are opaque rectangles.
 *
 * Two invariants hold regardless of what the row claims:
 *   - the URL must pass `isAllowedChatMediaUrl` (mirrors the DB constraint;
 *     a row that somehow bypassed it renders a quiet fallback, never an
 *     arbitrary remote fetch);
 *   - the box is sized from the stored dimensions *before* the image loads,
 *     so a slow GIF can never reflow the thread, and capped so a hostile
 *     width can never break the layout.
 */

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { isAllowedChatMediaUrl } from "@/lib/chatMedia";
import { chatGifDisplayUrl } from "@/lib/cloudinary";

const STICKER_EDGE_PX = 160;
const GIF_MAX_WIDTH_PX = 240;

export default function MediaMessage({
  url,
  kind,
  width,
  height,
}: {
  url: string;
  kind: "gif" | "sticker";
  width: number | null;
  height: number | null;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (!isAllowedChatMediaUrl(url) || failed) {
    return (
      <div className="chat-meta flex items-center gap-2 rounded-xl px-3 py-2 text-xs">
        <ImageOff size={14} />
        {kind === "sticker" ? "Sticker unavailable" : "GIF unavailable"}
      </div>
    );
  }

  const ratio = width && height ? width / height : 1;

  if (kind === "sticker") {
    const w = ratio >= 1 ? STICKER_EDGE_PX : Math.round(STICKER_EDGE_PX * ratio);
    const h = ratio >= 1 ? Math.round(STICKER_EDGE_PX / ratio) : STICKER_EDGE_PX;
    return (
      <img
        src={url}
        alt="Sticker"
        width={w}
        height={h}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        onLoad={() => setLoaded(true)}
        className={`block select-none object-contain transition-transform duration-200 ${
          loaded ? "scale-100" : "scale-90 opacity-0"
        }`}
        style={{ width: w, height: h, opacity: loaded ? 1 : 0 }}
      />
    );
  }

  const w = Math.min(GIF_MAX_WIDTH_PX, width || GIF_MAX_WIDTH_PX);
  const h = Math.round(w / (ratio || 1));

  return (
    <div
      className="relative overflow-hidden rounded-xl bg-[var(--chat-field)]"
      style={{ width: w, height: h }}
    >
      {!loaded && <div className="skeleton absolute inset-0" aria-hidden />}
      <img
        src={chatGifDisplayUrl(url)}
        alt="GIF"
        width={w}
        height={h}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        onLoad={() => setLoaded(true)}
        className="block h-full w-full select-none object-cover"
      />
    </div>
  );
}
