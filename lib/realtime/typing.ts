import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

type TypingStatusRow = {
  user_id: string;
  typing: boolean;
};

class TypingManager {
  private channels = new Map<string, RealtimeChannel>();

  subscribe(
    conversationId: string,
    currentUser: string,
    callback: (typing: boolean) => void
  ) {
    if (this.channels.has(conversationId)) {
      return () => {};
    }

    const channel = supabase
      .channel(`typing:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "typing_status",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as TypingStatusRow | null;

          if (!row) return;

          if (row.user_id === currentUser) return;

          callback(row.typing);
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

  async setTyping(
    conversationId: string,
    userId: string,
    typing: boolean
  ) {
    await supabase
      .from("typing_status")
      .upsert(
        {
          conversation_id: conversationId,
          user_id: userId,
          typing,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "conversation_id,user_id",
        }
      );
  }
}

export const typingManager = new TypingManager();
