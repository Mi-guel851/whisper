"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";

type Conversation = {
  id: string;
  user_a: string;
  user_b: string;
  user_a_label: string;
  user_b_label: string;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_id: string | null;
};

export default function InboxPage() {
  const router = useRouter();

  const [me, setMe] = useState("");
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setLoading(false);
        return;
      }

      setMe(session.user.id);

      const { data } = await supabase
        .from("conversations")
        .select("*")
        .or(`user_a.eq.${session.user.id},user_b.eq.${session.user.id}`)
        .order("last_message_at", {
          ascending: false,
          nullsFirst: false,
        });

      setConversations(data || []);
      setLoading(false);

      channel = supabase
        .channel(`conversation-list-${session.user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
           table: "conversations",
filter: `user_a=eq.${session.user.id}`,
          },
          async () => {
            const { data } = await supabase
              .from("conversations")
              .select("*")
              .or(`user_a.eq.${session.user.id},user_b.eq.${session.user.id}`)
              .order("last_message_at", {
                ascending: false,
                nullsFirst: false,
              });

            setConversations(data || []);
          }
        )
        .subscribe();
    }

    load();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#090014] via-[#170033] to-[#02000A] text-white pb-28">

      <div className="mx-auto max-w-2xl px-6 py-8">

        <BackButton />

        <h1 className="mt-5 text-5xl font-black">
          💬 Chats
        </h1>

        <p className="mt-2 text-gray-400">
          Anonymous conversations
        </p>

        {loading ? (

          <p className="mt-10 text-gray-500">
            Loading...
          </p>

        ) : conversations.length === 0 ? (

          <GlassPanel className="mt-10 rounded-3xl p-10 text-center">

            <p className="text-xl font-semibold">
              No conversations yet
            </p>

            <p className="mt-2 text-gray-400">
              Visit Active Users to start chatting.
            </p>

          </GlassPanel>

        ) : (

          <div className="mt-8 space-y-3">

            {conversations.map((chat) => {

              const otherLabel =
                chat.user_a === me
                  ? chat.user_b_label
                  : chat.user_a_label;

              return (

                <button
                  key={chat.id}
                  onClick={() => router.push(`/chat/${chat.id}`)}
                  className="w-full text-left"
                >

                  <GlassPanel className="rounded-3xl p-5 transition hover:scale-[1.01] hover:bg-white/5">

                    <div className="flex items-center gap-4">

                      <div className="relative">

                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-purple-600 text-2xl">

                          👻

                        </div>

                        <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[#090014] bg-green-400" />

                      </div>

                      <div className="min-w-0 flex-1">

                        <div className="flex items-center justify-between">

                          <h2 className="truncate text-lg font-bold">
                            {otherLabel}
                          </h2>

                          {chat.last_message_at && (

                            <span className="text-xs text-gray-500">

                              {new Date(
                                chat.last_message_at
                              ).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}

                            </span>

                          )}

                        </div>

                        <p className="mt-1 truncate text-sm text-gray-400">

                          {chat.last_message || "Start chatting..."}

                        </p>

                      </div>

                    </div>

                  </GlassPanel>

                </button>

              );
            })}

          </div>

        )}

      </div>

      <BottomNavigation />

    </main>
  );
}