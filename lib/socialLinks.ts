import type { SocialPlatform } from "@/components/SocialIcon";

export type SocialLink = {
  platform: SocialPlatform;
  url: string;
  handle: string;
};

export const SOCIAL_LINKS: SocialLink[] = [
  {
    platform: "x",
    url: "https://x.com/Whi_sper__",
    handle: "@Whi_sper__",
  },
  {
    platform: "instagram",
    url: "https://www.instagram.com/whi_sper__?igsi=cTdjOGZ3ZjBycnR4",
    handle: "@whi_sper__",
  },
  {
    platform: "facebook",
    url: "https://www.facebook.com/profile.php?id=61593168031689",
    handle: "Whisper",
  },
  {
    platform: "tiktok",
    url: "https://tiktok.com",
    handle: "",
  },
];

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

let warned = false;

export function activeSocialLinks(): SocialLink[] {
  const resolved = SOCIAL_LINKS.map((link) => {
    const url = (ENV_URLS[link.platform] || link.url || "").trim();
    const handle = (ENV_HANDLES[link.platform] || link.handle || "").trim();
    return { ...link, url, handle };
  });

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