// RecentMessages.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { MessageCircle, Share2 } from "lucide-react";
import ShareMessageCard from "./ShareMessageCard";
import SectionLoadingBar from "./SectionLoadingBar";
import GlassPanel from "./GlassPanel";

export default function RecentMessages() {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState<string | null>(null);

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
        .order("created_at", { ascending: false });

      setMessages(data || []);
      setLoading(false);
    }

    load();
  }, []);

  return (
    <GlassPanel className="rounded-3xl p-6">
      <SectionLoadingBar loading={loading} />

      <h2 className="mb-6 text-2xl font-bold text-white">Recent Messages</h2>

      {!loading && messages.length === 0 && (
        <div className="text-center text-gray-400">No messages yet 👻</div>
      )}

      {!loading && messages.length > 0 && (
        <div className="space-y-3">
          {messages.map((msg) => (
            <div key={msg.id} className="rounded-2xl bg-white/5 p-4 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-cyan-300">
                  <MessageCircle size={18} />
                  Anonymous
                </div>
                <button
                  onClick={() => setSharing(msg.message || "")}
                  className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20 transition"
                >
                  <Share2 size={14} />
                  Share
                </button>
              </div>

              {msg.message && <p className="mt-2 text-gray-200">{msg.message}</p>}

              {msg.image_url && (
                <img
                  src={msg.image_url}
                  alt="Anonymous attachment"
                  className="mt-3 rounded-xl max-h-80 w-full object-cover"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {sharing && <ShareMessageCard message={sharing} onClose={() => setSharing(null)} />}
    </GlassPanel>
  );
}