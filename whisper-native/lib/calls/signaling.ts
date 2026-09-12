import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

/**
 * Call signaling: offer/answer/ICE/end/busy/decline over a dedicated
 * Supabase Realtime broadcast channel per conversation.
 *
 * A verbatim port of the web app's `lib/calls/signaling.ts` — the same topic
 * (`whisper-call:<conversationId>`), the same event name, the same payload
 * shapes — because a native caller is talking to a web callee through this
 * channel and either side changing the dialect hangs the call.
 *
 * WHY BROADCAST (the web module's reasoning, kept)
 *
 * Signaling payloads are tiny, fast, and not rows at all — an SDP offer is a
 * 1-2KB blob with no table to live in, and the round trip it tolerates is
 * tens of milliseconds, not a write-commit. The media itself (the Opus
 * audio) never comes close to this channel — it flows device-to-device over
 * WebRTC.
 */

export type CallSignalEvent = "offer" | "answer" | "ice" | "end" | "busy" | "decline";

export type CallSignalPayload = {
  /** SDP for offer/answer. */
  sdp?: string;
  /**
   * The server-generated identity of the call this signal belongs to
   * (`call_logs.call_id`, minted by `start_call_log`). Carried on the FIRST
   * offer so the callee can finalize that exact row; absent from legacy
   * callers, which just means the callee skips the end_call_log call.
   */
  callId?: string;
  /** ICE candidate for "ice" signals. */
  candidate?: { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null };
  /** Present on an "offer" that is a renegotiation (ICE restart), not the first. */
  restart?: boolean;
};

export type CallSignal = {
  event: CallSignalEvent;
  user_id: string;
  /** The web sends an explicit `null` for "no payload" — the wire keeps that. */
  payload?: CallSignalPayload | null;
};

class CallSignaling {
  private channels = new Map<string, RealtimeChannel>();
  private listeners = new Map<string, Set<(signal: CallSignal) => void>>();

  subscribe(conversationId: string, currentUser: string, callback: (signal: CallSignal) => void) {
    let listeners = this.listeners.get(conversationId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(conversationId, listeners);
    }
    listeners.add(callback);

    if (!this.channels.has(conversationId)) {
      const channel = supabase
        .channel(`whisper-call:${conversationId}`)
        .on("broadcast", { event: "call-signal" }, ({ payload }) => {
          const signal = payload as CallSignal;
          /* Broadcast does not echo to the sender, but the guard costs
             nothing: a self-signal is always a bug in the sending code. */
          if (!signal || signal.user_id === currentUser) return;
          this.listeners.get(conversationId)?.forEach((listener) => listener(signal));
        })
        .subscribe();

      this.channels.set(conversationId, channel);
    }

    return () => {
      const currentListeners = this.listeners.get(conversationId);
      currentListeners?.delete(callback);
      if (currentListeners && currentListeners.size > 0) return;

      this.listeners.delete(conversationId);
      const channel = this.channels.get(conversationId);
      if (channel) supabase.removeChannel(channel);
      this.channels.delete(conversationId);
    };
  }

  async broadcast(conversationId: string, signal: CallSignal) {
    let channel = this.channels.get(conversationId);
    if (!channel) {
      /* A broadcast with no listeners yet creates the channel anyway: if the
         callee never subscribes, the call simply goes missed — the same
         outcome as any unanswered phone call. */
      channel = supabase.channel(`whisper-call:${conversationId}`).subscribe();
      this.channels.set(conversationId, channel);
    }

    await channel.send({
      type: "broadcast",
      event: "call-signal",
      payload: signal,
    });
  }
}

export const callSignaling = new CallSignaling();
