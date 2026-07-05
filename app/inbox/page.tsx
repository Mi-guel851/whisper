"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";
import { MessageCircle } from "lucide-react";

type ConversationRow = {
  id: string;
  user_a: string;
  user_b: string;
  user_a_label: string;
  user_b_label: string;
  last_message_at: string;
};

export default function InboxPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [myId, setMyId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setLoading(false);
        return;
      }

      setMyId(session.user.id);

      const { data } = await supabase
        .from("conversations")
        .select("*")
        .or(`user_a.eq.${session.user.id},user_b.eq.${session.user.id}`)
        .order("last_message_at", { ascending: false });

      setConversations(data || []);
      setLoading(false);
    }

    load();
  }, []);

  function labelFor(c: ConversationRow) {
    return c.user_a === myId ? c.user_a_label : c.user_b_label;
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#090014] text-white">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#090014] via-[#170033] to-[#02000A] text-white">
      <div className="max-w-2xl mx-auto px-6 py-10 pb-28">
        <BackButton />

        <h1 className="text-5xl font-black mb-2 mt-4">💬 Inbox</h1>
        <p className="text-gray-400 mb-8">Your anonymous conversations</p>

        {conversations.length === 0 ? (
          <GlassPanel className="rounded-3xl p-10 text-center">
            <p className="text-xl">No conversations yet.</p>
            <p className="mt-2 text-sm text-gray-400">
              Go to Friends to find someone active and start chatting.
            </p>
          </GlassPanel>
        ) : (
          <div className="space-y-3">
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => router.push(`/chat/${c.id}`)}
                className="w-full text-left"
              >
                <GlassPanel className="flex items-center gap-4 rounded-2xl p-4 transition hover:bg-white/[0.09]">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-purple-600">
                    <MessageCircle size={20} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-white">{labelFor(c)}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(c.last_message_at).toLocaleString()}
                    </p>
                  </div>
                </GlassPanel>
              </button>
            ))}
          </div>
        )}
      </div>

      <BottomNavigation />
    </main>
  );
}