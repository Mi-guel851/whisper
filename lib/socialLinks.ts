/**
 * Whisper's own social accounts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  DROP YOUR REAL LINKS IN THE `url` FIELDS BELOW. That is the only edit needed.
 *  Until at least one is filled in, the daily follow prompt does not appear.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything that links out to a Whisper account reads from this one array — the
 * daily follow prompt, and anything added later — so a handle only ever has to
 * change in one place.
 *
 * An entry with no URL from either source is filtered out by `activeSocialLinks()`
 * rather than rendered as a dead button. That is deliberate: a tile that opens
 * nothing is worse than a tile that isn't there, and the prompt suppresses itself
 * entirely if none of them resolve — so nothing half-built can reach a user before
 * the accounts exist. If the prompt is not showing up, this file (or the env vars
 * below) is the reason, and `activeSocialLinks` logs why in development.
 *
 * ── TWO WAYS TO SET A LINK ───────────────────────────────────────────────────
 *
 *  1. Edit the `url` fields here and redeploy. Simplest, and the URLs live in git.
 *
 *  2. Set environment variables, no code change:
 *
 *       NEXT_PUBLIC_SOCIAL_X          = https://x.com/yourhandle
 *       NEXT_PUBLIC_SOCIAL_INSTAGRAM  = https://instagram.com/yourhandle
 *       NEXT_PUBLIC_SOCIAL_FACEBOOK   = https://facebook.com/yourpage
 *       NEXT_PUBLIC_SOCIAL_TIKTOK     = https://tiktok.com/@yourhandle
 *
 *     Optional matching handles for the caption under each tile:
 *
 *       NEXT_PUBLIC_SOCIAL_X_HANDLE   = @yourhandle
 *
 *     In Vercel: Project → Settings → Environment Variables, add for Production,
 *     Preview and Development, then redeploy — `NEXT_PUBLIC_*` values are inlined
 *     at build time, so an existing deployment will not pick them up on its own.
 *
 * An env var wins over the hardcoded value, so a link can be corrected in Vercel
 * without a commit. The `NEXT_PUBLIC_` prefix is required for the browser to see
 * them, and it is safe here — these are public profile URLs, not secrets.
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

/* Read as a flat literal map rather than `process.env[\`NEXT_PUBLIC_SOCIAL_${key}\`]`,
   because Next inlines `process.env.NEXT_PUBLIC_*` by *static text substitution* at
   build time. A computed key is not substituted, so a dynamic lookup compiles to a
   read of an object that does not exist in the browser bundle and every link would
   silently resolve to undefined. */
const ENV_URLS: Partial<Record<SocialPlatform, string | undefined>> = {
  x: process.env.NEXT_PUBLIC_SOCIAL_X,
  instagram: process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM,
  facebook: process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK,
  tiktok: process.env.NEXT_PUBLIC_SOCIAL_TIKTOK,
  snapchat: process.env.NEXT_PUBLIC_SOCIAL_SNAPCHAT,
  whatsapp: process.env.NEXT_PUBLIC_SOCIAL_WHATSAPP,
};

const ENV_HANDLES: Partial<Record<SocialPlatform, string | undefined>> = {
  x: process.env.NEXT_PUBLIC_SOCIAL_X_HANDLE,
  instagram: process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM_HANDLE,
  facebook: process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK_HANDLE,
  tiktok: process.env.NEXT_PUBLIC_SOCIAL_TIKTOK_HANDLE,
  snapchat: process.env.NEXT_PUBLIC_SOCIAL_SNAPCHAT_HANDLE,
  whatsapp: process.env.NEXT_PUBLIC_SOCIAL_WHATSAPP_HANDLE,
};

/** Warned at most once, so a suppressed prompt is explained rather than silent. */
let warned = false;

/**
 * The links that are actually usable, env vars taking precedence over the array.
 *
 * `startsWith("http")` rather than a truthiness check: a handle pasted in without
 * a scheme ("instagram.com/whisper") would open as a *relative* route and dump the
 * user on a 404 inside the app, which looks like a broken app rather than a
 * mis-typed config.
 */
export function activeSocialLinks(): SocialLink[] {
  const resolved = SOCIAL_LINKS.map((link) => {
    const url = (ENV_URLS[link.platform] || link.url || "").trim();
    const handle = (ENV_HANDLES[link.platform] || link.handle || "").trim();
    return { ...link, url, handle };
  });

  /* A platform can be configured by env var alone without being listed above —
     Snapchat and WhatsApp are the cases that matters, since neither is in the
     default array. Without this, setting NEXT_PUBLIC_SOCIAL_SNAPCHAT would be
     accepted by the build and then silently ignored at runtime. Appended after the
     listed ones so the array keeps owning the display order. */
  const listed = new Set(resolved.map((link) => link.platform));
  for (const [platform, url] of Object.entries(ENV_URLS) as [SocialPlatform, string | undefined][]) {
    if (listed.has(platform) || !url) continue;
    resolved.push({
      platform,
      url: url.trim(),
      handle: (ENV_HANDLES[platform] || "").trim(),
    });
  }

  const usable = resolved.filter(
    (link) => link.url.length > 0 && link.url.startsWith("http")
  );

  if (usable.length === 0 && process.env.NODE_ENV !== "production" && !warned) {
    warned = true;
    console.info(
      "[whisper] The daily follow prompt is not showing because no social link is " +
        "configured. Fill in a `url` in lib/socialLinks.ts, or set " +
        "NEXT_PUBLIC_SOCIAL_X / _INSTAGRAM / _FACEBOOK / _TIKTOK."
    );
  }

  return usable;
}
