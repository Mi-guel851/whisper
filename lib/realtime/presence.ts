import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

export type PresenceUser = {
  id: string;
};

/**
 * Who is online, app-wide.
 *
 * A singleton because presence is one shared channel: /friends and /inbox both
 * read it, and opening a second channel with the same topic would make each
 * page see half the room.
 *
 * The previous version had two failure modes that both ended with an empty
 * "Active now" list and no way back short of a full reload:
 *
 *   1. `subscribe()`'s status callback was only handled for `SUBSCRIBED`. Any
 *      other terminal status left the connect promise pending forever, so the
 *      caller — which awaits `connect()` before registering its listener — never
 *      got as far as registering it.
 *   2. The connected flag was set once and never cleared when the socket went
 *      away, so the early-return at the top of `connect()` would then refuse to
 *      rebuild the channel for the rest of the session.
 *
 * Both are why this reads as "it worked, then it stopped". A phone browser
 * closes the WebSocket the moment the app is backgrounded, which on Capacitor is
 * routine rather than exceptional, so recovery has to be automatic: every
 * terminal status resolves the promise, drops the flag, and schedules a rebuild.
 */

const CHANNEL_TOPIC = "whisper-presence";

/** Backoff bounds for rebuilding a channel that dropped. */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * How often to re-assert our own entry. Presence state lives on the server for
 * as long as the socket does, so this is not a keepalive — it's a cheap repair
 * for the case where the socket silently survived but our `track()` didn't, which
 * leaves you visible to yourself and invisible to everyone else.
 */
const REAFFIRM_MS = 25_000;

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
  private boundToWindow = false;

  /**
   * Idempotent. Safe to call on every mount, and never throws — a page that
   * awaits this must still reach the code after it, because that is where the
   * listener gets registered.
   */
  async connect(userId: string) {
    this.userId = userId;
    this.bindToWindow();

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

  /**
   * Rebuild on the events that follow a dropped socket. Without these, presence
   * stays dead until the next hard navigation: backgrounding a phone closes the
   * connection, and coming back does not reopen it on its own.
   */
  private bindToWindow() {
    if (this.boundToWindow || typeof window === "undefined") return;
    this.boundToWindow = true;

    const repair = () => {
      if (document.visibilityState === "hidden") return;
      if (!this.userId || (this.live && this.channel)) return;
      void this.connect(this.userId);
    };

    window.addEventListener("online", repair);
    document.addEventListener("visibilitychange", repair);
  }

  /** Builds the channel and resolves once it has reached a settled state. */
  private async open() {
    const userId = this.userId;
    if (!userId) return;

    this.clearRetry();
    await this.teardownChannel();

    const channel = supabase.channel(CHANNEL_TOPIC, {
      config: { presence: { key: userId } },
    });
    this.channel = channel;

    channel.on("presence", { event: "sync" }, () => {
      /* A sync that arrives after this channel was replaced belongs to the old
         one, and applying it would overwrite the new roster with a stale copy. */
      if (this.channel !== channel) return;
      this.users = Object.keys(channel.presenceState()).map((id) => ({ id }));
      this.emit();
    });

    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      channel.subscribe(async (status) => {
        if (this.channel !== channel) return;

        if (status === "SUBSCRIBED") {
          this.live = true;
          this.attempts = 0;
          /* Re-tracked on every SUBSCRIBED, not just the first. Supabase fires
             this again after an automatic rejoin, and the rejoined channel does
             not carry the old presence payload — without re-tracking here we
             would watch everyone else while being invisible ourselves. */
          await channel.track({ online_at: new Date().toISOString() });
          this.startReaffirming();
          settle();
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          this.live = false;
          this.stopReaffirming();
          /* Resolve rather than reject: callers await this before registering
             their listener, so a rejection here would leave the page with no
             presence listener at all. Recovery is this class's problem. */
          settle();
          this.scheduleRetry();
        }
      });
    });
  }

  private scheduleRetry() {
    if (this.retryTimer || !this.userId) return;
    if (typeof window !== "undefined" && document.visibilityState === "hidden") return;

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
    if (this.reaffirmTimer || typeof window === "undefined") return;
    this.reaffirmTimer = setInterval(() => {
      if (!this.live || !this.channel) return;
      if (document.visibilityState === "hidden") return;
      void this.channel.track({ online_at: new Date().toISOString() }).catch(() => {
        /* A failed re-track means the socket is gone even though nothing told
           us. Drop the flag so the next repair actually rebuilds. */
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

  private async teardownChannel() {
    const channel = this.channel;
    this.channel = null;
    this.live = false;
    this.stopReaffirming();
    if (channel) await supabase.removeChannel(channel);
  }

  subscribe(callback: (users: PresenceUser[]) => void) {
    this.listeners.add(callback);
    callback([...this.users]);

    return () => {
      this.listeners.delete(callback);
    };
  }

  getUsers() {
    return [...this.users];
  }

  private emit() {
    const snapshot = [...this.users];
    this.listeners.forEach((listener) => listener(snapshot));
  }

  /**
   * Full teardown. Note that page unmounts should drop their listener via the
   * function returned by `subscribe()` rather than calling this — the channel is
   * shared, and tearing it down on one page's unmount would blind the others.
   */
  async disconnect() {
    this.clearRetry();
    this.userId = null;
    this.attempts = 0;
    await this.teardownChannel();
    this.users = [];
    this.emit();
  }
}

export const presenceManager = new PresenceManager();
