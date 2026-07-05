"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { chatManager, ChatMessage } from "@/lib/realtime/chat";
import { typingManager } from "@/lib/realtime/typing";
import BottomNavigation from "@/components/BottomNavigation";
import BackButton from "@/components/BackButton";
import GlassPanel from "@/components/GlassPanel";
import { Send } from "lucide-react";

export default function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [myId, setMyId] = useState("");
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState(false);
  const [lastSeen, setLastSeen] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unsubChat: (() => void) | undefined;
    let unsubTyping: (() => void) | undefined;

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      setMyId(session.user.id);

      const { data } = await supabase
        .from("direct_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", {
          ascending: true,
        });

      setMessages((data as ChatMessage[]) || []);

      unsubChat = chatManager.subscribe(
        conversationId,
        (message) => {
          setMessages((prev) => {
            if (prev.find((m) => m.id === message.id)) return prev;
            return [...prev, message];
          });
        }
      );

      unsubTyping = typingManager.subscribe(
        conversationId,
        session.user.id,
        (state) => setTyping(state)
      );

      await supabase
        .from("direct_messages")
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq("conversation_id", conversationId)
        .neq("sender_id", session.user.id);

      const { data: convo } = await supabase
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

      if (convo) {
        const other =
          convo.user_a === session.user.id
            ? convo.user_b
            : convo.user_a;

        const { data: profile } = await supabase
          .from("profiles")
          .select("is_online,last_seen")
          .eq("id", other)
          .single();

        if (profile) {
          setOnline(profile.is_online);
          if (profile.last_seen) {
            setLastSeen(
              new Date(profile.last_seen).toLocaleString()
            );
          }
        }
      }
    }

    init();

    return () => {
      unsubChat?.();
      unsubTyping?.();
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  async function send() {
    if (!input.trim()) return;

    const text = input.trim();

    setSending(true);
    setInput("");

    await typingManager.setTyping(
      conversationId,
      myId,
      false
    );

    const { error } = await supabase
      .from("direct_messages")
      .insert({
        conversation_id: conversationId,
        sender_id: myId,
        content: text,
      });

    if (!error) {
      await supabase
        .from("conversations")
        .update({
          last_message: text,
          last_sender_id: myId,
          last_message_at: new Date().toISOString(),
        })
        .eq("id", conversationId);
    }

    setSending(false);
  }

  async function onTyping(value: string) {
    setInput(value);

    await typingManager.setTyping(
      conversationId,
      myId,
      value.length > 0
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#090014] via-[#150028] to-[#030008] text-white pb-28">

      <div className="sticky top-0 z-30 border-b border-white/10 bg-[#090014]/90 backdrop-blur-xl">

        <div className="p-6">

          <BackButton />

          <h1 className="mt-4 text-3xl font-black">
            Anonymous Chat
          </h1>

          {typing ? (
            <p className="text-sm text-cyan-400">
              typing...
            </p>
          ) : online ? (
            <p className="text-sm text-green-400">
              ● Online
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              Last seen {lastSeen || "recently"}
            </p>
          )}

        </div>

      </div>

      <div className="space-y-3 px-6 py-6 pb-44">

        {messages.map((msg) => {

          const mine = msg.sender_id === myId;

          return (

            <div
              key={msg.id}
              className={`flex ${
                mine
                  ? "justify-end"
                  : "justify-start"
              }`}
            >

              <GlassPanel
                className={`max-w-[78%] rounded-3xl p-4 ${
                  mine
                    ? "border-cyan-500/20"
                    : "border-purple-500/20"
                }`}
              >

                <p className="whitespace-pre-wrap break-words">
                  {msg.content}
                </p>

                <div className="mt-3 flex justify-end gap-2">

                  <span className="text-[10px] text-gray-500">
                    {new Date(msg.created_at).toLocaleTimeString([],{
                      hour:"2-digit",
                      minute:"2-digit"
                    })}
                  </span>

                  {mine && (
                    <span className="text-[10px] text-cyan-400">
                      ✓✓
                    </span>
                  )}

                </div>

              </GlassPanel>

            </div>

          );

        })}

        <div ref={bottomRef} />

      </div>

      <div className="fixed bottom-20 left-0 right-0 px-6">

        <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-black/40 p-3 backdrop-blur-xl">

          <input
            value={input}
            onChange={(e)=>onTyping(e.target.value)}
            onBlur={()=>typingManager.setTyping(conversationId,myId,false)}
            placeholder="Write anonymously..."
            className="flex-1 bg-transparent outline-none placeholder:text-gray-500"
          />

          <button
            disabled={sending}
            onClick={send}
            className="rounded-full bg-gradient-to-r from-cyan-400 to-purple-500 p-3 disabled:opacity-50"
          >
            <Send size={18}/>
          </button>

        </div>

      </div>

      <BottomNavigation />

    </main>
  );
}