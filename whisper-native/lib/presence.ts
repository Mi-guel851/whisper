import { AppState } from "react-native";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "./supabase";

/**
 * Global presence — the native port of the web app's
 * `lib/realtime/presence.ts`.
 *
 * One shared realtime channel (`whisper-presence`); everyone tracks
 * `{ online_at }`, and subscribers get the id list on every sync. The DM list
 * and the friends screen both read this, which is why it is a singleton: two
 * channels tracking the same user would each double the traffic and neither
 * would agree.
 *
 * The web's repair loop is carried whole: listener-first subscribe (a channel
 * rebuild still reaches dots registered before the handshake), exponential
 * retry 1s→30s, a 25s re-affirm that re-tracks (an automatic rejoin does not
 * carry the old payload — without it we would watch everyone while being
 * invisible ourselves), and a throttled `profiles.last_active_at` stamp. The
 * browser's `online`/`visibilitychange` repair triggers become this
 * platform's AppState "active".
 */

export type PresenceUser = { id: string };

const CHANNEL_TOPIC = "whisper-presence";
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const REAFFIRM_MS = 25_000;
const ACTIVITY_STAMP_MIN_MS = 10 * 60_000;

let lastActivityStampAt = 0;

function stampActivity(userId: string) {
  const now = Date.now();
  if (now - lastActivityStampAt < ACTIVITY_STAMP_MIN_MS) return;
  lastActivityStampAt = now;
  /* Promise.resolve around the builder: PostgREST's builder thenables resolve
     to a `PromiseLike`, and `.catch` only exists on real Promises. */
  void Promise.resolve(
    supabase
      .from("profiles")
      .update({ last_active_at: new Date(now).toISOString() })
      .eq("id", userId)
  ).then(({ error }) => {
    if (error) {
      /* RLS not updated for the column, or a legacy schema — reset the
         throttle so the next attempt gets a fresh try. */
      lastActivityStampAt = 0;
    }
  });
}

class PresenceManager {
  private channel: RealtimeChannel | null = null;
  private listeners = new Set<(users: PresenceUser[]) => void>();
  private users: PresenceUser[] = [];
  private userId: string | null = null;
  private live = false;
  private opening: Promise<void> | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private reaffirmTimer: ReturnType<typeof setInterval> | null = null;
  private appStateSub: { remove(): void } | null = null;

  async connect(userId: string) {
    this.userId = userId;
    this.bindToAppState();
    if (this.live && this.channel) return;
    if (this.opening) {
      await this.opening;
      return;
    }
    this.opening = this.open();
    try {
      await this.opening;
    } finally {
      this.opening = null;
    }
  }

  subscribe(listener: (users: PresenceUser[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.users);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    for (const listener of [...this.listeners]) listener(this.users);
  }

  /** The web binds repairs to `online` + `visibilitychange`; the app's
      equivalent is coming back to the foreground. */
  private bindToAppState() {
    if (this.appStateSub) return;
    this.appStateSub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (!this.userId || (this.live && this.channel)) return;
      void this.connect(this.userId);
    });
  }

  private async open(): Promise<void> {
    const userId = this.userId;
    if (!userId) return;

    await new Promise<void>((settle) => {
      const channel = supabase.channel(CHANNEL_TOPIC, { config: { presence: { key: userId } } });

      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState() as Record<string, { online_at?: string }[]>;
          this.users = Object.keys(state).map((id) => ({ id }));
          this.emit();
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            this.live = true;
            this.attempts = 0;
            this.clearRetry();
            /* Re-track on every SUBSCRIBED — see the class comment. */
            try {
              await channel.track({ online_at: new Date().toISOString() });
            } catch {
              this.live = false;
              this.scheduleRetry();
              settle();
              return;
            }
            stampActivity(userId);
            this.startReaffirming();
            settle();
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            this.live = false;
            this.stopReaffirming();
            /* Resolve rather than reject: recovery is this class's problem. */
            settle();
            this.scheduleRetry();
          }
        });

      this.channel = channel;
    });
  }

  private scheduleRetry() {
    if (this.retryTimer || !this.userId) return;
    if (AppState.currentState === "background") return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** this.attempts);
    this.attempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.userId || this.live) return;
      void this.connect(this.userId);
    }, delay);
  }

  private clearRetry() {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private startReaffirming() {
    if (this.reaffirmTimer) return;
    this.reaffirmTimer = setInterval(() => {
      if (!this.live || !this.channel) return;
      if (AppState.currentState !== "active") return;
      if (this.userId) stampActivity(this.userId);
      void this.channel
        .track({ online_at: new Date().toISOString() })
        .catch(() => {
          this.live = false;
          this.scheduleRetry();
        });
    }, REAFFIRM_MS);
  }

  private stopReaffirming() {
    if (!this.reaffirmTimer) return;
    clearInterval(this.reaffirmTimer);
    this.reaffirmTimer = null;
  }
}

export const presenceManager = new PresenceManager();
