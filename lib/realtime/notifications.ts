import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

class NotificationManager {
  private channel: RealtimeChannel | null = null;

  connect(userId: string, callback: () => void) {
    if (this.channel) return;

    this.channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `recipient_id=eq.${userId}`,
        },
        () => {
          callback();
        }
      )
      .subscribe();
  }

  disconnect() {
    if (!this.channel) return;

    supabase.removeChannel(this.channel);
    this.channel = null;
  }
}

export const notificationManager = new NotificationManager();