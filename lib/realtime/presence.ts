import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

export type PresenceUser = {
  id: string;
};

class PresenceManager {
  private channel: RealtimeChannel | null = null;
  private listeners = new Set<(users: PresenceUser[]) => void>();
  private users: PresenceUser[] = [];
  private connected = false;
  private connecting: Promise<void> | null = null;

  async connect(userId: string) {
    if (this.connected) return;

    if (this.connecting) {
      await this.connecting;
      return;
    }

    this.connecting = this.initialize(userId);

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async initialize(userId: string) {
    // Remove ONLY this channel if it already exists
    if (this.channel) {
      await supabase.removeChannel(this.channel);
      this.channel = null;
    }

    this.channel = supabase.channel("whisper-presence", {
      config: {
        presence: {
          key: userId,
        },
      },
    });

    this.channel.on(
      "presence",
      { event: "sync" },
      () => {
        if (!this.channel) return;

        const state = this.channel.presenceState();

        this.users = Object.keys(state).map((id) => ({
          id,
        }));

        this.emit();
      }
    );

    await new Promise<void>((resolve) => {
      this.channel!.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await this.channel?.track({
            online_at: new Date().toISOString(),
          });

          this.connected = true;
          resolve();
        }
      });
    });
  }

  subscribe(callback: (users: PresenceUser[]) => void) {
    this.listeners.add(callback);

    callback(this.users);

    return () => {
      this.listeners.delete(callback);
    };
  }

  getUsers() {
    return this.users;
  }

  private emit() {
    this.listeners.forEach((listener) => listener([...this.users]));
  }

  async disconnect() {
    if (this.channel) {
      await supabase.removeChannel(this.channel);
      this.channel = null;
    }

    this.connected = false;
    this.users = [];
    this.emit();
  }
}

export const presenceManager = new PresenceManager();