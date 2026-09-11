import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { clientIp, consume, rateLimitedResponse } from "@/lib/apiGuard";

/**
 * Mints the ICE relay a voice call needs.
 *
 * WHY A ROUTE EXISTS AT ALL
 *
 * WebRTC needs TURN as the fallback when both peers sit behind NATs that
 * block UDP hole-punching. A TURN account secret embedded in the client
 * bundle is a TURN account for every user on the planet — shared forever,
 * auditable by anyone who inspects the JS, and unlimitable. The standard
 * fix is a server-held credential: the client only ever holds something
 * short-lived or scoped to the call.
 *
 * WHY "STUN ONLY" WAS A BUG AND NOT A DEGRADATION
 *
 * This route used to answer `iceServers: []` whenever an operator had not set
 * two environment variables, and the client quietly ran STUN-only. That reads
 * like a graceful fallback in the code and behaves like a dead feature in the
 * field: two phones on cellular networks are almost always behind
 * symmetric/carrier-grade NAT, where STUN produces candidates that cannot
 * reach each other. The call rang, the callee picked up, both screens said
 * "Connecting…" for 25 seconds, and the call log then claimed the call had
 * lasted 25 seconds. So a relay is now ALWAYS supplied — from the operator's
 * own server when one is configured, from the shared public fallback when one
 * is not — and the operator can turn the fallback off deliberately, but not
 * by accident.
 *
 * CONFIGURATION, in the order it is tried:
 *
 *   1. Static relay (coturn and friends):
 *        TURN_URLS        "turn:turn.example.com:3478,turns:turn.example.com:5349"
 *        TURN_USERNAME    a long-term credential's username
 *        TURN_CREDENTIAL  its password
 *      Recommended for production: your own relay, your own bandwidth, and no
 *      third party in the media path at all.
 *
 *   2. TURN REST API (time-limited credentials):
 *        TURN_REST_API_URL  the service's mint endpoint
 *        TURN_CREDENTIALS   base64("username:api_key")
 *
 *   3. Public fallback relay (metered.ca's open relay), unless
 *      TURN_FALLBACK=off. Shared and rate-limited, so it is a floor to stand
 *      the product up on, not a ceiling: set option 1 for real traffic. The
 *      response names the source so an operator can see which one is live.
 *
 * NOTHING SECRETS: the request carries the user's session JWT (identity +
 * rate bucket), the body is empty, and the response contains only the
 * credential the client is entitled to use. The account key stays in the
 * server environment and is never echoed, logged or stored.
 */

/** TTL of a minted credential: one call, plus headroom for a renegotiation. */
const TURN_TTL_SECONDS = 1800;

/** How long a minted credential stays useful in the client cache. */
export const TURN_CREDENTIAL_TTL_SECONDS = TURN_TTL_SECONDS;

const MINT_TIMEOUT_MS = 5_000;

/**
 * The floor. A public relay that anyone may use, published for exactly this
 * purpose; the media is still DTLS-encrypted end to end, so the relay sees
 * packets and IP addresses, nothing else. Overridden by TURN_URLS, and
 * switched off with TURN_FALLBACK=off.
 */
const PUBLIC_FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

type TurnMintResponse = {
  uri: string;
  username: string;
  credential: string;
  ttl?: number;
};

/** `TURN_URLS` is a comma/space/newline separated list of stun: and turn: URIs. */
function staticIceServers(): RTCIceServer[] | null {
  const urls = (process.env.TURN_URLS ?? "")
    .split(/[\s,]+/)
    .map((url) => url.trim())
    .filter(Boolean);
  if (urls.length === 0) return null;

  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;
  const needsAuth = urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:"));
  if (needsAuth && (!username || !credential)) {
    console.error(
      "[turn-credentials] TURN_URLS is set but TURN_USERNAME/TURN_CREDENTIAL are not; " +
        "a turn: URL without credentials cannot be used."
    );
    return null;
  }
  return [{ urls, ...(needsAuth ? { username, credential } : {}) }];
}

function fallbackAllowed(): boolean {
  const flag = (process.env.TURN_FALLBACK ?? "").trim().toLowerCase();
  return !["off", "false", "0", "no"].includes(flag);
}

export async function POST(req: NextRequest) {
  try {
    /* Identity from the Bearer token only — never from the body. Same
       discipline as /api/set-recovery-phrase: the body is untrusted input
       and says nothing about who the caller is. */
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const accessToken = authHeader.slice("Bearer ".length);

    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    /* One call mints at most a handful of credentials (page reloads race
       each other); 10 per 10 minutes per user+IP is generous and kills the
       scripted case. */
    const limited = await consume("turn-credentials", `${clientIp(req.headers)}:${user.id}`, 10, 10 * 60_000);
    if (limited) return rateLimitedResponse(limited);

    /* 1. The operator's own relay. Best case: no third party, no expiry
          dance, and bandwidth they are paying for and can watch. */
    const own = staticIceServers();
    if (own) {
      return NextResponse.json({
        iceServers: own,
        turnConfigured: true,
        source: "static",
        expiresInSeconds: TURN_TTL_SECONDS,
      });
    }

    const restApiUrl = process.env.TURN_REST_API_URL;
    const credentials = process.env.TURN_CREDENTIALS;

    /* 2. A TURN REST API: per-session credentials with their own TTL. */
    if (restApiUrl && credentials) {
      const minted = await mintFromRestApi(restApiUrl, credentials);
      if (minted) {
        return NextResponse.json({
          iceServers: minted.iceServers,
          turnConfigured: true,
          source: "rest",
          expiresInSeconds: minted.expiresInSeconds,
        });
      }
      /* The mint failed. Fall through to the public relay: a call on a
         shared relay beats a call that cannot connect at all. */
    }

    /* 3. The floor, so a call is never silently impossible. */
    if (fallbackAllowed()) {
      if (!own && !restApiUrl) {
        console.warn(
          "[turn-credentials] no TURN server configured; serving the public fallback relay. " +
            "Set TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL for production traffic."
        );
      }
      return NextResponse.json({
        iceServers: PUBLIC_FALLBACK_ICE_SERVERS,
        turnConfigured: true,
        source: "public-fallback",
        expiresInSeconds: TURN_TTL_SECONDS,
      });
    }

    /* Deliberately relay-less. The client says so out loud rather than
       letting the user discover it as a call that never connects. */
    return NextResponse.json({ iceServers: [], turnConfigured: false, source: "none" });
  } catch (err) {
    console.error("[turn-credentials]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

async function mintFromRestApi(
  restApiUrl: string,
  credentials: string
): Promise<{ iceServers: RTCIceServer[]; expiresInSeconds: number } | null> {
  let account: { username: string; apiKey: string };
  try {
    const decoded = atob(credentials);
    const sep = decoded.indexOf(":");
    if (sep <= 0) throw new Error("malformed credentials");
    account = { username: decoded.slice(0, sep), apiKey: decoded.slice(sep + 1) };
  } catch {
    console.error("[turn-credentials] TURN_CREDENTIALS is not base64('user:key')");
    return null;
  }

  /* Per-session username: short, unique, and prefixed so the provider's
     usage view shows Whisper calls as one cohort rather than anonymous
     noise. The user id is NOT in the username — call logs already tie
     credentials to sessions server-side where it matters. */
  const sessionName = `whisper-${Math.random().toString(36).slice(2, 10)}`;

  try {
    const mint = await fetch(restApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${account.username}:${account.apiKey}`).toString("base64")}`,
      },
      body: JSON.stringify({
        username: sessionName,
        ttl: TURN_TTL_SECONDS,
        transport: "udp",
      }),
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    });

    if (!mint.ok) {
      console.error("[turn-credentials] mint failed:", mint.status, (await mint.text()).slice(0, 300));
      return null;
    }

    const minted = (await mint.json()) as TurnMintResponse;
    if (!minted.uri || !minted.username || !minted.credential) {
      console.error("[turn-credentials] mint response missing fields");
      return null;
    }

    return {
      iceServers: [
        {
          urls: [`${minted.uri}?transport=udp`],
          username: minted.username,
          credential: minted.credential,
        },
      ],
      expiresInSeconds: minted.ttl ?? TURN_TTL_SECONDS,
    };
  } catch (err) {
    console.error("[turn-credentials] mint request failed", err);
    return null;
  }
}
