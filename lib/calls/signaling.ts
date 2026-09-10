import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

/**
 * Call signaling: offer/answer/ICE/end/busy/decline over a dedicated
 * Supabase Realtime broadcast channel per conversation.
 *
 * WHY A DEDICATED CHANNEL (and why broadcast, not postgres_changes)
 *
 * The chat page already runs three postgres_changes channels per
 * conversation (messages, reactions, relationships). Signaling payloads are
 * the opposite shape: tiny, fast, and not rows at all — an SDP offer is a
 * 1-2KB blob with no table to live in, and the round trip it tolerates is
 * tens of milliseconds, not a write-commit. Broadcast is exactly that
 * channel: no write, no commit, delivered to every subscriber of the topic.
 *
 * WHY NO POLLING CAN EVER REPLACE THIS
 *
 * A call that rings on a 3-second poll misses its own window: the callee is
 * looking at the chat, sees nothing, and by the time the poll lands the
 * caller has hung up. Broadcast is the only transport where "the offer
 * arrived" is "the callee's screen changed" in the same breath.
 *
 * The media itself (the Opus audio) never comes close to this channel — it
 * flows device-to-device over WebRTC. What crosses here is the handshake:
 * SDP descriptions, ICE candidates, and the four control words
 * (end/busy/decline plus the offer's restart flag).
 *
 * Manager shaped like lib/realtime/typing: one channel per conversation,
 * ref-counted listeners, torn down when the last one leaves — so the chat
 * page, which mounts/unmounts freely, cannot leak channels or double-deliver
 * to a dead subscriber.
 */

export type CallSignalEvent = "offer" | "answer" | "ice" | "end" | "busy" | "decline";

export type CallSignalPayload = {
  /** SDP for offer/answer. */
  sdp?: string;
  /**
   * The server-generated identity of the call this signal belongs to
   * (call_logs.call_id, minted by start_call_log — 20260909/0005). Carried on
   * the FIRST offer so the callee can finalize that exact row (answered /
   * declined / busy) instead of guessing by conversation; absent from legacy
   * callers, which just means the callee skips the end_call_log call.
   */
  callId?: string;
  /** ICE candidate for "ice" signals. */
  candidate?: RTCIceCandidateInit;
  /**
   * Present on an "offer" that is a renegotiation (ICE restart), not the
   * first offer of the call. The receiver re-runs the answer path for an
   * in-call offer only when this is set — a bare mid-call offer from a peer
   * in "idle" state is the shape a confused or hostile client would send,
   * and it must not hijack a live call.
   */
  restart?: boolean;
};

export type CallSignal = {
  event: CallSignalEvent;
  user_id: string;
  payload?: CallSignalPayload | null;
};

class CallSignaling {
  private channels = new Map<string, RealtimeChannel>();
  private listeners = new Map<string, Set<(signal: CallSignal) => void>>();

  subscribe(
    conversationId: string,
    currentUser: string,
    callback: (signal: CallSignal) => void
  ) {
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
             nothing and typingManager sets the precedent: a self-signal is
             always a bug in the sending code, never an event to handle. */
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
      /* A broadcast with no listeners yet (callee's page not open) creates
         the channel anyway: Supabase delivers broadcasts to whoever
         subscribes to the topic, and the channel object is the handle we
         need to send on. If the callee never subscribes, the call simply
         goes missed — the same outcome as any unanswered phone call. */
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
