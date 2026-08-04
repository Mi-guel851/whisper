"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Monitor, Smartphone, Clock3 } from "lucide-react";
import BackButton from "@/components/BackButton";
import { supabase } from "@/lib/supabase/client";

type ActivityEntry = {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
  device: string;
  browser: string;
  os: string;
};

function detectDeviceInfo() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

  let device = "Desktop";
  if (/iPhone/i.test(ua)) device = "iPhone";
  else if (/iPad/i.test(ua)) device = "iPad";
  else if (/Android/i.test(ua)) device = "Android phone";
  else if (/Macintosh/i.test(ua)) device = "Mac computer";
  else if (/Windows/i.test(ua)) device = "Windows PC";
  else if (/Linux/i.test(ua)) device = "Linux device";

  let browser = "Browser";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome|CriOS/i.test(ua)) browser = "Chrome";
  else if (/Firefox/i.test(ua)) browser = "Firefox";
  else if (/Safari/i.test(ua)) browser = "Safari";
  else if (/SamsungBrowser/i.test(ua)) browser = "Samsung Internet";

  let os = "Unknown OS";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X/i.test(ua)) os = "macOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  return { device, browser, os };
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getStorageKey(userId?: string | null) {
  return userId ? `whisper-activity-log:${userId}` : "whisper-activity-log:guest";
}

export default function ActivityLogPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function syncActivity() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const deviceInfo = detectDeviceInfo();
      const now = new Date().toISOString();
      const newEntry: ActivityEntry = {
        id: `${now}-${deviceInfo.browser}`,
        title: "Successful login",
        detail: `${deviceInfo.browser} on ${deviceInfo.os} • ${deviceInfo.device}`,
        timestamp: now,
        device: deviceInfo.device,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
      };

      let storedEntries: ActivityEntry[] = [];
      const storageKey = getStorageKey(session?.user?.id);

      if (typeof window !== "undefined") {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          try {
            storedEntries = JSON.parse(raw) as ActivityEntry[];
          } catch {
            storedEntries = [];
          }
        }
      }

      const combined = [newEntry, ...storedEntries.filter((entry) => entry.id !== newEntry.id)].slice(0, 8);

      if (typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, JSON.stringify(combined));
      }

      if (isMounted) {
        setEntries(combined);
        setLoading(false);
      }
    }

    syncActivity();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        const deviceInfo = detectDeviceInfo();
        const now = new Date().toISOString();
        const entry: ActivityEntry = {
          id: `${now}-${deviceInfo.browser}`,
          title: "Successful login",
          detail: `${deviceInfo.browser} on ${deviceInfo.os} • ${deviceInfo.device}`,
          timestamp: now,
          device: deviceInfo.device,
          browser: deviceInfo.browser,
          os: deviceInfo.os,
        };

        const storageKey = getStorageKey(session.user.id);
        const existing = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
        let storedEntries: ActivityEntry[] = [];

        if (existing) {
          try {
            storedEntries = JSON.parse(existing) as ActivityEntry[];
          } catch {
            storedEntries = [];
          }
        }

        const combined = [entry, ...storedEntries.filter((item) => item.id !== entry.id)].slice(0, 8);

        if (typeof window !== "undefined") {
          window.localStorage.setItem(storageKey, JSON.stringify(combined));
        }

        if (isMounted) {
          setEntries(combined);
        }
      }
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient text-white px-4 py-16 pb-28">
      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-purple-600/20 blur-[150px]" />
      <div className="relative z-10 mx-auto max-w-xl">
        <BackButton />

        <div className="mb-6">
          <h1 className="page-title">Activity Log</h1>
          <p className="page-subtitle mt-2">
            Recent sign-ins and the device used to access your account.
          </p>
        </div>

        {loading ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
            Loading recent login activity...
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center text-sm text-gray-300">
            No login activity recorded yet.
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-purple-500/15 text-purple-300">
                    <ShieldCheck size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-white">{entry.title}</p>
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                        Login
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-300">{entry.detail}</p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-400">
                      <span className="flex items-center gap-1">
                        <Monitor size={13} />
                        {entry.device}
                      </span>
                      <span className="flex items-center gap-1">
                        <Smartphone size={13} />
                        {entry.browser}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock3 size={13} />
                        {formatTimestamp(entry.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}