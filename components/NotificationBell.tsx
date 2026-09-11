"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Coins, MessageCircle, Phone, Sparkles, Users } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useNotifications } from "./NotificationProvider";

/**
 * The bell, grown into its own control surface.
 *
 * It used to be a plain link to /notifications. It is now a switchboard: the
 * master "App Notifications" toggle plus the five category toggles the
 * notification triggers actually honour (`push_notifications`,
 * `notify_feed_posts`, `notify_replies`, `notify_friend_requests`,
 * `notify_coin_transfers`, `notify_calls` on `profiles`). Every toggle saves
 * immediately — the Supabase client update is a PATCH against the profile row.
 *
 * Same keys, same NULL-means-on semantics, same optimistic-with-rollback
 * writes as NotificationSettingsCard (the settings-screen version): the two
 * are different windows onto the same row, and a toggle flipped here reflects
 * there on next visit because both read the database, not each other.
 *
 * PRESENTATION
 *
 * Desktop: an inline dropdown anchored under the bell. Mobile: the same panel
 * becomes a bottom sheet (see `.notif-bell-panel` in globals.css), because a
 * 320px dropdown hanging off a top-right icon is a gesture trap on a phone.
 * Escape and outside-tap both close it; "View all notifications" at the foot
 * keeps the old destination one tap away.
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

const PREF_KEYS = Object.keys(DEFAULTS) as PrefKey[];

const CATEGORIES: { key: Exclude<PrefKey, "push_notifications">; label: string; icon: typeof Coins }[] = [
  { key: "notify_feed_posts", label: "Feed posts", icon: Sparkles },
  { key: "notify_replies", label: "Replies", icon: MessageCircle },
  { key: "notify_friend_requests", label: "Friend requests", icon: Users },
  { key: "notify_coin_transfers", label: "Coin transfers", icon: Coins },
  { key: "notify_calls", label: "Calls", icon: Phone },
];

function Switch({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      disabled={disabled}
      className={`notif-switch ${checked ? "is-on" : ""}`}
    >
      <span className="notif-switch-knob" />
    </button>
  );
}

export default function NotificationBell() {
  const { unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<PrefKey | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  /* Prefs load once, on mount — not on open — so the panel never flashes
     default-ON switches for a user who muted everything. */
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
        for (const key of PREF_KEYS) {
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

  /* Outside-tap and Escape close the panel. */
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

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
      return;
    }
    /* Turning the master switch on must re-register this device, or the flag
       says yes while no token ever reaches the push senders. */
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

  const busy = !loaded || saving !== null;

  return (
    <div ref={wrapRef} className="notif-bell-wrap">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={open ? "Close notification settings" : "Open notification settings"}
        className="dashboard-top-action notif-bell-btn"
      >
        <Bell size={18} />
        {unreadCount > 0 && <span>{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {open && (
        <>
          {/* Mobile only (display:none on desktop): catches outside taps so
              they close the sheet instead of activating the page beneath it. */}
          <div className="notif-bell-scrim" aria-hidden="true" onClick={() => setOpen(false)} />
          <div className="notif-bell-panel" role="dialog" aria-label="Notification settings">
          <p className="notif-bell-title">Notifications</p>

          <div className="notif-bell-row notif-bell-master">
            <span className="notif-bell-label">
              <strong>App Notifications</strong>
              <small>Master switch for device alerts</small>
            </span>
            <Switch
              checked={prefs.push_notifications && loaded}
              disabled={busy}
              label="App Notifications"
              onToggle={() => void toggle("push_notifications")}
            />
          </div>

          <div className={`notif-bell-categories ${prefs.push_notifications ? "" : "is-muted"}`}>
            {CATEGORIES.map((category) => (
              <div key={category.key} className="notif-bell-row">
                <span className="notif-bell-label">
                  <category.icon size={15} aria-hidden />
                  <strong>{category.label}</strong>
                </span>
                <Switch
                  checked={prefs[category.key] && loaded}
                  disabled={busy || !prefs.push_notifications}
                  label={category.label}
                  onToggle={() => void toggle(category.key)}
                />
              </div>
            ))}
          </div>

          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="notif-bell-all"
          >
            View all notifications
          </Link>
          </div>
        </>
      )}
    </div>
  );
}
