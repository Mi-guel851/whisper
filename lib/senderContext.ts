/**
 * What the paid "Hint" on an anonymous whisper is actually made of.
 *
 * WHY THIS MODULE EXISTS
 *
 * The hint has always *rendered* four facts — location, time sent, device,
 * browser — but only one of them was ever real. `app/notifications/page.tsx`
 * reads `sender_country / sender_state / sender_city / sender_device` off the
 * message row and falls back to "Unknown" when they are null, and the live send
 * path never wrote them, so every hint anyone spent coins on said "Unknown"
 * twice over. (The capture code did exist, in `app/u/[username]/Profile.tsx` —
 * a dead file nothing routes to any more.) Selling a hint that resolves to
 * "Unknown" is the exact thing the brief rules out: a feature that looks
 * implemented and isn't.
 *
 * WHY THE LOCATION IS READ SERVER-SIDE
 *
 * The dead code called `https://ipapi.co/json/` from the browser. That is wrong
 * three ways: it is a third-party request on the critical path of sending (rate
 * limited, and free-tier CORS is not guaranteed), it hands a stranger's IP to an
 * unrelated service, and any client can trivially forge the response. The
 * platform already knows the answer — Vercel attaches `x-vercel-ip-*` headers to
 * every request from its edge — so `app/api/sender-context/route.ts` reads them
 * off the request and returns the result. No third party, nothing the sender can
 * spoof by editing a fetch, and no added network hop off our own origin.
 *
 * WHY THE UA PARSER IS SHARED
 *
 * The route parses the `user-agent` header; the browser fallback parses
 * `navigator.userAgent`. If those were two copies of the same regex ladder they
 * would drift, and the drift would show up as the *same phone* reported as two
 * different devices depending on whether the API call succeeded. One function,
 * both callers.
 *
 * PRIVACY POSTURE
 *
 * This is deliberately coarse and deliberately not new: city / region / country
 * and a device family are what the hint has always claimed to show, and they are
 * what a recipient pays coins to see. No IP address is ever stored, no
 * coordinates, no full user-agent string, and nothing is written unless the
 * sender actually presses send. The sender stays anonymous — this narrows
 * "somebody" to "somebody on an Android phone in Lagos", which is the entire
 * point of the feature and nowhere near identifying.
 */

export type SenderContext = {
  /** Full country name, e.g. "Nigeria" — never the ISO code. */
  country: string | null;
  state: string | null;
  city: string | null;
  /** Pre-joined `"<device> • <browser>"`, the shape the hint UI splits on. */
  device: string | null;
};

export const EMPTY_SENDER_CONTEXT: SenderContext = {
  country: null,
  state: null,
  city: null,
  device: null,
};

export type DeviceDescription = { device: string; browser: string };

/** The separator `app/notifications/page.tsx` splits `sender_device` on. */
export const DEVICE_SEPARATOR = " • ";

export function formatDevice(parts: DeviceDescription): string {
  return [parts.device, parts.browser].filter(Boolean).join(DEVICE_SEPARATOR);
}

/**
 * Device family and browser from a user-agent string.
 *
 * Order is load-bearing in both ladders and is the reason this is not a
 * one-liner:
 *
 *   - Android tablets must be tested before Android phones, because every
 *     Android UA contains "Android" and only phones contain "Mobile".
 *   - Samsung Internet, Edge and Opera all embed "Chrome" in their UA, so
 *     checking Chrome first would report all three as Chrome. Chrome must come
 *     last among the Chromium family.
 *   - Every Chromium UA also contains "Safari", so Safari must be last overall.
 *
 * `touchPoints` exists because of one case the string genuinely cannot answer:
 * Safari on iPadOS 13+ sends a *verbatim* Macintosh user-agent with no iPad token
 * and no "Mobile" token, so from the UA alone an iPad is a Mac. `maxTouchPoints`
 * is the only signal that separates them, and it exists solely in the browser —
 * which is why it is a parameter rather than something read inside here. The
 * server omits it and calls such a device a Mac, because guessing would be worse
 * than being coarse on a fact somebody paid for.
 *
 * Returns human-readable names because they are shown verbatim to whoever paid
 * for the hint — "Android phone", not "Linux armv8l".
 */
export function describeUserAgent(
  ua: string | null | undefined,
  touchPoints?: number
): DeviceDescription {
  const agent = ua || "";

  let device = "Unknown Device";
  if (/\bAndroid\b/i.test(agent)) {
    device = /\bMobile\b/i.test(agent) ? "Android phone" : "Android tablet";
  } else if (/\biPhone\b/i.test(agent)) {
    device = "iPhone";
  } else if (/\biPad\b/i.test(agent)) {
    device = "iPad";
  } else if (/\biPod\b/i.test(agent)) {
    device = "iPod touch";
  } else if (/\bCrOS\b/i.test(agent)) {
    device = "Chromebook";
  } else if (/\bMacintosh\b/i.test(agent)) {
    /* A Mac reports at most one touch point; an iPad in desktop mode reports
       five. Without the hint this is a Mac, which is the honest answer to give
       when there is nothing in the request that says otherwise. */
    device = touchPoints && touchPoints > 1 ? "iPad" : "Mac computer";
  } else if (/\bWindows\b/i.test(agent)) {
    device = "Windows PC";
  } else if (/\bLinux\b/i.test(agent)) {
    device = "Linux device";
  }

  let browser = "Unknown Browser";
  /* `Edg/` desktop, `EdgA/` Android, `EdgiOS/` iOS, `Edge/` legacy EdgeHTML — one
     pattern for all four, and it has to run first because every modern Edge UA
     also contains "Chrome" and "Safari". */
  if (/\bEdge?(?:iOS|A)?\//i.test(agent)) browser = "Edge";
  else if (/SamsungBrowser/i.test(agent)) browser = "Samsung Internet";
  else if (/\bOPR\/|\bOPT\/|\bOpera\b/i.test(agent)) browser = "Opera";
  else if (/\bYaBrowser\b/i.test(agent)) browser = "Yandex";
  else if (/\bFocus\/|\bFxiOS\/|\bFirefox\//i.test(agent)) browser = "Firefox";
  else if (/\bChrome\/|\bCriOS\//i.test(agent)) browser = "Chrome";
  else if (/\bSafari\//i.test(agent)) browser = "Safari";

  return { device, browser };
}

/** Where the browser asks the server what it can see about this request. */
export const SENDER_CONTEXT_ENDPOINT = "/api/sender-context";

/**
 * How long the browser waits for the endpoint before giving up on it.
 *
 * Short on purpose. This runs while the visitor is typing, so it is normally
 * finished long before they press send — but if the network is bad, sending must
 * not be the thing that waits. A whisper that fails to send is infinitely worse
 * than a hint that says "Unknown" for the location.
 */
const CONTEXT_TIMEOUT_MS = 4000;

/**
 * The sender's context, best-effort, never throwing.
 *
 * On any failure the local user-agent still produces the device and browser, so
 * a blocked or slow endpoint degrades the hint from four real facts to three
 * rather than back to nothing.
 */
export async function captureSenderContext(): Promise<SenderContext> {
  const local =
    typeof navigator === "undefined"
      ? null
      : formatDevice(describeUserAgent(navigator.userAgent));

  /* `AbortSignal.timeout` rather than a manual controller + setTimeout: it
      cannot leak the timer, and it rejects with a `TimeoutError` that the catch
      below treats the same as any other failure. */
  try {
    const response = await fetch(SENDER_CONTEXT_ENDPOINT, {
      /* No credentials and no cache. The answer is per-request by definition, and
         a cached response would report the first visitor's city to everyone
         after them — a wrong hint is worse than an unknown one. */
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(CONTEXT_TIMEOUT_MS),
    });

    if (!response.ok) return { ...EMPTY_SENDER_CONTEXT, device: local };

    const json = (await response.json()) as Partial<SenderContext>;
    return {
      country: json.country || null,
      state: json.state || null,
      city: json.city || null,
      /* The server's reading wins when it has one: it parses the same UA but
         also gets Chromium's client hints, which are accurate where UA sniffing
         is only a good guess. */
      device: json.device || local,
    };
  } catch {
    return { ...EMPTY_SENDER_CONTEXT, device: local };
  }
}
