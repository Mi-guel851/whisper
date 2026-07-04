// app/inbox/page.tsx
"use client";

import BackButton from "@/components/BackButton";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";
import { Download } from "lucide-react";

interface Message {
  id: string;
  message: string;
  image_url: string | null;
  created_at: string;
}

export default function InboxPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    async function loadMessages() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const { data, error } = await supabase
        .from("messages")
        .select("id, message, image_url, created_at")
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

  async function downloadImage(url: string, id: string) {
    setDownloading(id);
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `whisper-image-${id}.jpg`;
      link.click();

      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Download failed", err);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#090014] via-[#170033] to-[#02000A] text-white">
      <div className="max-w-2xl mx-auto px-6 py-10 pb-28">

        <BackButton />

        <h1 className="text-5xl font-black mb-2 mt-4">
          📥 Inbox
        </h1>

        <p className="text-gray-400 mb-8">
          Anonymous messages you've received
        </p>

        {messages.length === 0 ? (
          <GlassPanel className="rounded-3xl p-10 text-center">
            <p className="text-xl">No messages yet.</p>
          </GlassPanel>
        ) : (
          <div className="space-y-6">
            {messages.map((msg) => (
              <GlassPanel
                key={msg.id}
                className="rounded-3xl p-6 shadow-xl hover:scale-[1.01] transition-all duration-300"
              >
                {msg.message && (
                  <p className="text-lg leading-8 break-words">
                    {msg.message}
                  </p>
                )}

                {msg.image_url && (
                  <div className="relative mt-4">
                    <img
                      src={msg.image_url}
                      alt="Anonymous attachment"
                      className="w-full max-h-96 rounded-2xl object-cover"
                    />
                    <button
                      onClick={() => downloadImage(msg.image_url!, msg.id)}
                      disabled={downloading === msg.id}
                      className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-black/70 backdrop-blur-md px-3 py-2 text-xs font-semibold text-white hover:bg-black/90 transition disabled:opacity-60"
                    >
                      <Download size={14} />
                      {downloading === msg.id ? "Saving..." : "Save"}
                    </button>
                  </div>
                )}

                <div className="mt-6 flex items-center justify-between text-sm text-gray-400">
                  <span>👤 Anonymous</span>
                  <span>
                    {new Date(msg.created_at).toLocaleString()}
                  </span>
                </div>
              </GlassPanel>
            ))}
          </div>
        )}

      </div>
      <BottomNavigation />
    </main>
  );
}