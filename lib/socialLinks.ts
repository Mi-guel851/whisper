/**
 * Whisper's own social accounts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  DROP YOUR REAL LINKS IN THE `url` FIELDS BELOW. That is the only edit needed.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything that links out to a Whisper account reads from this one array — the
 * daily follow prompt, and anything added later — so a handle only ever has to
 * change in one place.
 *
 * An entry whose `url` is still empty is filtered out by `activeSocialLinks()`
 * rather than rendered as a dead button. That is deliberate: a tile that opens
 * nothing is worse than a tile that isn't there, and the prompt suppresses itself
 * entirely if none of them are filled in — so nothing half-built can reach a user
 * before the accounts exist.
 *
 * Handles are shown to the user under each tile, so keep them in step with the
 * URLs. Leave `handle` empty and the tile just shows the platform name.
 */

import type { SocialPlatform } from "@/components/SocialIcon";

export type SocialLink = {
  platform: SocialPlatform;
  /** Full absolute URL, e.g. "https://instagram.com/whisperapp". Empty = hidden. */
  url: string;
  /** Displayed under the tile, e.g. "@whisperapp". Optional. */
  handle: string;
};

export const SOCIAL_LINKS: SocialLink[] = [
  {
    platform: "x",
    // ↓ your X / Twitter profile
    url: "",
    handle: "",
  },
  {
    platform: "instagram",
    // ↓ your Instagram profile
    url: "",
    handle: "",
  },
  {
    platform: "facebook",
    // ↓ your Facebook page
    url: "",
    handle: "",
  },
  {
    platform: "tiktok",
    // ↓ optional — remove this entry if Whisper has no TikTok
    url: "",
    handle: "",
  },
];

/**
 * The links that are actually usable.
 *
 * `startsWith("http")` rather than a truthiness check: a handle pasted in without
 * a scheme ("instagram.com/whisper") would open as a *relative* route and dump the
 * user on a 404 inside the app, which looks like a broken app rather than a
 * mis-typed config.
 */
export function activeSocialLinks(): SocialLink[] {
  return SOCIAL_LINKS.filter(
    (link) => link.url.trim().length > 0 && link.url.trim().startsWith("http")
  );
}
