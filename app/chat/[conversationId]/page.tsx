"use client";

import ChatDoodleBackground from "@/components/ChatDoodleBackground";
import MessageTicks from "@/components/MessageTicks";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import BackButton from "@/components/BackButton";
import GlassPanel from "@/components/GlassPanel";
import { UNLOCK_CHAT_COST } from "@/lib/coins";
import { useToast } from "@/components/ToastProvider";
import { Send, X, CornerUpLeft, LockKeyhole, Coins, ImagePlus, Eye, Loader2 } from "lucide-react";

type Message = {
  id: string;
  sender_id: string;
  content: string | null;
  created_at: string;
  reply_to_id: string | null;
  image_path: string | null;
  is_view_once: boolean;
  image_viewed_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
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
  onViewPhoto,
  viewingPhotoId,
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
  onViewPhoto: (msg: Message) => void;
  viewingPhotoId: string | null;
}) {
  const x = useMotionValue(0);
  const replyIconOpacity = useTransform(x, [0, SWIPE_THRESHOLD], [0, 1]);
  const isPhotoMessage = msg.is_view_once;

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
          drag={isPhotoMessage ? false : "x"}
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
          onMouseDown={() => !isPhotoMessage && startPress(msg.id)}
          onMouseUp={cancelPress}
          onMouseLeave={cancelPress}
          onTouchStart={() => !isPhotoMessage && startPress(msg.id)}
          onTouchEnd={cancelPress}
        >
          <GlassPanel
            className={`rounded-2xl px-4 py-3 select-none ${
              isMe ? "rounded-br-sm" : "rounded-bl-sm"
            }`}
          >
            {repliedMsg && (
              <div className="mb-2 border-l-2 border-cyan-400 pl-2 text-xs text-gray-400 truncate">
                {repliedMsg.content || "📷 Photo"}
              </div>
            )}

            {isPhotoMessage ? (
              msg.image_viewed_at ? (
                <p className="flex items-center gap-2 text-sm text-gray-400 italic">
                  <Eye size={14} /> Photo viewed
                </p>
              ) : isMe ? (
                <p className="flex items-center gap-2 text-sm text-gray-300">
                  <ImagePlus size={14} /> Photo sent (view once)
                </p>
              ) : (
                <button
                  onClick={() => onViewPhoto(msg)}
                  disabled={viewingPhotoId === msg.id}
                  className="flex items-center gap-2 text-sm font-bold text-cyan-200 hover:text-cyan-100 disabled:opacity-60"
                >
                  {viewingPhotoId === msg.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ImagePlus size={14} />
                  )}
                  {viewingPhotoId === msg.id ? "Loading..." : "Tap to view photo (once)"}
                </button>
              )
            ) : (
              <p className="text-sm text-gray-100 break-words">{msg.content}</p>
            )}
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

        {isMe && !isPhotoMessage && (
          <div className="mt-1 flex justify-end">
            <MessageTicks deliveredAt={msg.delivered_at} readAt={msg.read_at} />
          </div>
        )}

        {!isPhotoMessage && actionMenuFor === msg.id && (
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
  const { showToast } = useToast();
  const conversationId = params.conversationId as string;

  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [otherLabel, setOtherLabel] = useState("");
  const [input, setInput] = useState("");
  const [myId, setMyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [chatUnlocked, setChatUnlocked] = useState(false);
  const [isFriendConversation, setIsFriendConversation] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [actionMenuFor, setActionMenuFor] = useState<string | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [viewingPhotoId, setViewingPhotoId] = useState<string | null>(null);
  const [photoModalUrl, setPhotoModalUrl] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

      await supabase.rpc("ensure_coin_wallet", { target_user: session.user.id });

      const { data: wallet } = await supabase
        .from("coins")
        .select("premium_expires_at")
        .eq("user_id", session.user.id)
        .maybeSingle();
      setIsPremium(Boolean(wallet?.premium_expires_at && new Date(wallet.premium_expires_at) > new Date()));

      const otherUserId = convo.user_a === session.user.id ? convo.user_b : convo.user_a;
      const { data: friendship } = await supabase
        .from("friends")
        .select("id")
        .eq("user_id", session.user.id)
        .eq("friend_id", otherUserId)
        .maybeSingle();
      const friendConversation = Boolean(friendship);
      setIsFriendConversation(friendConversation);

      const { data: unlock } = await supabase
        .from("chat_unlocks")
        .select("id")
        .eq("user_id", session.user.id)
        .eq("conversation_id", conversationId)
        .maybeSingle();
      setChatUnlocked(Boolean(unlock));

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

      // Mark any incoming messages as delivered now that this client has loaded them.
      const incomingIds = (msgs || [])
        .filter((m) => m.sender_id !== session.user.id && !m.delivered_at)
        .map((m) => m.id);

      if (incomingIds.length > 0) {
        const { error: deliverError } = await supabase
          .from("direct_messages")
          .update({ delivered_at: new Date().toISOString() })
          .in("id", incomingIds);
        if (deliverError) {
          console.error("[chat] failed to mark delivered:", deliverError.message);
        }
      }

      // Mark as read shortly after, only if the tab is actually visible/focused.
      setTimeout(async () => {
        if (document.visibilityState !== "visible") return;
        const unreadIds = (msgs || [])
          .filter((m) => m.sender_id !== session.user.id && !m.read_at)
          .map((m) => m.id);
        if (unreadIds.length === 0) return;
        const { error: readMsgError } = await supabase
          .from("direct_messages")
          .update({ read_at: new Date().toISOString() })
          .in("id", unreadIds);
        if (readMsgError) {
          console.error("[chat] failed to mark read:", readMsgError.message);
        }
      }, 1200);

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
            const incoming = payload.new as Message;
            setMessages((prev) =>
              prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]
            );

            if (incoming.sender_id !== session.user.id) {
              supabase
                .from("direct_messages")
                .update({
                  delivered_at: new Date().toISOString(),
                  read_at:
                    document.visibilityState === "visible" ? new Date().toISOString() : null,
                })
                .eq("id", incoming.id)
                .then(({ error }) => {
                  if (error) console.error("[chat] failed to mark live message:", error.message);
                });
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "direct_messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            const updated = payload.new as Message;
            setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
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
              const incoming = payload.new as Reaction;
              setReactions((prev) =>
                prev.some(
                  (r) => r.message_id === incoming.message_id && r.user_id === incoming.user_id
                )
                  ? prev
                  : [...prev, incoming]
              );
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

  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    }, 50);
    return () => clearTimeout(timer);
  }, [messages, loading]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!chatUnlocked) {
      showToast(isFriendConversation ? "You need 40 coins to unlock this conversation." : `Unlock this chat once for ${UNLOCK_CHAT_COST} Whisper Coins to send messages.`);
      return;
    }
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

    if (error) {
      showToast(error.message);
      return;
    }

    await supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversationId);
  }

  function triggerPhotoPicker() {
    if (!chatUnlocked) {
      showToast(isFriendConversation ? "You need 40 coins to unlock this conversation." : `Unlock this chat once for ${UNLOCK_CHAT_COST} Whisper Coins first.`);
      return;
    }
    if (!isPremium) {
      showToast("View-once photos are a premium feature. Visit the Coins page to unlock premium.");
      return;
    }
    fileInputRef.current?.click();
  }

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !myId) return;

    if (!file.type.startsWith("image/")) {
      showToast("Please select an image file.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast("Image too large — max 8MB.");
      return;
    }

    setUploadingPhoto(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("view-once-photos")
        .upload(path, file, { contentType: file.type });

      if (uploadError) {
        showToast(uploadError.message);
        return;
      }

      const { error: insertError } = await supabase.from("direct_messages").insert({
        conversation_id: conversationId,
        sender_id: myId,
        content: null,
        reply_to_id: null,
        image_path: path,
        is_view_once: true,
      });

      if (insertError) {
        showToast(insertError.message);
        return;
      }

      await supabase
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversationId);
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleViewPhoto(msg: Message) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setViewingPhotoId(msg.id);
    try {
      const res = await fetch("/api/photos/view", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ messageId: msg.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "Couldn't load photo.");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPhotoModalUrl(url);
    } catch {
      showToast("Something went wrong loading the photo.");
    } finally {
      setViewingPhotoId(null);
    }
  }

  function closePhotoModal() {
    if (photoModalUrl) URL.revokeObjectURL(photoModalUrl);
    setPhotoModalUrl(null);
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

  async function unlockChat() {
    setUnlocking(true);
    const { error } = await supabase.rpc("unlock_chat_with_coins", { target_conversation_id: conversationId });
    if (error) {
      showToast(error.message);
    } else {
      setChatUnlocked(true);
      showToast("Chat unlocked permanently.");
    }
    setUnlocking(false);
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
      <main className="flex h-screen items-center justify-center theme-bg-gradient text-white">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden theme-bg-gradient text-white">
      <div className="flex-shrink-0 border-b border-white/10 p-6 pb-4">
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
        {!chatUnlocked && (
          <GlassPanel className="rounded-3xl border border-cyan-300/20 p-6 text-center shadow-2xl shadow-cyan-500/10">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300/25 to-purple-400/25">
              <LockKeyhole className="text-cyan-200" />
            </div>
            <h2 className="text-2xl font-black">Chat locked</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-gray-400">
              {isFriendConversation ? "Unlock this friend conversation once for 40 Coins to send messages. If you accepted the request, it is already unlocked." : "Unlock this anonymous conversation once to send messages normally. No per-message coin charges."}
            </p>
            <button
              onClick={unlockChat}
              disabled={unlocking}
              className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-300 via-purple-300 to-pink-300 px-5 py-3 font-black text-black shadow-lg shadow-cyan-400/20 transition active:scale-95 disabled:opacity-60"
            >
              <Coins size={18} /> {unlocking ? "Unlocking..." : `Unlock for ${UNLOCK_CHAT_COST} Coins`}
            </button>
          </GlassPanel>
        )}

        <div className="relative z-10 space-y-4">
          {!chatUnlocked && !isFriendConversation && (
            <GlassPanel className="rounded-3xl border border-cyan-300/20 p-6 text-center shadow-2xl shadow-cyan-500/10">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300/25 to-purple-400/25">
                <LockKeyhole className="text-cyan-200" />
              </div>
              <h2 className="text-2xl font-black">Chat locked</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm text-gray-400">
                {isFriendConversation ? "Accepted friends can message here for free." : "Unlock this anonymous conversation once to send messages normally. No per-message coin charges."}
              </p>
              <button
                onClick={unlockChat}
                disabled={unlocking}
                className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-300 via-purple-300 to-pink-300 px-5 py-3 font-black text-black shadow-lg shadow-cyan-400/20 transition active:scale-95 disabled:opacity-60"
              >
                <Coins size={18} /> {unlocking ? "Unlocking..." : `Unlock for ${UNLOCK_CHAT_COST} Coins`}
              </button>
            </GlassPanel>
          )}

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
                onViewPhoto={handleViewPhoto}
                viewingPhotoId={viewingPhotoId}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {replyingTo && (
        <div className="flex-shrink-0 mx-6 mb-2 flex items-center justify-between rounded-xl border-l-2 border-cyan-400 bg-white/5 px-3 py-2">
          <p className="truncate text-xs text-gray-300">
            Replying to: {replyingTo.content || "📷 Photo"}
          </p>
          <button onClick={() => setReplyingTo(null)}>
            <X size={14} className="text-gray-400" />
          </button>
        </div>
      )}

      <form onSubmit={sendMessage} className="flex-shrink-0 p-6 pt-0">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/30 p-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoSelected}
          />
          <button
            type="button"
            onClick={triggerPhotoPicker}
            disabled={uploadingPhoto}
            title={isPremium ? "Send a view-once photo" : "Premium feature — unlock in Coins"}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5 text-cyan-200 transition hover:bg-white/10 disabled:opacity-60"
          >
            {uploadingPhoto ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={chatUnlocked ? "Message anonymously..." : "Unlock chat to send messages"}
            disabled={!chatUnlocked}
            className="flex-1 bg-transparent px-3 py-2 outline-none placeholder:text-gray-500 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!chatUnlocked}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 to-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={16} className="text-black" />
          </button>
        </div>
      </form>

      {photoModalUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={closePhotoModal}
        >
          <div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={photoModalUrl}
              alt="View-once photo"
              className="max-h-[80vh] max-w-full rounded-2xl object-contain"
            />
            <p className="mt-3 text-center text-xs text-gray-400">
              This photo won&apos;t be available again after you close this view.
            </p>
            <button
              onClick={closePhotoModal}
              className="absolute -top-3 -right-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-lg"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}