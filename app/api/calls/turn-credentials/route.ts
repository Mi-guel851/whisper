import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { clientIp, consume, rateLimitedResponse } from "@/lib/apiGuard";

/**
 * Mints time-limited TURN credentials for in-app voice calls.
 *
 * WHY A ROUTE EXISTS AT ALL
 *
 * WebRTC needs TURN as the fallback when both peers sit behind NATs that
 * block UDP hole-punching. A TURN account secret embedded in the client
 * bundle is a TURN account for every user on the planet — shared forever,
 * auditable by anyone who inspects the JS, and unlimitable. The standard
 * fix is the TURN REST API: a server-held account credential mints a
 * per-session username/credential pair with a TTL, so the client only ever
 * holds a credential that expires by itself.
 *
 * WHAT "FREE TIER" MEANS HERE
 *
 * The provider is configured by environment, never in code:
 *
 *   TURN_REST_API_URL     the TURN service's REST mint endpoint
 *                         (e.g. a Cloudflare Calls TURN service, or any
 *                         Twilio-style TURN REST API — both have free tiers)
 *   TURN_CREDENTIALS      base64("username:api_key") of that service's
 *                         account credentials. base64, not JSON, because it
 *                         is one opaque secret and it must not be readable
 *                         as a key in an env dump.
 *
 * If the env vars are absent the route answers 200 with NO TURN servers —
 * the client then runs STUN-only, which is fully functional for calls where
 * at least one peer has a usable UDP path (same network, NAT-friendly
 * cellular, most Wi-Fi). Failing the call because an operator hasn't set
 * two env vars is a worse product decision than letting NATs be NATs.
 *
 * NOTHING SECRETS: the request carries the user's session JWT (identity +
 * rate bucket), the body is empty, and the response contains only the
 * short-lived credential the client is entitled to use. The account key
 * stays in the server environment and is never echoed, logged or stored.
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
    const limited = consume("turn-credentials", `${clientIp(req.headers)}:${user.id}`, 10, 10 * 60_000);
    if (limited) return rateLimitedResponse(limited);

    const restApiUrl = process.env.TURN_REST_API_URL;
    const credentials = process.env.TURN_CREDENTIALS;

    if (!restApiUrl || !credentials) {
      /* Not configured: STUN-only is still a working call path for most
         peer pairs. The client knows the difference and says nothing scary. */
      return NextResponse.json({ iceServers: [], turnConfigured: false });
    }

    let account: { username: string; apiKey: string };
    try {
      const decoded = atob(credentials);
      const sep = decoded.indexOf(":");
      if (sep <= 0) throw new Error("malformed credentials");
      account = { username: decoded.slice(0, sep), apiKey: decoded.slice(sep + 1) };
    } catch {
      console.error("[turn-credentials] TURN_CREDENTIALS is not base64('user:key')");
      return NextResponse.json({ error: "TURN is not configured correctly." }, { status: 500 });
    }

    /* Per-session username: short, unique, and prefixed so the provider's
       usage view shows Whisper calls as one cohort rather than anonymous
       noise. The user id is NOT in the username — call logs already tie
       credentials to sessions server-side where it matters. */
    const sessionName = `whisper-${Math.random().toString(36).slice(2, 10)}`;

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
      /* Degrade to STUN-only rather than 500: the call may still connect
         without relay, and a call that attempts is better than a call that
         refuses to start because its relay hiccuped. */
      return NextResponse.json({ iceServers: [], turnConfigured: true });
    }

    const minted = (await mint.json()) as TurnMintResponse;
    if (!minted.uri || !minted.username || !minted.credential) {
      console.error("[turn-credentials] mint response missing fields");
      return NextResponse.json({ iceServers: [], turnConfigured: true });
    }

    return NextResponse.json({
      iceServers: [
        {
          urls: [`${minted.uri}?transport=udp`],
          username: minted.username,
          credential: minted.credential,
        },
      ],
      turnConfigured: true,
      expiresInSeconds: minted.ttl ?? TURN_TTL_SECONDS,
    });
  } catch (err) {
    console.error("[turn-credentials]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
