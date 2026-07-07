"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { MessageSquareQuote, ArrowUpRight } from "lucide-react";
import ShareMessageCard from "./ShareMessageCard";
import SectionLoadingBar from "./SectionLoadingBar";
import GlassPanel from "./GlassPanel";

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

export default function RecentMessages() {
  const [messages, setMessages] = useState<RecentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState<{ message: string; imageUrl: string | null } | null>(null);

  useEffect(() => {
    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("recipient_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(3);

      setMessages(data || []);
      setLoading(false);
    }

    load();
  }, []);

  return (
    <GlassPanel className="rounded-3xl p-6">
      <SectionLoadingBar loading={loading} />

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Latest whispers</h2>
        <Link
          href="/notifications"
          className="flex items-center gap-1 text-sm font-semibold text-purple-300 hover:text-purple-200"
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
                <p className="text-sm text-gray-100">&ldquo;{msg.message}&rdquo;</p>
              )}
              {!msg.message && msg.image_url && (
                <p className="text-sm text-gray-100">📷 Image</p>
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
    </GlassPanel>
  );
}
