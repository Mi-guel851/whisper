"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Coins, MessageCircle, Phone, Sparkles, UserPlus, X } from "lucide-react";

import { supabase } from "@/lib/supabase/client";

/**
 * The in-app notification history (the `public.notifications` table).
 *
 * WHY THIS EXISTS SEPARATELY FROM THE WHISPER INBOX ON THE SAME PAGE
 *
 * Everything the server decides to tell you — friend replied to your post, a
 * transfer landed, a call went unanswered, your friend request was accepted —
 * already lands as a row here (that table is the durable half of the
 * notification architecture; pushes are only its delivery). Until now nothing
 * rendered it: unread counts and toasts consumed the rows, and closing the
 * banner closed the record. History means you can leave the app mid-event,
 * come back a day later, and still find every alert where you left it, with
 * the unread badge agreeing.
 *
 * Click marks the row read (that is the only write this list makes — the rows
 * themselves are server-inserted and not client-writable at all, so no one
 * can forge an alert or edit one).
 */

type ActivityRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  metadata: { route?: string } | null;
  is_read: boolean;
  created_at: string;
};

const ICONS: Record<string, typeof Coins> = {
  public_feed: Sparkles,
  reply: MessageCircle,
  friend_request: UserPlus,
  coin_transfer: Coins,
  call: Phone,
  whisper: Sparkles,
  message: MessageCircle,
};

/** Only same-origin absolute-path routes; never a caller-supplied URL. */
function safeRoute(metadata: ActivityRow["metadata"]): string | null {
  const route = metadata?.route;
  if (typeof route !== "string") return null;
  return /^\/[a-zA-Z0-9_\-./?=&%]*$/.test(route) ? route : null;
}

export default function NotificationActivityList() {
  const [rows, setRows] = useState<ActivityRow[]>([]);

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase
      .from("notifications")
      .select("id,type,title,body,metadata,is_read,created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(24);
    setRows((data as ActivityRow[]) || []);
  }, []);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      await load();
      channel = supabase
        .channel(`activity-${session.user.id}-${Date.now()}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${session.user.id}` },
          () => void load()
        )
        .subscribe();
    })();
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [load]);

  async function dismiss(row: ActivityRow) {
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_read: true } : r)));
    await supabase.from("notifications").update({ is_read: true }).eq("id", row.id);
    void load();
  }

  if (rows.length === 0) return null;

  return (
    <section className="mb-6" aria-label="Recent activity">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-xs font-bold uppercase tracking-wider theme-text-subtle">Recent alerts</h2>
      </div>
      <ul className="space-y-1.5">
        {rows.map((row) => {
          const Icon = ICONS[row.type] ?? Sparkles;
          const route = safeRoute(row.metadata);
          const inner = (
            <span className="flex items-start gap-3 px-3 py-2.5">
              <span
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                  row.is_read ? "bg-white/5 theme-text-subtle" : "bg-purple-500/15 text-purple-300"
                }`}
              >
                <Icon size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[13px] ${row.is_read ? "theme-text-subtle" : "font-semibold text-white"}`}>
                  {row.title}
                </span>
                {row.body ? (
                  <span className="block truncate text-[12px] theme-text-subtle">{row.body}</span>
                ) : null}
                <span className="block text-[10px] theme-text-subtle">{formatWhen(row.created_at)}</span>
              </span>
            </span>
          );

          return (
            <li
              key={row.id}
              className="flex items-center gap-1 overflow-hidden rounded-2xl border border-white/[0.06]"
              style={{ background: "var(--theme-surface-solid)" }}
            >
              {route ? (
                <Link
                  href={route}
                  onClick={() => void dismiss(row)}
                  className="min-w-0 flex-1"
                >
                  {inner}
                </Link>
              ) : (
                <span className="min-w-0 flex-1">{inner}</span>
              )}
              <button
                type="button"
                onClick={() => void dismiss(row)}
                aria-label="Mark as read"
                className="no-press mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/50 transition hover:text-white"
              >
                <X size={13} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function formatWhen(iso: string): string {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return "";
  const diff = Date.now() - at;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}
