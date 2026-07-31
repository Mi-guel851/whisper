import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

type TypingPayload = {
  user_id: string;
  typing: boolean;
};

class TypingManager {
  private channels = new Map<string, RealtimeChannel>();
  private listeners = new Map<string, Set<(typing: boolean) => void>>();

  subscribe(
    conversationId: string,
    currentUser: string,
    callback: (typing: boolean) => void
  ) {
    let listeners = this.listeners.get(conversationId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(conversationId, listeners);
    }
    listeners.add(callback);

    if (!this.channels.has(conversationId)) {
      const channel = supabase
        .channel(`typing:${conversationId}`)
        .on("broadcast", { event: "typing" }, ({ payload }) => {
          const status = payload as TypingPayload;
          if (status.user_id === currentUser) return;
          this.listeners.get(conversationId)?.forEach((listener) => listener(status.typing));
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

  async setTyping(
    conversationId: string,
    userId: string,
    typing: boolean
  ) {
    const channel = this.channels.get(conversationId);
    if (!channel) return;

    await channel.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: userId, typing },
    });
  }
}

export const typingManager = new TypingManager();
