import AsyncStorage from "@react-native-async-storage/async-storage";

import type { IncomingRing } from "./callSession";

/**
 * How a push tap becomes a ring on screen.
 *
 * The web app solves this with a CustomEvent (`INCOMING_CALL_EVENT`) plus a
 * sessionStorage stash (`PENDING_CALL_KEY`) for the tap that cold-started the
 * page. React Native has no window events and no sessionStorage, so this is
 * the same two mechanisms on the platform's own primitives:
 *
 *   - an in-memory emitter, for a tap while the app is alive (foreground or
 *     background — the JS is running either way);
 *   - an AsyncStorage stash, for a tap that launched the app from a killed
 *     state: the tap handler writes it before anything is mounted, and the
 *     call provider reads (and clears) it once it is.
 *
 * The 60-second ring window check lives with the caller, same as the web.
 */

export const PENDING_RING_KEY = "whisper:pending-call";

export type PushRing = {
  conversationId: string;
  callerId: string;
  callId: string | null;
  callerName: string | null;
  callerAvatar: string | null;
};

const listeners = new Set<(ring: PushRing) => void>();

/** Fired for a call push tap while the app's JS is running. */
export function emitIncomingCallRing(ring: PushRing) {
  for (const listener of [...listeners]) listener(ring);
}

export function subscribeIncomingCallRings(listener: (ring: PushRing) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Written by the tap handler before the app has mounted any screens. */
export async function stashPendingRing(ring: PushRing): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_RING_KEY, JSON.stringify({ ...ring, at: Date.now() }));
  } catch {
    /* Storage unavailable — the realtime row query in the provider is the
       backstop, exactly as the corrupted-stash case is on the web. */
  }
}

/** Read and cleared by the provider on mount. Returns null when stale. */
export async function takePendingRing(): Promise<(PushRing & { at: number }) | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_RING_KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(PENDING_RING_KEY);
    const parsed = JSON.parse(raw) as Partial<PushRing> & { at?: number };
    if (
      !parsed ||
      typeof parsed.conversationId !== "string" ||
      typeof parsed.callerId !== "string" ||
      typeof parsed.at !== "number"
    ) {
      return null;
    }
    return {
      conversationId: parsed.conversationId,
      callerId: parsed.callerId,
      callId: typeof parsed.callId === "string" ? parsed.callId : null,
      callerName: typeof parsed.callerName === "string" ? parsed.callerName : null,
      callerAvatar: typeof parsed.callerAvatar === "string" ? parsed.callerAvatar : null,
      at: parsed.at,
    };
  } catch {
    return null;
  }
}

/** The ring payload a push's data blob carries, when it is a call push. */
export function ringFromPushData(data: Record<string, unknown>): PushRing | null {
  const type = typeof data.type === "string" ? data.type : typeof data.route === "string" ? data.route : "";
  if (type !== "call") return null;
  const conversationId =
    typeof data.conversationId === "string"
      ? data.conversationId
      : typeof data.conversation_id === "string"
        ? data.conversation_id
        : null;
  const callerId = typeof data.callerId === "string" ? data.callerId : typeof data.caller_id === "string" ? data.caller_id : null;
  if (!conversationId || !callerId) return null;
  return {
    conversationId,
    callerId,
    callId: typeof data.callId === "string" ? data.callId : typeof data.call_id === "string" ? data.call_id : null,
    callerName: typeof data.callerName === "string" ? data.callerName : typeof data.caller_name === "string" ? data.caller_name : null,
    callerAvatar: typeof data.callerAvatar === "string" ? data.callerAvatar : typeof data.caller_avatar === "string" ? data.caller_avatar : null,
  };
}

export type { IncomingRing };
