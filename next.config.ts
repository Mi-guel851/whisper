import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    /* The two remote sources the app actually renders: Supabase Storage (photos,
       voice-note art, uploaded avatars) and DiceBear (the deterministic fallback
       avatar in lib/generatedAvatar.ts). Both are listed so `next/image` can be
       used on them at all — without an entry it refuses the URL outright, which
       is why several lists still reach for a raw `<img>`. */
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/**" },
      { protocol: "https", hostname: "api.dicebear.com", pathname: "/**" },
    ],

    /* AVIF first, WebP as the fallback. Avatars and chat photos are the bulk of
       what a phone downloads here, and AVIF lands roughly 20-30% under WebP at
       matched quality. The encode is slower, but it happens once per size on the
       server and is cached from then on — the cost is paid by the build host,
       the saving is paid out to every mobile client on every scroll. */
    formats: ["image/avif", "image/webp"],

    /* 30 days. The generated avatars are pure functions of a user id and the
       storage objects are content-addressed, so a short TTL only means the same
       bytes get re-fetched over cellular for no reason. */
    minimumCacheTTL: 2_592_000,
  },

  experimental: {
    /* Barrel-file imports get rewritten to deep imports at build time, so
       `import { House } from "lucide-react"` pulls in one icon module instead of
       making the bundler walk the whole index. lucide-react is the significant
       one — the icon set is thousands of modules and this app imports from it in
       ~40 files. */
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },

  compiler: {
    /* Strip `console.log`/`debug`/`info` from production builds, but keep
       `error` and `warn` — those are the ones worth seeing in a field report
       from a device you don't have. Logging isn't free on mobile: each call
       serializes its arguments even with no devtools attached. */
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },

  /* Off is the default; stated explicitly because it's a recurring "why is the
     bundle so big" answer, and this app ships inside a Capacitor shell where the
     extra download is on the user. */
  productionBrowserSourceMaps: false,
};

export default nextConfig;
