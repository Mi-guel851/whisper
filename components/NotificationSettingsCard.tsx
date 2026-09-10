"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Bell, BellOff, Coins, MessageCircle, Phone, Sparkles, Users } from "lucide-react";

import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { spring } from "@/lib/motion";

/**
 * The notification switches.
 *
 * WHY THE CATEGORIES EXIST (server: profiles columns + 202609100004)
 *
 * Every exclusion rule the notification triggers apply — "users who disabled
 * that category" — needs a control, or it is a promise with no off-ramp. The
 * five categories match the five opt-outs the SQL actually checks: friend
 * posts, replies, friend requests, coin receipts, calls. The global switch is
 * the existing `push_notifications` column every push path already honours.
 *
 * Defaults read as ON because NULL means on (`is distinct from false` in SQL,
 * `!== false` here) — profiles predating the migration keep receiving what
 * they always did instead of being silently muted by a missing column.
 *
 * Writes are optimistic with rollback: a switch that lies about the saved
 * state is worse than a switch that takes a beat.
 */

type PrefKey =
  | "push_notifications"
  | "notify_feed_posts"
  | "notify_replies"
  | "notify_friend_requests"
  | "notify_coin_transfers"
  | "notify_calls";

type Prefs = Record<PrefKey, boolean>;

const DEFAULTS: Prefs = {
  push_notifications: true,
  notify_feed_posts: true,
  notify_replies: true,
  notify_friend_requests: true,
  notify_coin_transfers: true,
  notify_calls: true,
};

const CATEGORIES: { key: PrefKey; label: string; hint: string; icon: typeof Coins }[] = [
  { key: "notify_feed_posts", label: "Friends' public posts", hint: "When an accepted friend publishes to the feed", icon: Sparkles },
  { key: "notify_replies", label: "Replies", hint: "When someone answers your post or one of your replies", icon: MessageCircle },
  { key: "notify_friend_requests", label: "Friend requests", hint: "New requests and acceptances", icon: Users },
  { key: "notify_coin_transfers", label: "Coin transfers", hint: "When a transfer lands in your wallet", icon: Coins },
  { key: "notify_calls", label: "Voice calls", hint: "Incoming rings and missed-call alerts", icon: Phone },
];

export default function NotificationSettingsCard() {
  const reduced = useSafeReducedMotion();
  const { showToast } = useToast();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<PrefKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user.id;
      if (!userId || cancelled) return;
      const { data: row } = await supabase
        .from("profiles")
        .select(
          "push_notifications,notify_feed_posts,notify_replies,notify_friend_requests,notify_coin_transfers,notify_calls"
        )
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (row) {
        const next = { ...DEFAULTS };
        for (const key of Object.keys(DEFAULTS) as PrefKey[]) {
          const value = (row as Record<string, boolean | null>)[key];
          next[key] = value !== false;
        }
        setPrefs(next);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(key: PrefKey) {
    if (!loaded || saving) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user.id;
    if (!userId) return;

    const next = !prefs[key];
    setPrefs((prev) => ({ ...prev, [key]: next }));
    setSaving(key);
    const { error } = await supabase.from("profiles").update({ [key]: next }).eq("id", userId);
    setSaving(null);
    if (error) {
      setPrefs((prev) => ({ ...prev, [key]: !next }));
      showToast("Couldn't save that setting. Please try again.");
      return;
    }
    /* Turning the global switch on must actually re-register this device —
       otherwise the profile flag says yes while no token ever reaches the
       push senders, which is how "enabled but silent" gets filed as a bug. */
    if (key === "push_notifications" && next && navigator.onLine) {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const { Capacitor } = await import("@capacitor/core");
        if (Capacitor.isNativePlatform()) await PushNotifications.register();
      } catch {
        /* Web or plugin absent: web push registration runs on its own hook. */
      }
    }
  }

  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3 py-1.5 px-1">
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-purple-300">
            {prefs.push_notifications ? <Bell size={17} /> : <BellOff size={17} />}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-white">Push notifications</span>
            <span className="block text-[11px] theme-text-subtle">
              Device alerts for everything below. Lock-screen previews never include message contents you&apos;ve marked private.
            </span>
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={prefs.push_notifications && loaded}
          aria-label="Push notifications"
          onClick={() => void toggle("push_notifications")}
          disabled={!loaded || saving !== null}
          className={`no-press relative box-border h-6 w-11 shrink-0 rounded-full border-0 p-0 transition-colors disabled:opacity-50 ${
            prefs.push_notifications && loaded ? "bg-purple-500" : "bg-white/15"
          }`}
        >
          <motion.span
            className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow"
            animate={{ x: prefs.push_notifications && loaded ? 20 : 0 }}
            transition={reduced ? { duration: 0 } : spring.snappy}
          />
        </button>
      </div>

      {prefs.push_notifications ? (
        <div className="mt-1 space-y-0.5 border-l border-white/10 pl-3">
          {CATEGORIES.map((category) => (
            <div key={category.key} className="flex items-center justify-between gap-3 py-2 px-1">
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 theme-text-subtle">
                  <category.icon size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-white">{category.label}</span>
                  <span className="block truncate text-[11px] theme-text-subtle">{category.hint}</span>
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={prefs[category.key] && loaded}
                aria-label={category.label}
                onClick={() => void toggle(category.key)}
                disabled={!loaded || saving !== null}
                className={`no-press relative box-border h-6 w-11 shrink-0 rounded-full border-0 p-0 transition-colors disabled:opacity-50 ${
                  prefs[category.key] && loaded ? "bg-purple-500" : "bg-white/15"
                }`}
              >
                <motion.span
                  className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow"
                  animate={{ x: prefs[category.key] && loaded ? 20 : 0 }}
                  transition={reduced ? { duration: 0 } : spring.snappy}
                />
              </button>
            </div>
          ))}
          {saving && <p className="px-1 pb-1 text-[11px] theme-text-subtle">Saving…</p>}
        </div>
      ) : (
        <p className="px-1 pb-1 text-[11px] theme-text-subtle">
          Mutes device alerts. Friend posts, replies, requests, transfers and calls also stop
          being recorded; messages and whispers still collect in your Activity history.
        </p>
      )}
    </div>
  );
}
