"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { MessageSquareQuote, ArrowUpRight } from "lucide-react";
import ShareMessageCard from "./ShareMessageCard";
import SectionLoadingBar from "./SectionLoadingBar";
import EdgeLitCard from "./EdgeLitCard";

function timeAgo(dateString: string) {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

type RecentMessage = {
  id: string;
  message: string | null;
  image_url: string | null;
  created_at: string;
};

export default function RecentMessages({ initialUserId }: { initialUserId?: string } = {}) {
  const [messages, setMessages] = useState<RecentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState<{ message: string; imageUrl: string | null } | null>(null);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    async function fetchLatest(uid: string) {
      /* Explicit columns, not `*`: 202609070001 revokes the sender_* hint
         columns from browser roles, and reads on a column-privileged table must
         name their columns — a bare `SELECT *` is rejected outright (or, when
         PostgREST prunes it, depends on whatever the grant set happens to be).
         `*` used to leave this card silently empty ("No whispers yet") for
         accounts with real messages. */
      const { data, error } = await supabase
        .from("messages")
        .select("id, message, image_url, created_at, is_read")
        .eq("recipient_id", uid)
        .order("created_at", { ascending: false })
        .limit(3);

      if (cancelled) return;
      if (error) {
        console.warn("Failed to load recent whispers:", error.message);
        return;
      }

      setMessages(data || []);
      setLoading(false);
    }

    async function load() {
      let uid = initialUserId;
      if (!uid) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        uid = session?.user.id;
      }

      if (!uid || cancelled) {
        setLoading(false);
        return;
      }

      await fetchLatest(uid);

      channel = supabase
        .channel(`recent-messages-${uid}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `recipient_id=eq.${uid}`,
          },
          (payload) => {
            const incoming = payload.new as RecentMessage;
            setMessages((prev) => {
              // 👇 Deduplicate by id before updating state
              const alreadyExists = prev.some((m) => m.id === incoming.id);
              if (alreadyExists) return prev;
              return [incoming, ...prev].slice(0, 3);
            });
          }
        )
        .subscribe((status) => {
          /* Realtime isn't replayed: a whisper that lands between the initial
             read above and the channel actually joining is otherwise invisible
             to this card until the user leaves and comes back. Refetch once
             the subscription is live to close that gap. */
          if (status === "SUBSCRIBED") void fetchLatest(uid);
        });
    }

    void load();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [initialUserId]);

  return (
    <EdgeLitCard radius="3xl" intensity={0.38} speed={19} innerClassName="p-6">
      <SectionLoadingBar loading={loading} />

      <div className="mb-4 flex items-center justify-between">
        <h2 className="section-title text-white">Latest whispers</h2>
        <Link
          href="/notifications"
          className="flex items-center gap-1 text-sm font-semibold text-cyan-400 hover:text-cyan-300"
        >
          View all
          <ArrowUpRight size={14} />
        </Link>
      </div>

      {!loading && messages.length === 0 && (
        <div className="py-6 text-center text-gray-400">No whispers yet 👻</div>
      )}

      {!loading && messages.length > 0 && (
        <div className="space-y-3">
          {messages.map((msg) => (
            <button
              key={msg.id}
              onClick={() =>
                setSharing({ message: msg.message || "", imageUrl: msg.image_url || null })
              }
              className="w-full rounded-2xl bg-white/5 p-4 text-left transition hover:bg-white/10"
            >
              {msg.message && (
                <p className="text-sm text-gray-100 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  &ldquo;{msg.message}&rdquo;
                </p>
              )}
              {!msg.message && msg.image_url && (
                <p className="text-sm text-gray-100 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  📷 Image
                </p>
              )}
              <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <MessageSquareQuote size={13} />
                  Anonymous
                </span>
                <span>{timeAgo(msg.created_at)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {sharing && (
        <ShareMessageCard
          message={sharing.message}
          imageUrl={sharing.imageUrl}
          onClose={() => setSharing(null)}
        />
      )}
    </EdgeLitCard>
  );
}