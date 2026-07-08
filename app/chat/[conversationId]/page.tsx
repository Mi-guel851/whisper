"use client";

import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import BackButton from "@/components/BackButton";
import GlassPanel from "@/components/GlassPanel";
import { Send, X, CornerUpLeft } from "lucide-react";

type Message = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  reply_to_id: string | null;
};

type Reaction = {
  message_id: string;
  user_id: string;
  emoji: string;
};

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const SWIPE_THRESHOLD = 80;

function MessageBubble({
  msg,
  isMe,
  repliedMsg,
  msgReactions,
  actionMenuFor,
  setActionMenuFor,
  toggleReaction,
  setReplyingTo,
  startPress,
  cancelPress,
  onSwipeReply,
}: {
  msg: Message;
  isMe: boolean;
  repliedMsg: Message | null;
  msgReactions: Record<string, number>;
  actionMenuFor: string | null;
  setActionMenuFor: (id: string | null) => void;
  toggleReaction: (messageId: string, emoji: string) => void;
  setReplyingTo: (msg: Message | null) => void;
  startPress: (id: string) => void;
  cancelPress: () => void;
  onSwipeReply: (msg: Message) => void;
}) {
  const x = useMotionValue(0);
  const replyIconOpacity = useTransform(x, [0, SWIPE_THRESHOLD], [0, 1]);

  return (
    <div className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
      <div className="relative max-w-[75%]">
        <motion.div
          className="absolute left-2 top-1/2 -translate-y-1/2 text-cyan-400 pointer-events-none"
          style={{ opacity: replyIconOpacity }}
        >
          <CornerUpLeft size={18} />
        </motion.div>

        <motion.div
          style={{ x }}
          drag="x"
          dragDirectionLock
          dragConstraints={{ left: 0, right: 90 }}
          dragElastic={0.15}
          whileTap={{ scale: 0.98 }}
          onDragEnd={(_e, info) => {
            if (info.offset.x > SWIPE_THRESHOLD) {
              navigator.vibrate?.(20);
              onSwipeReply(msg);
            }
            animate(x, 0, { type: "spring", stiffness: 500, damping: 40 });
          }}
          onMouseDown={() => startPress(msg.id)}
          onMouseUp={cancelPress}
          onMouseLeave={cancelPress}
          onTouchStart={() => startPress(msg.id)}
          onTouchEnd={cancelPress}
        >
          <GlassPanel
            className={`rounded-2xl px-4 py-3 select-none ${
              isMe ? "rounded-br-sm" : "rounded-bl-sm"
            }`}
          >
            {repliedMsg && (
              <div className="mb-2 border-l-2 border-cyan-400 pl-2 text-xs text-gray-400 truncate">
                {repliedMsg.content}
              </div>
            )}
            <p className="text-sm text-gray-100 break-words">{msg.content}</p>
          </GlassPanel>
        </motion.div>

        {Object.keys(msgReactions).length > 0 && (
          <div className={`mt-1 flex gap-1 ${isMe ? "justify-end" : "justify-start"}`}>
            {Object.entries(msgReactions).map(([emoji, count]) => (
              <span key={emoji} className="rounded-full bg-white/10 px-2 py-0.5 text-xs">
                {emoji} {count > 1 ? count : ""}
              </span>
            ))}
          </div>
        )}

        {actionMenuFor === msg.id && (
          <div className={`absolute z-20 -top-14 ${isMe ? "right-0" : "left-0"}`}>
            <GlassPanel strong className="flex items-center gap-1 rounded-full px-2 py-2">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => toggleReaction(msg.id, emoji)}
                  className="text-lg hover:scale-125 transition"
                >
                  {emoji}
                </button>
              ))}
              <button
                onClick={() => {
                  setReplyingTo(msg);
                  setActionMenuFor(null);
                }}
                className="ml-1 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
              >
                <CornerUpLeft size={14} />
              </button>
              <button
                onClick={() => setActionMenuFor(null)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
              >
                <X size={14} />
              </button>
            </GlassPanel>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const conversationId = params.conversationId as string;

  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [otherLabel, setOtherLabel] = useState("");
  const [input, setInput] = useState("");
  const [myId, setMyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [actionMenuFor, setActionMenuFor] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let msgChannel: ReturnType<typeof supabase.channel> | null = null;
    let reactionChannel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      setMyId(session.user.id);

      const { data: convo } = await supabase
        .from("conversations")
        .select("user_a, user_b, user_a_label, user_b_label")
        .eq("id", conversationId)
        .single();

      if (!convo) {
        router.push("/active");
        return;
      }

      const readColumn =
        convo.user_a === session.user.id ? "user_a_last_read_at" : "user_b_last_read_at";
      const { error: readError } = await supabase
        .from("conversations")
        .update({ [readColumn]: new Date().toISOString() })
        .eq("id", conversationId);

      if (readError) {
        console.error("[chat] failed to mark conversation as read:", readError.message);
      }

      const label = convo.user_a === session.user.id ? convo.user_a_label : convo.user_b_label;
      setOtherLabel(label);

      const { data: msgs } = await supabase
        .from("direct_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      setMessages(msgs || []);

      const { data: reacts } = await supabase
        .from("message_reactions")
        .select("message_id, user_id, emoji")
        .in("message_id", (msgs || []).map((m) => m.id));

      setReactions(reacts || []);
      setLoading(false);

      msgChannel = supabase
        .channel(`chat-msgs-${conversationId}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "direct_messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            setMessages((prev) => [...prev, payload.new as Message]);
          }
        )
        .subscribe();

      reactionChannel = supabase
        .channel(`chat-reactions-${conversationId}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "message_reactions",
          },
          (payload) => {
            if (payload.eventType === "INSERT") {
              setReactions((prev) => [...prev, payload.new as Reaction]);
            }

            if (payload.eventType === "UPDATE") {
              setReactions((prev) =>
                prev.map((r) =>
                  r.message_id === (payload.new as Reaction).message_id &&
                  r.user_id === (payload.new as Reaction).user_id
                    ? (payload.new as Reaction)
                    : r
                )
              );
            }

            if (payload.eventType === "DELETE") {
              setReactions((prev) =>
                prev.filter(
                  (r) =>
                    !(
                      r.message_id === (payload.old as Partial<Reaction>).message_id &&
                      r.user_id === (payload.old as Partial<Reaction>).user_id
                    )
                )
              );
            }
          }
        )
        .subscribe();
    }

    init();

    return () => {
      if (msgChannel) supabase.removeChannel(msgChannel);
      if (reactionChannel) supabase.removeChannel(reactionChannel);
    };
  }, [conversationId, router]);

  // Auto-scroll to the latest message.
  // Depends on both `messages` (new message arrives) AND `loading`
  // (the message list — and therefore messagesContainerRef — doesn't
  // exist in the DOM until loading flips to false, so we need this
  // effect to re-run at that point too, or the very first scroll
  // never happens).
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }, [messages, loading]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || !myId) return;

    setInput("");
    const replyId = replyingTo?.id || null;
    setReplyingTo(null);

    const { error } = await supabase.from("direct_messages").insert({
      conversation_id: conversationId,
      sender_id: myId,
      content: trimmed,
      reply_to_id: replyId,
    });

    if (!error) {
      await supabase
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversationId);
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    setActionMenuFor(null);

    const existing = reactions.find(
      (r) => r.message_id === messageId && r.user_id === myId
    );

    if (existing && existing.emoji === emoji) {
      await supabase
        .from("message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", myId);
      setReactions((prev) =>
        prev.filter((r) => !(r.message_id === messageId && r.user_id === myId))
      );
    } else {
      await supabase.from("message_reactions").upsert(
        { message_id: messageId, user_id: myId, emoji },
        { onConflict: "message_id,user_id" }
      );
      setReactions((prev) => [
        ...prev.filter((r) => !(r.message_id === messageId && r.user_id === myId)),
        { message_id: messageId, user_id: myId, emoji },
      ]);
    }
  }

  function getReactionsFor(messageId: string) {
    const grouped: Record<string, number> = {};
    reactions
      .filter((r) => r.message_id === messageId)
      .forEach((r) => {
        grouped[r.emoji] = (grouped[r.emoji] || 0) + 1;
      });
    return grouped;
  }

  function getRepliedMessage(replyToId: string | null) {
    if (!replyToId) return null;
    return messages.find((m) => m.id === replyToId) || null;
  }

  function startPress(messageId: string) {
    pressTimer.current = setTimeout(() => {
      setActionMenuFor(messageId);
    }, 450);
  }

  function cancelPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center theme-bg-gradient text-white">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col theme-bg-gradient text-white">
      <div className="border-b border-white/10 p-6 pb-4">
        <BackButton />
        <div className="mt-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-purple-600">
            👻
          </div>
          <div>
            <p className="font-bold text-white">{otherLabel}</p>
            <p className="text-xs text-gray-400">Anonymous chat</p>
          </div>
        </div>
      </div>

      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
        {messages.length === 0 ? (
          <p className="mt-10 text-center text-gray-500">
            Say hi 👻 — they won&apos;t know who you are.
          </p>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isMe={msg.sender_id === myId}
              repliedMsg={getRepliedMessage(msg.reply_to_id)}
              msgReactions={getReactionsFor(msg.id)}
              actionMenuFor={actionMenuFor}
              setActionMenuFor={setActionMenuFor}
              toggleReaction={toggleReaction}
              setReplyingTo={setReplyingTo}
              startPress={startPress}
              cancelPress={cancelPress}
              onSwipeReply={setReplyingTo}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {replyingTo && (
        <div className="mx-6 mb-2 flex items-center justify-between rounded-xl border-l-2 border-cyan-400 bg-white/5 px-3 py-2">
          <p className="truncate text-xs text-gray-300">
            Replying to: {replyingTo.content}
          </p>
          <button onClick={() => setReplyingTo(null)}>
            <X size={14} className="text-gray-400" />
          </button>
        </div>
      )}

      <form onSubmit={sendMessage} className="p-6 pt-0">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/30 p-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message anonymously..."
            className="flex-1 bg-transparent px-3 py-2 outline-none placeholder:text-gray-500"
          />
          <button
            type="submit"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 to-purple-500"
          >
            <Send size={16} className="text-black" />
          </button>
        </div>
      </form>
    </main>
  );
}