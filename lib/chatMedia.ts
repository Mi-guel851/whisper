/**
 * Chat media: GIF + sticker messages, sticker packs, and the recents that make
 * the picker feel personal.
 *
 * A GIF or sticker message is an ordinary `direct_messages` row with
 * `media_url` + `media_kind` set — same insert path, same RLS, same realtime
 * channel as text. This module owns the *client-side* half of the trust
 * boundary: `isAllowedChatMediaUrl` mirrors the database CHECK constraint in
 * `202609060002_chat_media_and_stickers.sql`, so even if a row somehow arrived
 * with a hostile URL, the bubble refuses to render it. Keep the two lists in
 * step.
 */

import { CLOUDINARY_CLOUD_NAME } from "@/lib/cloudinary";

export type ChatMediaKind = "gif" | "sticker";

/** Where a rendered media URL may point. Mirrors the DB constraint. */
export function isAllowedChatMediaUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  // Bundled sticker packs ship with the app itself.
  if (/^\/stickers\/[a-zA-Z0-9/._-]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.hostname === "res.cloudinary.com") {
      return url.pathname.startsWith(`/${CLOUDINARY_CLOUD_NAME}/`);
    }
    if (url.hostname === "media.tenor.com") return true;
    if (/^media\d*\.giphy\.com$/.test(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

/* ── Bundled sticker packs ─────────────────────────────────────────────────
   Whisper's own artwork (generated for the app — nothing copied from any
   other messenger). 512×512 transparent WebP, ~15-25KB each, served from
   /public so they cost one cache-friendly request apiece and work offline
   in the Capacitor shell. */

export type StickerDef = {
  /** Stable id, used for the recents list. */
  id: string;
  url: string;
  name: string;
};

export type StickerPack = {
  id: string;
  name: string;
  /** The sticker that fronts the pack in the pack strip. */
  icon: string;
  stickers: StickerDef[];
};

function pack(id: string, name: string, names: [file: string, label: string][]): StickerPack {
  const stickers = names.map(([file, label]) => ({
    id: `${id}/${file}`,
    url: `/stickers/${id}/${file}.webp`,
    name: label,
  }));
  return { id, name, icon: stickers[0].url, stickers };
}

export const STICKER_PACKS: StickerPack[] = [
  pack("whisp", "Whisp Moods", [
    ["joy", "Crying with laughter"],
    ["love", "Heart eyes"],
    ["cry", "Crying"],
    ["sad", "Sad"],
    ["thumbs", "Thumbs up"],
    ["angry", "Fuming"],
    ["sleep", "Sleepy"],
    ["huh", "Confused"],
    ["party", "Party time"],
    ["wow", "Shocked"],
    ["happy", "Happy"],
    ["cool", "Too cool"],
  ]),
  pack("vibes", "Whisp Vibes", [
    ["heart", "Big hug heart"],
    ["hello", "Hello there"],
    ["think", "Hmm, thinking"],
    ["facepalm", "Facepalm"],
    ["kiss", "Blowing a kiss"],
    ["trophy", "Champion"],
    ["shy", "Shy"],
    ["fire", "On fire"],
    ["letter", "Love letter"],
  ]),
  pack("moods2", "Whisp Feelings", [
    ["cheer", "Cheering"],
    ["laugh", "LOL"],
    ["wink", "Wink"],
    ["loveyou", "Sending love"],
    ["embarrassed", "Embarrassed"],
    ["shocked", "Shocked"],
    ["yay", "Yay!"],
    ["smug", "Smug"],
  ]),
];

/** Bundled stickers are square 512s; senders record this on the row. */
export const BUNDLED_STICKER_SIZE = 512;

/* ── Recents ───────────────────────────────────────────────────────────────
   Plain localStorage, capped, newest first. Deliberately not synced to the
   server: recents are a typing-speed feature, not data, and a network read
   in front of the emoji grid would defeat the point. */

function readRecents(key: string, cap: number): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string").slice(0, cap) : [];
  } catch {
    return [];
  }
}

function pushRecent(key: string, value: string, cap: number): string[] {
  const next = [value, ...readRecents(key, cap).filter((v) => v !== value)].slice(0, cap);
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* Quota/private mode — recents are a nicety, not a requirement. */
  }
  return next;
}

const RECENT_EMOJI_KEY = "whisper.recentEmojis";
const RECENT_STICKER_KEY = "whisper.recentStickers";

export const readRecentEmojis = () => readRecents(RECENT_EMOJI_KEY, 40);
export const pushRecentEmoji = (emoji: string) => pushRecent(RECENT_EMOJI_KEY, emoji, 40);

/** Recent stickers store the sticker URL — enough to render and re-send. */
export const readRecentStickers = () => readRecents(RECENT_STICKER_KEY, 24);
export const pushRecentSticker = (url: string) => pushRecent(RECENT_STICKER_KEY, url, 24);

/* ── GIF (send-only removed) ────────────────────────────────────────────
   The GIF tab was removed from the picker because this deployment has no
   Tenor / Giphy API key. Existing GIF messages still render (the rows carry
   `media_kind: "gif"` and `isAllowedChatMediaUrl` still admits the provider
   hosts for playback); only *searching and sending new* GIFs is gone. */
