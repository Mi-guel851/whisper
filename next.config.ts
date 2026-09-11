import type { NextConfig } from "next";

/* ------------------------------------------------------------------------- *
 * FRAMING, IN PRODUCTION AND IN THE SANDBOX
 *
 * The rule this protects is unchanged: production never renders as a frame, so
 * the unlock-payment and settings surfaces cannot be clickjacked. Nothing about
 * the shipped site's headers moved.
 *
 * A `next dev` preview, though, is *always* shown inside a frame (the sandbox
 * shell frames the dev server), so an unconditional `DENY` makes every preview
 * blank — the app refuses to paint and the only feedback is a CSP report. The
 * two header values are therefore selected by build mode: the strict pair in
 * production, an ancestor-restricted pair in development.
 *
 * The development value is still not "allow anything": only this origin and the
 * sandbox hosts can frame the page, and `X-Frame-Options` is dropped there only
 * because the header cannot express an allowlist (CSP `frame-ancestors`, which
 * every browser that matters obeys, carries the restriction instead).
 * ------------------------------------------------------------------------- */
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const FRAME_ANCESTORS = IS_PRODUCTION
  ? "frame-ancestors 'none'"
  : "frame-ancestors 'self' https://*.e2b.app https://*.arena.site";

/* Kept as one literal so the production policy stays greppable — and so the
   security suite's assertion keeps testing the shipped value, not a branch. */
const BASE_CSP = `${FRAME_ANCESTORS}; object-src 'none'; base-uri 'self'; form-action 'self'`;

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

  /* ------------------------------------------------------------------------- *
   * SECURITY HEADERS (production audit 2026-09). The app previously shipped no
   * response headers at all — clickjacking, MIME sniffing, referrer leakage and
   * permissions were all default-open on every page.
   *
   * Deliberately CONSERVATIVE: no script/style CSP, because the app loads
   * third-party code that is not statically enumerable (Paystack inline.js
   * injects its own checkout frame, Next injects dev/runtime scripts, the
   * service worker has its own fetch surface) and a half-measure CSP that
   * operators have to disable at the first incident is worse than none. What IS
   * here can be switched on with a clear conscience and later tightened toward
   * a full CSP once the inline-script surface is measured on staging.
   * ------------------------------------------------------------------------- */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Never render as a frame in production — blocks clickjacking of the
          // unlock-payment and settings surfaces. The app is not framed by
          // anything legitimate (Paystack embeds ITS page, not ours); the dev
          // server is, which is what FRAME_ANCESTORS above exists for.
          ...(IS_PRODUCTION
            ? [{ key: "X-Frame-Options", value: "DENY" }]
            : []),
          { key: "Content-Security-Policy", value: BASE_CSP },
          // Stop the browser from re-typing mislabeled responses (classic
          // upload-response XSS vector).
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Send only the origin on cross-site referrals — the app's URLs
          // carry usernames (/u/<handle>) that should not leak to ad networks.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // HSTS: the app is https-only on Vercel; two years + subdomains +
          // preload makes an on-path downgrade to http impossible.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          /* Feature carve-outs, kept as tight as the features allow:
             microphone stays for the voice-note recorder's getUserMedia;
             camera/geolocation/payment/usb/serial are not used by the web app
             at all (image picking goes through the OS file picker, which this
             does not affect), so they are hard-disabled for every origin. */
          {
            key: "Permissions-Policy",
            value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=(), serial=(), display-capture=(), document-domain=()",
          },
          /* COOP keeps other origins from holding a window reference into our
             pages; `same-origin-allow-popups` because sign-in and Paystack
             flows may open popups that legitimately keep opener handles. */
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      /* /og/u/* is an <img> src consumed by Twitter/WhatsApp scrapers and any
         other site — CORP same-origin there would block the very clients the
         route exists for, so that one header is relaxed for that path. */
      {
        source: "/og/u/:path*",
        headers: [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }],
      },
    ];
  },
};

export default nextConfig;
