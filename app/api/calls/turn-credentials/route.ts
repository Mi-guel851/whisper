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
 * WHY THIS ROUTE USED TO SILENTLY BREAK EVERY APP-TO-ANYTHING CALL
 *
 * The old default "floor" was openrelay.metered.ca, the free public relay
 * from a 2019 blog post. It is dead: the endpoint resolves and accepts the
 * connection, then closes it without answering a single TURN request. So a
 * deployment with no TURN configured was not "STUN-only" — it was serving a
 * relay that looked configured and relayed nothing. Two phones behind
 * carrier NAT (the default shape for the app: mobile data) could never
 * connect through it, and the only symptom was "Connecting…" for 25 seconds.
 * Web-to-web calls between friendly networks still connected, which is how
 * the feature "worked" for a while while every call involving the app died.
 *
 * A dead default is worse than no default: it hides the problem. So the
 * floor is now EXPLICIT — an operator names the relay they actually use —
 * and when nothing is configured the answer says `turnConfigured: false`,
 * and the client tells the user at dial time that the call may not connect
 * across different networks, instead of twenty-five seconds of mystery.
 *
 * CONFIGURATION, in the order it is tried:
 *
 *   1. Static relay (coturn and friends):
 *        TURN_URLS        "turn:turn.example.com:3478,turns:turn.example.com:5349"
 *        TURN_USERNAME    a long-term credential's username
 *        TURN_CREDENTIAL  its password
 *
 *   2. Cloudflare Calls (recommended: 1TB free, global, no self-hosting):
 *        TURN_CF_KEY_ID       the TURN key's id (Calls dashboard, or API)
 *        TURN_CF_API_TOKEN    an API token with Calls:Edit on the account
 *      The key stays server-side; only the short-lived credential leaves.
 *
 *   3. Any other TURN REST API (time-limited credentials):
 *        TURN_REST_API_URL  the service's mint endpoint
 *        TURN_CREDENTIALS   base64("username:api_key")
 *
 *   4. An explicit fallback relay, only if the operator names one:
 *        TURN_FALLBACK_URLS  "turn:relay.example.com:3478,turns:..."
 *        TURN_FALLBACK_USERNAME / TURN_FALLBACK_CREDENTIAL  (optional)
 *      There is no built-in relay behind this. The last default was a dead
 *      server, and the default now is an honest "none configured".
 *
 * NOTHING SECRETS: the request carries the user's session JWT (identity +
 * rate bucket), the body is empty, and the response contains only the
 * credential the client is entitled to use. Account keys stay in the server
 * environment and are never echoed, logged or stored.
 */

/** TTL of a minted credential: one call, plus headroom for a renegotiation. */
const TURN_TTL_SECONDS = 1800;

/** How long a minted credential stays useful in the client cache. */
export const TURN_CREDENTIAL_TTL_SECONDS = TURN_TTL_SECONDS;

const MINT_TIMEOUT_MS = 5_000;

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

/**
 * Cloudflare Calls: a TURN key (long-lived, server-side) mints short-lived
 * credentials through
 *   POST https://rtc.live.cloudflare.com/v1/turn/keys/<key_id>/credentials/generate-ice-servers
 *   Authorization: Bearer <api token>
 *   body: {"ttl": <seconds>}
 * The 201 response is a ready-to-use `iceServers` array (STUN + TURN, several
 * transports) — exactly the shape RTCPeerConnection wants.
 */
async function cloudflareIceServers(): Promise<{ iceServers: RTCIceServer[]; expiresInSeconds: number } | null> {
  const keyId = process.env.TURN_CF_KEY_ID;
  const apiToken = process.env.TURN_CF_API_TOKEN;
  if (!keyId || !apiToken) return null;

  try {
    const mint = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
        signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
      }
    );

    if (!mint.ok) {
      console.error(
        "[turn-credentials] cloudflare mint failed:",
        mint.status,
        (await mint.text()).slice(0, 300)
      );
      return null;
    }

    const body = (await mint.json()) as { iceServers?: RTCIceServer[] };
    const urlsOf = (server: RTCIceServer): string[] =>
      Array.isArray(server.urls) ? server.urls : [server.urls];
    const servers = (body.iceServers ?? []).filter((server) => urlsOf(server).length > 0);
    if (!servers.some((server) => urlsOf(server).some((url) => String(url).includes("turn:")))) {
      console.error("[turn-credentials] cloudflare mint returned no turn: servers");
      return null;
    }
    return { iceServers: servers, expiresInSeconds: TURN_TTL_SECONDS };
  } catch (err) {
    console.error("[turn-credentials] cloudflare mint request failed", err);
    return null;
  }
}

/** The explicit floor: a relay the OPERATOR named. Never a built-in default. */
function fallbackIceServers(): RTCIceServer[] | null {
  const urls = (process.env.TURN_FALLBACK_URLS ?? "")
    .split(/[\s,]+/)
    .map((url) => url.trim())
    .filter(Boolean);
  if (urls.length === 0) return null;

  const username = process.env.TURN_FALLBACK_USERNAME;
  const credential = process.env.TURN_FALLBACK_CREDENTIAL;
  const needsAuth = urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:"));
  if (needsAuth && (!username || !credential)) {
    console.error(
      "[turn-credentials] TURN_FALLBACK_URLS carries turn: URLs but no " +
        "TURN_FALLBACK_USERNAME/TURN_FALLBACK_CREDENTIAL; they cannot be used."
    );
    return null;
  }
  return [{ urls, ...(needsAuth ? { username, credential } : {}) }];
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

    /* 2. Cloudflare Calls: 1TB free, globally distributed, credentials that
          mint per request and expire. The recommended floor for a product
          whose calls cross carrier NATs. */
    const cloudflare = await cloudflareIceServers();
    if (cloudflare) {
      return NextResponse.json({
        iceServers: cloudflare.iceServers,
        turnConfigured: true,
        source: "cloudflare",
        expiresInSeconds: cloudflare.expiresInSeconds,
      });
    }

    const restApiUrl = process.env.TURN_REST_API_URL;
    const credentials = process.env.TURN_CREDENTIALS;

    /* 3. A generic TURN REST API: per-session credentials with their own TTL. */
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
    }

    /* 4. The explicit floor. */
    const fallback = fallbackIceServers();
    if (fallback) {
      return NextResponse.json({
        iceServers: fallback,
        turnConfigured: true,
        source: "fallback",
        expiresInSeconds: TURN_TTL_SECONDS,
      });
    }

    /* Deliberately relay-less. No dead default hiding behind the product:
       the client reads turnConfigured:false, and the call engine tells the
       user at dial time that a call across different networks may not
       connect — a sentence, not twenty-five seconds of "Connecting…". */
    console.warn(
      "[turn-credentials] no TURN configured (TURN_URLS, TURN_CF_KEY_ID+TURN_CF_API_TOKEN, " +
        "TURN_REST_API_URL, or TURN_FALLBACK_URLS). Calls between peers on different " +
        "networks will fail to connect. Cloudflare Calls has a free tier."
    );
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
