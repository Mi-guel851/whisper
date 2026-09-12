import { supabase } from "@/lib/supabase";

/**
 * ICE servers for the call's RTCPeerConnection.
 *
 * A port of the web app's `lib/calls/iceServers.ts`: STUN is public and free
 * (Google's servers), TURN is the NAT fallback and its account secret must
 * never be in the bundle — `/api/calls/turn-credentials` mints a time-limited
 * credential server-side, and the result is cached here for the remainder of
 * its TTL minus a headroom, so a renegotiation mid-call reuses the same
 * credential instead of minting a new one every few seconds.
 *
 * The one native difference is the fetch: Hermes has no `AbortSignal.timeout`,
 * so the deadline is an AbortController armed by hand — the mint endpoint
 * hanging must not hang a dial.
 */

export type NativeIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

const STUN_SERVERS: NativeIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

/** Mint early enough that a mid-call restart never waits on the network. */
const REFRESH_HEADROOM_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 4_000;

function apiBase(): string {
  return (process.env.EXPO_PUBLIC_API_BASE_URL || "https://whisper-anonymous.vercel.app").replace(/\/$/, "");
}

let cached: { servers: NativeIceServer[]; expiresAt: number } | null = null;
let inFlight: Promise<NativeIceServer[]> | null = null;

export function getIceServers(): Promise<NativeIceServer[]> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return Promise.resolve(cached.servers);
  }
  /* One fetch at a time: a start + an ICE restart racing the mint endpoint
     just to get the same TTL back is wasted rate budget. */
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) return STUN_SERVERS;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      let res: Response;
      try {
        res = await fetch(`${apiBase()}/api/calls/turn-credentials`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) return STUN_SERVERS;

      const data = (await res.json()) as {
        iceServers?: NativeIceServer[];
        expiresInSeconds?: number;
        turnConfigured?: boolean;
        source?: string;
      };
      const servers = [...STUN_SERVERS, ...(data.iceServers ?? [])];
      if (!servers.some((server) => String(server.urls ?? "").includes("turn:"))) {
        /* Loud on purpose. A STUN-only build is not "degraded", it is a call
           that will not connect across networks — the operator has to know. */
        console.warn(
          "[calls] /api/calls/turn-credentials returned no TURN server (turnConfigured =",
          data.turnConfigured,
          "source =",
          data.source,
          ") — calls across different networks will likely fail"
        );
      }
      const ttl = Math.max(60, (data.expiresInSeconds ?? 3600) * 1000 - REFRESH_HEADROOM_MS);
      cached = { servers, expiresAt: now + ttl };
      return servers;
    } catch {
      return STUN_SERVERS;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Test hook: forget the cached credential. */
export function resetIceCache(): void {
  cached = null;
}
