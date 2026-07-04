"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { MessageCircle } from "lucide-react";

export default function RecentMessages() {
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("recipient_id", session.user.id)
        .order("created_at", { ascending: false });

      setMessages(data || []);
    }

    load();
  }, []);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-2xl">

      <h2 className="mb-6 text-2xl font-bold text-white">
        Recent Messages
      </h2>

      {messages.length === 0 ? (
        <div className="text-center text-gray-400">
          No messages yet 👻
        </div>
      ) : (
        <div className="space-y-3">

          {messages.map((msg) => (
            <div
              key={msg.id}
              className="rounded-2xl bg-white/5 p-4 text-white"
            >
              <div className="flex items-center gap-2 text-cyan-300">
                <MessageCircle size={18} />
                Anonymous
              </div>

              <p className="mt-2 text-gray-200">
                {msg.message}
              </p>

            </div>
          ))}

        </div>
      )}

    </div>
  );
}