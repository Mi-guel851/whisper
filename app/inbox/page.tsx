"use client";

import BackButton from "@/components/BackButton";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import BottomNavigation from "@/components/BottomNavigation";

interface Message {
  id: string;
  message: string;
  created_at: string;
}

export default function InboxPage() {
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    async function loadMessages() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const { data, error } = await supabase
        .from("messages")
        .select("id, message, created_at")
        .eq("recipient_id", session.user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error(error);
        return;
      }

      setMessages(data || []);
    }

    loadMessages();
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#090014] via-[#170033] to-[#02000A] text-white">
      <div className="max-w-2xl mx-auto px-6 py-10">

        <h1 className="text-5xl font-bold mb-2">
          📥 Inbox
        </h1>

        <p className="text-gray-400 mb-8">
          Anonymous messages you've received
        </p>

        {messages.length === 0 ? (
          <div className="rounded-3xl bg-white/10 backdrop-blur-xl border border-white/10 p-10 text-center">
            <p className="text-xl">No messages yet.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className="rounded-3xl border border-white/10 bg-white/10 backdrop-blur-xl p-6 shadow-xl hover:scale-[1.02] transition-all duration-300"
              >
                <p className="text-lg leading-8 break-words">
                  {msg.message}
                </p>

                <div className="mt-6 flex items-center justify-between text-sm text-gray-400">
                  <span>👤 Anonymous</span>
                  <span>
                    {new Date(msg.created_at).toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
      <BottomNavigation />
      <BackButton />
    </main>
  );
}