"use client";

import { supabase } from "@/lib/supabase/client";

/**
 * ICE servers for the call's RTCPeerConnection.
 *
 * STUN is public and free (Google's public servers — the same list every
 * WebRTC demo on the internet runs), so it ships in the client. TURN is the
 * NAT fallback and its account secret must never be in the bundle:
 * /api/calls/turn-credentials mints a time-limited credential server-side,
 * and the result is cached here for the remainder of its TTL minus a
 * headroom so a renegotiation mid-call (ICE restart) reuses the same
 * credential instead of minting a new one every few seconds.
 */

const STUN_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

/** Mint early enough that a mid-call restart never waits on the network. */
const REFRESH_HEADROOM_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 4_000;

let cached: { servers: RTCIceServer[]; expiresAt: number } | null = null;
let inFlight: Promise<RTCIceServer[]> | null = null;

export function getIceServers(): Promise<RTCIceServer[]> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return Promise.resolve(cached.servers);
  }
  /* One fetch at a time: two tabs (or a start + an ICE restart) racing the
     mint endpoint just to get the same TTL back is wasted rate budget. */
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) return STUN_SERVERS;

      const res = await fetch("/api/calls/turn-credentials", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return STUN_SERVERS;

      const data = (await res.json()) as { iceServers: RTCIceServer[]; expiresInSeconds?: number };
      const servers = [...STUN_SERVERS, ...(data.iceServers ?? [])];
      cached = {
        servers,
        expiresAt: Date.now() + ((data.expiresInSeconds ?? 1800) * 1000 - REFRESH_HEADROOM_MS),
      };
      return servers;
    } catch {
      /* Timeout, offline, route missing (older deploy): STUN-only still
         carries calls that have a UDP path, and the error must never kill
         the call that is about to start. */
      return STUN_SERVERS;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
