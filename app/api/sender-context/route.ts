import { NextRequest, NextResponse } from "next/server";

import {
  DEVICE_SEPARATOR,
  describeUserAgent,
  type SenderContext,
} from "@/lib/senderContext";

/**
 * What the edge can see about whoever is opening an anonymous whisper link.
 *
 * This is the server half of the paid Hint. See `lib/senderContext.ts` for why
 * the location is read here instead of from a third-party IP service in the
 * browser; in short: the platform already knows, it costs no extra network hop,
 * and a client cannot forge it.
 *
 * The response is intentionally boring — four coarse strings, no IP, no
 * coordinates, no raw user-agent. Nothing here is stored by this route; the
 * caller writes it onto the message row only if the visitor actually sends one.
 */

/* Headers are per-request by definition, so this must never be prerendered or
   cached. Without `force-dynamic` Next is entitled to evaluate this once at build
   time and serve one visitor's city to every visitor after them. */
export const dynamic = "force-dynamic";

/* Node rather than edge, deliberately. The route only reads headers so it *could*
   run at the edge, but `countryName` below depends on `Intl.DisplayNames` having
   full ICU region data — guaranteed on Node 18+, not something to bet a
   user-visible country name on in a V8-isolate runtime. Nothing is lost: the
   client starts this request on mount and has the answer long before send, so the
   few milliseconds edge would save are milliseconds nobody is waiting on. Vercel
   attaches the `x-vercel-ip-*` headers at the edge before invoking the function,
   so they are all present here. */
export const runtime = "nodejs";

/**
 * ISO-3166-1 alpha-2 → country name.
 *
 * `Intl.DisplayNames` is the whole implementation: the alternative is shipping a
 * 250-row lookup table that goes stale. It throws on a malformed code rather than
 * returning undefined, hence the try. It also echoes the input back when it has
 * no name for a code, which would put "ZZ" in front of a paying user, so that
 * case is filtered out too.
 */
function countryName(code: string | null): string | null {
  if (!code || code.length !== 2) return null;
  const upper = code.toUpperCase();
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(upper);
    return name && name !== upper ? name : null;
  } catch {
    return null;
  }
}

/**
 * Vercel percent-encodes `x-vercel-ip-city`, so "Port Harcourt" arrives as
 * "Port%20Harcourt". Decoding can throw on a malformed sequence, and a throw here
 * would fail the whole request over a cosmetic field.
 */
function decodeHeader(value: string | null): string | null {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    const raw = value.trim();
    return raw.length > 0 ? raw : null;
  }
}

/**
 * The browser, from Chromium's client hints rather than from UA sniffing.
 *
 * `sec-ch-ua` is a structured brand list and is accurate where the user-agent
 * string is a historical fiction — Edge, Opera and Samsung Internet all claim to
 * be Chrome in their UA and all three declare themselves honestly here. Two
 * things have to be filtered:
 *
 *   - GREASE entries. Chromium deliberately injects a garbage brand such as
 *     `"Not/A)Brand";v="8"` to stop servers hard-coding the list. It varies per
 *     release and must never be shown to a user.
 *   - "Chromium" itself, which every Chromium browser reports alongside its real
 *     brand, so preferring it would report Edge as Chromium.
 *
 * Returns null on any non-Chromium browser (Safari and Firefox do not send this),
 * which is the signal for the caller to fall back to the shared UA parser.
 */
function browserFromClientHints(header: string | null): string | null {
  if (!header) return null;

  const brands = header
    .split(",")
    .map((part) => part.trim().match(/^"(.*?)"/)?.[1]?.trim())
    .filter((brand): brand is string => Boolean(brand))
    .filter((brand) => !/not.?a.?brand/i.test(brand));

  const named = brands.find((brand) => !/^chromium$/i.test(brand));
  const brand = named || brands.find((brand) => /^chromium$/i.test(brand));
  if (!brand) return null;

  /* Normalised to the same names the UA parser produces, so the two code paths
     can never disagree about what to call the same browser. */
  if (/microsoft edge/i.test(brand)) return "Edge";
  if (/samsung/i.test(brand)) return "Samsung Internet";
  if (/opera/i.test(brand)) return "Opera";
  if (/brave/i.test(brand)) return "Brave";
  if (/^google chrome$/i.test(brand)) return "Chrome";
  return brand;
}

/**
 * The device family, from `sec-ch-ua-platform` plus `sec-ch-ua-mobile`.
 *
 * Both are low-entropy hints sent by default, so no permission dance and no
 * `Accept-CH` round trip is needed. The platform alone cannot tell an Android
 * phone from an Android tablet — that is what the mobile hint is for.
 */
function deviceFromClientHints(
  platformHeader: string | null,
  mobileHeader: string | null
): string | null {
  const platform = platformHeader?.replace(/"/g, "").trim();
  if (!platform || platform === "Unknown") return null;

  /* The hint is the boolean `?1` / `?0` of RFC 8941, not the string "true". */
  const mobile = mobileHeader?.includes("?1") ?? false;

  if (/^Android$/i.test(platform)) return mobile ? "Android phone" : "Android tablet";
  if (/^Windows$/i.test(platform)) return "Windows PC";
  if (/^macOS$/i.test(platform)) return "Mac computer";
  if (/^Chrome OS$/i.test(platform) || /^Chromium OS$/i.test(platform)) return "Chromebook";
  if (/^Linux$/i.test(platform)) return "Linux device";
  /* iOS is here for completeness. Safari does not send client hints, so in
     practice this only fires for Chrome or Edge on an iPhone, where the platform
     hint is the only honest signal in the request. */
  if (/^iOS$/i.test(platform)) return mobile ? "iPhone" : "iPad";
  return null;
}

export async function GET(req: NextRequest) {
  const headers = req.headers;

  /* Vercel first, Cloudflare second. The Cloudflare fallbacks cost two string
     reads and mean this keeps working if the app is ever fronted differently —
     the alternative is a feature that silently reverts to "Unknown" after an
     infrastructure change nobody connected to the hint. */
  const country =
    countryName(headers.get("x-vercel-ip-country")) ??
    countryName(headers.get("cf-ipcountry"));

  const city =
    decodeHeader(headers.get("x-vercel-ip-city")) ??
    decodeHeader(headers.get("cf-ipcity"));

  /* `x-vercel-ip-country-region` is an ISO-3166-2 *subdivision code* — "LA", not
     "Lagos" — and there is no `Intl` type for subdivisions, so it cannot be
     expanded without shipping a table for every country on earth.
     `app/notifications/page.tsx` joins city, state and country with commas, and
     "Lagos, LA, Nigeria" reads like a bug, so the code is only used when there is
     no city to show. That way the location line is never emptier than it has to
     be and never oddly redundant. */
  const regionCode =
    decodeHeader(headers.get("x-vercel-ip-country-region")) ??
    decodeHeader(headers.get("cf-region-code"));
  const state = city ? null : regionCode;

  const ua = headers.get("user-agent");
  const parsed = describeUserAgent(ua);

  /* Hints win where they exist because they are declarative; the UA ladder is
     the fallback for every browser that does not send them. */
  const device =
    deviceFromClientHints(
      headers.get("sec-ch-ua-platform"),
      headers.get("sec-ch-ua-mobile")
    ) || parsed.device;
  const browser = browserFromClientHints(headers.get("sec-ch-ua")) || parsed.browser;

  const body: SenderContext = {
    country,
    state,
    city,
    /* Joined here rather than in the client so there is exactly one place that
       decides the stored format the hint UI splits on. */
    device: [device, browser].filter(Boolean).join(DEVICE_SEPARATOR) || null,
  };

  return NextResponse.json(body, {
    headers: {
      /* Belt and braces with `force-dynamic`: this response is specific to one
         request and must not be held by a CDN, a proxy or the browser. */
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
