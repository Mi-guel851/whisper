import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

class ChatManager {
  private channels = new Map<string, RealtimeChannel>();

  subscribe(
    conversationId: string,
    callback: (message: ChatMessage) => void
  ) {
    // Return existing subscription if already active
    if (this.channels.has(conversationId)) {
      return () => {};
    }

    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "direct_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          callback(payload.new as ChatMessage);
        }
      )
      .subscribe();

    this.channels.set(conversationId, channel);

    return () => {
      const existing = this.channels.get(conversationId);

      if (existing) {
        supabase.removeChannel(existing);
        this.channels.delete(conversationId);
      }
    };
  }
}

export const chatManager = new ChatManager();