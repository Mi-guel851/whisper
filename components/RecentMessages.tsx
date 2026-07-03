"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

interface Message {
  id: string;
  message: string;
  created_at: string;
}

export default function RecentMessages() {
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    async function loadMessages() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const { data } = await supabase
        .from("messages")
        .select("id,message,created_at")
        .eq("recipient_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(5);

      setMessages(data || []);
    }

    loadMessages();
  }, []);

  return (
    <div className="mt-8 rounded-3xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">

      <h2 className="mb-6 text-2xl font-bold text-white">
        Recent Messages
      </h2>

      {messages.length === 0 ? (
        <p className="text-gray-400">No messages yet.</p>
      ) : (
        <div className="space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className="rounded-2xl bg-black/20 p-4"
            >
              <p className="text-white">{msg.message}</p>

              <p className="mt-2 text-xs text-gray-500">
                {new Date(msg.created_at).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}