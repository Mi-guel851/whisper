"use client";

/**
 * The sticker tab: Whisper's bundled packs plus a Recents pack, behind a
 * compact horizontally-swipeable pack strip — the modern messenger pattern,
 * with Whisper's own artwork.
 *
 * The grid is plain CSS grid + lazy images. Packs are a dozen 512px WebPs
 * apiece (~20KB each), so there is nothing here worth virtualizing; the
 * strip switches packs by state, so only one pack is in the DOM at a time.
 */

import { useState } from "react";
import { Clock } from "lucide-react";
import {
  STICKER_PACKS,
  readRecentStickers,
  type StickerDef,
} from "@/lib/chatMedia";

const RECENT_PACK = "__recent__";

export default function StickerPanel({
  onPick,
  sending,
}: {
  onPick: (sticker: StickerDef) => void;
  /** URL of the sticker currently sending, for its spinner. */
  sending: string | null;
}) {
  /* Lazy initializers: localStorage is read once on mount, client-side only —
     this component only ever renders inside the (client) picker after open. */
  const [recents] = useState<string[]>(() => readRecentStickers());
  const [activePack, setActivePack] = useState<string>(() =>
    readRecentStickers().length > 0 ? RECENT_PACK : STICKER_PACKS[0].id
  );

  const pack = STICKER_PACKS.find((p) => p.id === activePack) ?? STICKER_PACKS[0];
  const showingRecents = activePack === RECENT_PACK && recents.length > 0;

  /* Recents only remember URLs; resolve names where the URL is a bundled
     sticker so screen readers still get a label. */
  const recentDefs: StickerDef[] = recents.map((url) => {
    for (const p of STICKER_PACKS) {
      const hit = p.stickers.find((s) => s.url === url);
      if (hit) return hit;
    }
    return { id: url, url, name: "Sticker" };
  });

  const stickers = showingRecents ? recentDefs : pack.stickers;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Pack strip */}
      <div
        className="flex shrink-0 items-center gap-1 overflow-x-auto px-3 pt-2 pb-1"
        role="tablist"
        aria-label="Sticker packs"
      >
        {recents.length > 0 && (
          <button
            type="button"
            role="tab"
            aria-selected={activePack === RECENT_PACK}
            aria-label="Recent stickers"
            title="Recent"
            onClick={() => setActivePack(RECENT_PACK)}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
              activePack === RECENT_PACK ? "media-tab-active" : "opacity-55 hover:opacity-90"
            }`}
          >
            <Clock size={19} />
          </button>
        )}
        {STICKER_PACKS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={activePack === p.id}
            aria-label={`${p.name} sticker pack`}
            title={p.name}
            onClick={() => setActivePack(p.id)}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl p-1 transition ${
              activePack === p.id ? "media-tab-active" : "opacity-55 hover:opacity-90"
            }`}
          >
            <img src={p.icon} alt="" className="h-full w-full object-contain" />
          </button>
        ))}
      </div>

      <p className="chat-meta shrink-0 px-4 pb-1 text-[11px] font-bold uppercase tracking-wider">
        {showingRecents ? "Recent" : pack.name}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {stickers.map((sticker) => {
            const isSending = sending === sticker.url;
            return (
              <button
                key={sticker.id}
                type="button"
                onClick={() => onPick(sticker)}
                disabled={Boolean(sending)}
                aria-label={`Send sticker: ${sticker.name}`}
                title={sticker.name}
                className="relative aspect-square rounded-xl p-1.5 transition hover:bg-[var(--chat-icon-hover)] active:scale-90 disabled:opacity-70"
              >
                <img
                  src={sticker.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-contain"
                />
                {isSending && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
