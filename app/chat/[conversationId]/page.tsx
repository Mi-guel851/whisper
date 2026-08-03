"use client";

import ChatDoodleBackground from "@/components/ChatDoodleBackground";
import MessageTicks from "@/components/MessageTicks";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import GlassPanel from "@/components/GlassPanel";
import { UNLOCK_CHAT_COST, SEND_IMAGE_COST } from "@/lib/coins";
import { anonymousDisplayName } from "@/lib/anonymousIdentity";
import { typingManager } from "@/lib/realtime/typing";
import { presenceManager } from "@/lib/realtime/presence";
import { useToast } from "@/components/ToastProvider";
import { generatedAvatarUrl } from "@/lib/generatedAvatar";
import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  Send, X, CornerUpLeft, LockKeyhole, Coins, ImagePlus, Eye, Loader2, Trash2, Pin, PinOff,
  ArrowLeft, Search, ChevronDown, ChevronUp, Smile, Paperclip, Camera,
} from "lucide-react";

interface SecureScreenPlugin {
  enable(): Promise<void>;
  disable(): Promise<void>;
}

const SecureScreen = registerPlugin<SecureScreenPlugin>("SecureScreen");

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

type PendingPhoto = {
  file: File;
  previewUrl: string;
};

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const SWIPE_THRESHOLD = 80;

/** WhatsApp's picker, trimmed to a single scrollable grid. */
const EMOJI_PICKER = [
  "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊",
  "😍","🥰","😘","😗","😙","😚","😋","😛","😜","🤪","🤨","🧐",
  "🤓","😎","🥳","😏","😒","😞","😔","😟","😕","🙁","😣","😖",
  "😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵",
  "😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥","😶","😐","😑",
  "😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵",
  "👍","👎","👌","✌️","🤞","🤟","🤘","👊","✊","👏","🙌","🙏",
  "💪","🔥","✨","🎉","💯","❤️","🧡","💛","💚","💙","💜","🖤",
  "💔","💕","👻","💀","👀","🫶","🤝","💤","🌙","⭐","☀️","🌈",
];

/** Timestamp inside a bubble — WhatsApp shows local 24h-aware short time. */
function bubbleTime(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Label for the sticky date separator: Today / Yesterday / a full date. */
function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);

  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

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
  onDelete,
  onPin,
  isPinned,
  isGroupStart,
  isGroupEnd,
  isSearchHit,
  isActiveHit,
  registerRef,
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
  onDelete: (msg: Message) => void;
  onPin: (msg: Message) => void;
  isPinned: boolean;
  isGroupStart: boolean;
  isGroupEnd: boolean;
  isSearchHit: boolean;
  isActiveHit: boolean;
  registerRef: (id: string, node: HTMLDivElement | null) => void;
}) {
  const x = useMotionValue(0);
  const replyIconOpacity = useTransform(x, [0, SWIPE_THRESHOLD], [0, 1]);
  const isPhotoMessage = msg.is_view_once;

  // WhatsApp squares off the corner only on the last bubble of a run, so a group
  // reads as one block with a single tail.
  const tailCorner = isGroupEnd ? (isMe ? "rounded-br-sm" : "rounded-bl-sm") : "";

  return (
    <div
      ref={(node) => registerRef(msg.id, node)}
      className={`flex ${isMe ? "justify-end" : "justify-start"} ${isGroupStart ? "mt-3" : "mt-0.5"}`}
    >
      <div className="relative max-w-[80%]">
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
            className={`rounded-2xl px-3 py-2 select-none ${tailCorner} ${
              isPinned ? "border border-yellow-400/40" : ""
            } ${isActiveHit ? "ring-2 ring-cyan-300" : isSearchHit ? "ring-1 ring-cyan-400/40" : ""}`}
          >
            {isPinned && (
              <div className="mb-1 flex items-center gap-1 text-[10px] text-yellow-400">
                <Pin size={10} /> Pinned
              </div>
            )}
            {repliedMsg && (
              <div className="mb-2 border-l-2 border-cyan-400 pl-2 text-xs truncate rounded-sm bg-cyan-400/20 text-cyan-200 py-1 pr-2">
                {repliedMsg.content || "📷 Photo"}
              </div>
            )}

            {isPhotoMessage ? (
              <div>
                {msg.image_viewed_at ? (
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
                )}
                {msg.content && (
                  <p className="mt-1 text-sm text-gray-100 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.content}</p>
                )}
                <div className="mt-1 flex items-center justify-end gap-1 text-[10px] leading-none text-gray-400">
                  {bubbleTime(msg.created_at)}
                  {isMe && <MessageTicks deliveredAt={msg.delivered_at} readAt={msg.read_at} />}
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-100">
                {/* Floated so short messages keep the timestamp on the same line and
                    long ones wrap around it — the WhatsApp bubble layout. */}
                <span className="float-right ml-2 mt-1.5 flex items-center gap-1 text-[10px] leading-none text-gray-400">
                  {bubbleTime(msg.created_at)}
                  {isMe && <MessageTicks deliveredAt={msg.delivered_at} readAt={msg.read_at} />}
                </span>
                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.content}</p>
              </div>
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

        {!isPhotoMessage && actionMenuFor === msg.id && (
          <div className={`absolute z-20 -top-16 ${isMe ? "right-0" : "left-0"}`}>
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
                title="Reply"
              >
                <CornerUpLeft size={14} />
              </button>
              <button
                onClick={() => {
                  onPin(msg);
                  setActionMenuFor(null);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
                title={isPinned ? "Unpin" : "Pin"}
              >
                {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
              {isMe && (
                <button
                  onClick={() => {
                    onDelete(msg);
                    setActionMenuFor(null);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/20 hover:bg-rose-500/40"
                  title="Delete"
                >
                  <Trash2 size={14} className="text-rose-400" />
                </button>
              )}
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
  const [pinnedMessageIds, setPinnedMessageIds] = useState<Set<string>>(new Set());
  const [otherLabel, setOtherLabel] = useState("");
  const [otherTyping, setOtherTyping] = useState(false);
  const [otherUserId, setOtherUserId] = useState("");
  const [otherUserOnline, setOtherUserOnline] = useState(false);
  const [input, setInput] = useState("");
  const [myId, setMyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [chatUnlocked, setChatUnlocked] = useState(false);
  const [isFriendConversation, setIsFriendConversation] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [actionMenuFor, setActionMenuFor] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [viewingPhotoId, setViewingPhotoId] = useState<string | null>(null);
  const [photoModalUrl, setPhotoModalUrl] = useState<string | null>(null);
  const [photoModalCaption, setPhotoModalCaption] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Message | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeHit, setActiveHit] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachSheet, setShowAttachSheet] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageNodes = useRef<Map<string, HTMLDivElement>>(new Map());
  const atBottomRef = useRef(true);

  const messagesRef = useRef<Message[]>([]);
  const myIdRef = useRef<string>("");

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { myIdRef.current = myId; }, [myId]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  useEffect(() => {
    if (!myId || !chatUnlocked) return;

    if (!input.trim()) {
      void typingManager.setTyping(conversationId, myId, false);
      return;
    }

    void typingManager.setTyping(conversationId, myId, true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      void typingManager.setTyping(conversationId, myId, false);
    }, 1400);

    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [conversationId, input, myId, chatUnlocked]);

  const markMessagesRead = useCallback(async (msgs: Message[], currentUserId: string) => {
    if (document.visibilityState !== "visible") return;
    const unreadIds = msgs
      .filter((m) => m.sender_id !== currentUserId && !m.read_at)
      .map((m) => m.id);
    if (unreadIds.length === 0) return;
    const readNow = new Date().toISOString();
    const { error } = await supabase
      .from("direct_messages")
      .update({ read_at: readNow })
      .in("id", unreadIds);
    if (!error) {
      setMessages((prev) =>
        prev.map((m) => (unreadIds.includes(m.id) ? { ...m, read_at: readNow } : m))
      );
    }
  }, []);

  useEffect(() => {
    let msgChannel: ReturnType<typeof supabase.channel> | null = null;
    let reactionChannel: ReturnType<typeof supabase.channel> | null = null;
    let unsubscribeTyping: (() => void) | undefined;
    let unsubscribePresence: (() => void) | undefined;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/login"); return; }

      setMyId(session.user.id);
      myIdRef.current = session.user.id;

      const { data: convo } = await supabase
        .from("conversations")
        .select("user_a, user_b")
        .eq("id", conversationId)
        .single();

      if (!convo) { router.push("/active"); return; }

      const readColumn = convo.user_a === session.user.id ? "user_a_last_read_at" : "user_b_last_read_at";
      await supabase.from("conversations").update({ [readColumn]: new Date().toISOString() }).eq("id", conversationId);

      const otherUserId = convo.user_a === session.user.id ? convo.user_b : convo.user_a;
      setOtherUserId(otherUserId);
      setOtherLabel(anonymousDisplayName(otherUserId));
      await presenceManager.connect(session.user.id);
      unsubscribePresence = presenceManager.subscribe((users) => {
        setOtherUserOnline(users.some((user) => user.id === otherUserId));
      });
      unsubscribeTyping = typingManager.subscribe(conversationId, session.user.id, (typing) => {
        setOtherTyping(typing);
      });

      await supabase.rpc("ensure_coin_wallet", { target_user: session.user.id });

      const otherFriendship = await supabase
        .from("friends").select("id")
        .eq("user_id", session.user.id).eq("friend_id", otherUserId).maybeSingle();
      setIsFriendConversation(Boolean(otherFriendship.data));

      const { data: unlock } = await supabase
        .from("chat_unlocks").select("id")
        .eq("user_id", session.user.id).eq("conversation_id", conversationId).maybeSingle();
      setChatUnlocked(Boolean(unlock));

      const { data: msgs } = await supabase
        .from("direct_messages").select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      const fetchedMsgs = msgs || [];
      setMessages(fetchedMsgs);
      messagesRef.current = fetchedMsgs;

      const { data: pins } = await supabase
        .from("pinned_messages").select("message_id")
        .eq("conversation_id", conversationId);
      setPinnedMessageIds(new Set((pins || []).map((p) => p.message_id)));

      const { data: reacts } = await supabase
        .from("message_reactions").select("message_id, user_id, emoji")
        .in("message_id", fetchedMsgs.map((m) => m.id));
      setReactions(reacts || []);
      setLoading(false);

      const now = new Date().toISOString();
      const undeliveredIds = fetchedMsgs
        .filter((m) => m.sender_id !== session.user.id && !m.delivered_at)
        .map((m) => m.id);

      if (undeliveredIds.length > 0) {
        const { error: deliverError } = await supabase
          .from("direct_messages").update({ delivered_at: now }).in("id", undeliveredIds);
        if (!deliverError) {
          setMessages((prev) =>
            prev.map((m) => undeliveredIds.includes(m.id) ? { ...m, delivered_at: now } : m)
          );
        }
      }

      setTimeout(() => { markMessagesRead(messagesRef.current, session.user.id); }, 1200);

      msgChannel = supabase
        .channel(`chat-msgs-${conversationId}-${Date.now()}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_messages", filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            const incoming = payload.new as Message;
            setMessages((prev) => {
              if (prev.some((m) => m.id === incoming.id)) return prev;
              return [...prev, incoming];
            });
            if (incoming.sender_id !== session.user.id) {
              const msgNow = new Date().toISOString();
              const readAt = document.visibilityState === "visible" ? msgNow : null;
              supabase.from("direct_messages").update({ delivered_at: msgNow, read_at: readAt }).eq("id", incoming.id)
                .then(({ error }) => {
                  if (!error) {
                    setMessages((prev) =>
                      prev.map((m) => m.id === incoming.id ? { ...m, delivered_at: msgNow, read_at: readAt } : m)
                    );
                  }
                });
            }
          }
        )
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "direct_messages", filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            const updated = payload.new as Message;
            setMessages((prev) => prev.map((m) => m.id === updated.id ? updated : m));
          }
        )
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "direct_messages", filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            const deleted = payload.old as { id: string };
            setMessages((prev) => prev.filter((m) => m.id !== deleted.id));
          }
        )
        .subscribe();

      reactionChannel = supabase
        .channel(`chat-reactions-${conversationId}-${Date.now()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" },
          (payload) => {
            if (payload.eventType === "INSERT") {
              const incoming = payload.new as Reaction;
              setReactions((prev) =>
                prev.some((r) => r.message_id === incoming.message_id && r.user_id === incoming.user_id)
                  ? prev : [...prev, incoming]
              );
            }
            if (payload.eventType === "UPDATE") {
              setReactions((prev) =>
                prev.map((r) =>
                  r.message_id === (payload.new as Reaction).message_id && r.user_id === (payload.new as Reaction).user_id
                    ? (payload.new as Reaction) : r
                )
              );
            }
            if (payload.eventType === "DELETE") {
              setReactions((prev) =>
                prev.filter((r) =>
                  !(r.message_id === (payload.old as Partial<Reaction>).message_id &&
                    r.user_id === (payload.old as Partial<Reaction>).user_id)
                )
              );
            }
          }
        )
        .subscribe();

      function handleVisibilityChange() {
        if (document.visibilityState !== "visible") return;
        markMessagesRead(messagesRef.current, myIdRef.current);
      }
      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () => { document.removeEventListener("visibilitychange", handleVisibilityChange); };
    }

    let cleanupVisibility: (() => void) | undefined;
    init().then((cleanup) => { cleanupVisibility = cleanup; });

    return () => {
      cleanupVisibility?.();
      unsubscribePresence?.();
      unsubscribeTyping?.();
      void typingManager.setTyping(conversationId, myIdRef.current, false);
      if (msgChannel) supabase.removeChannel(msgChannel);
      if (reactionChannel) supabase.removeChannel(reactionChannel);
    };
  }, [conversationId, router, markMessagesRead]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    setUnseenCount(0);
  }, []);

  // Track how close to the bottom the user is, so new messages don't yank them
  // away from older history they're reading.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    function handleScroll() {
      if (!container) return;
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      const near = distance < 120;
      atBottomRef.current = near;
      setAtBottom(near);
      if (near) setUnseenCount(0);
    }

    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [loading]);

  const lastMessageId = messages.length ? messages[messages.length - 1].id : null;
  const previousLastId = useRef<string | null>(null);

  useEffect(() => {
    if (loading || !lastMessageId) return;

    const isNew = previousLastId.current !== null && previousLastId.current !== lastMessageId;
    const firstPaint = previousLastId.current === null;
    previousLastId.current = lastMessageId;

    // Jump on first paint; afterwards only follow along if the user was already down there.
    if (firstPaint || atBottomRef.current) {
      const timer = setTimeout(() => scrollToBottom(firstPaint ? "auto" : "smooth"), 50);
      return () => clearTimeout(timer);
    }

    if (isNew) {
      const incoming = messages[messages.length - 1];
      if (incoming.sender_id !== myId) setUnseenCount((count) => count + 1);
    }
  }, [lastMessageId, loading, messages, myId, scrollToBottom]);

  const registerMessageRef = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) messageNodes.current.set(id, node);
    else messageNodes.current.delete(id);
  }, []);

  // Newest-first, the order WhatsApp steps through search results.
  const searchHits = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [] as string[];
    return messages
      .filter((message) => (message.content || "").toLowerCase().includes(query))
      .map((message) => message.id)
      .reverse();
  }, [messages, searchQuery]);

  useEffect(() => { setActiveHit(0); }, [searchQuery]);

  useEffect(() => {
    const target = searchHits[activeHit];
    if (!target) return;
    messageNodes.current.get(target)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeHit, searchHits]);

  function stepSearch(direction: 1 | -1) {
    if (!searchHits.length) return;
    setActiveHit((current) => (current + direction + searchHits.length) % searchHits.length);
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery("");
    setActiveHit(0);
  }

  function insertEmoji(emoji: string) {
    setInput((current) => current + emoji);
    textareaRef.current?.focus();
  }

  useEffect(() => {
    return () => { if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.previewUrl); };
  }, [pendingPhoto]);

  async function sendMessage() {
    setShowEmojiPicker(false);
    setShowAttachSheet(false);
    if (pendingPhoto) { await sendPendingPhoto(); return; }
    const hasMessage = input.trim().length > 0;
    if (!chatUnlocked) {
      showToast(isFriendConversation
        ? "You need 40 coins to unlock this conversation."
        : `Unlock this chat once for ${UNLOCK_CHAT_COST} Whisper Coins to send messages.`);
      return;
    }
    if (!hasMessage || !myId) return;
    const content = input.trim();
    setInput("");
    const replyId = replyingTo?.id || null;
    setReplyingTo(null);
    const { error } = await supabase.from("direct_messages").insert({
      conversation_id: conversationId,
      sender_id: myId,
      content: content,
      reply_to_id: replyId,
    });
    if (error) { showToast(error.message); return; }
    await supabase.from("conversations").update({
      last_message_at: new Date().toISOString(),
      last_message_sender_id: myId,
    }).eq("id", conversationId);
  }

  async function deleteMessage(msg: Message) {
    setDeleteConfirm(null);
    const { error } = await supabase.from("direct_messages").delete().eq("id", msg.id).eq("sender_id", myId);
    if (error) showToast("Couldn't delete message.");
    else setMessages((prev) => prev.filter((m) => m.id !== msg.id));
  }

  async function togglePin(msg: Message) {
    const alreadyPinned = pinnedMessageIds.has(msg.id);
    if (alreadyPinned) {
      await supabase.from("pinned_messages").delete()
        .eq("conversation_id", conversationId).eq("message_id", msg.id);
      setPinnedMessageIds((prev) => { const s = new Set(prev); s.delete(msg.id); return s; });
      showToast("Message unpinned.");
    } else {
      const { error } = await supabase.from("pinned_messages").insert({
        conversation_id: conversationId,
        message_id: msg.id,
        pinned_by: myId,
      });
      if (!error) {
        setPinnedMessageIds((prev) => new Set([...prev, msg.id]));
        showToast("Message pinned.");
      }
    }
  }

  function triggerPhotoPicker() {
    if (!chatUnlocked) {
      showToast(isFriendConversation
        ? "You need 40 coins to unlock this conversation."
        : `Unlock this chat once for ${UNLOCK_CHAT_COST} Whisper Coins first.`);
      return;
    }
    fileInputRef.current?.click();
  }

  function triggerCameraPicker() {
    if (!chatUnlocked) {
      showToast(isFriendConversation
        ? "You need 40 coins to unlock this conversation."
        : `Unlock this chat once for ${UNLOCK_CHAT_COST} Whisper Coins first.`);
      return;
    }
    cameraInputRef.current?.click();
  }

  function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { showToast("Please select an image file."); return; }
    if (file.size > 8 * 1024 * 1024) { showToast("Image too large — max 8MB."); return; }
    if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.previewUrl);
    setPendingPhoto({ file, previewUrl: URL.createObjectURL(file) });
    setShowAttachSheet(false);
  }

  function cancelPendingPhoto() {
    if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.previewUrl);
    setPendingPhoto(null);
  }

  async function sendPendingPhoto() {
    if (!pendingPhoto || !myId) return;
    if (!chatUnlocked) {
      showToast(isFriendConversation
        ? "You need 40 coins to unlock this conversation."
        : `Unlock this chat once for ${UNLOCK_CHAT_COST} Whisper Coins first.`);
      return;
    }
    setUploadingPhoto(true);
    try {
      const { data: wallet, error: walletError } = await supabase
        .from("coins").select("balance").eq("user_id", myId).maybeSingle();
      if (walletError) { showToast(walletError.message); return; }
      if ((wallet?.balance ?? 0) < SEND_IMAGE_COST) { showToast(`You need ${SEND_IMAGE_COST} coins to send an image.`); return; }

      const file = pendingPhoto.file;
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage.from("view-once-photos").upload(path, file, { contentType: file.type });
      if (uploadError) { showToast(uploadError.message); return; }

      const { error: spendError } = await supabase.rpc("spend_coins_for_image", { target_conversation_id: conversationId });
      if (spendError) {
        await supabase.storage.from("view-once-photos").remove([path]);
        showToast(spendError.message);
        return;
      }

      const caption = input.trim();
      const replyId = replyingTo?.id || null;
      const { error: insertError } = await supabase.from("direct_messages").insert({
        conversation_id: conversationId,
        sender_id: myId,
        content: caption || null,
        reply_to_id: replyId,
        image_path: path,
        is_view_once: true,
      });
      if (insertError) { showToast(insertError.message); return; }

      await supabase.from("conversations").update({
        last_message_at: new Date().toISOString(),
        last_message_sender_id: myId,
      }).eq("id", conversationId);

      URL.revokeObjectURL(pendingPhoto.previewUrl);
      setPendingPhoto(null);
      setInput("");
      setReplyingTo(null);
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ messageId: msg.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "Couldn't load photo.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (Capacitor.isNativePlatform()) { try { await SecureScreen.enable(); } catch (e) {} }
      setPhotoModalUrl(url);
      setPhotoModalCaption(msg.content);
    } catch {
      showToast("Something went wrong loading the photo.");
    } finally {
      setViewingPhotoId(null);
    }
  }

  function closePhotoModal() {
    if (Capacitor.isNativePlatform()) { try { SecureScreen.disable(); } catch (e) {} }
    if (photoModalUrl) URL.revokeObjectURL(photoModalUrl);
    setPhotoModalUrl(null);
    setPhotoModalCaption(null);
  }

  async function toggleReaction(messageId: string, emoji: string) {
    setActionMenuFor(null);
    const existing = reactions.find((r) => r.message_id === messageId && r.user_id === myId);
    if (existing && existing.emoji === emoji) {
      await supabase.from("message_reactions").delete().eq("message_id", messageId).eq("user_id", myId);
      setReactions((prev) => prev.filter((r) => !(r.message_id === messageId && r.user_id === myId)));
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
    if (error) showToast(error.message);
    else { setChatUnlocked(true); showToast("Chat unlocked permanently."); }
    setUnlocking(false);
  }

  function getReactionsFor(messageId: string) {
    const grouped: Record<string, number> = {};
    reactions.filter((r) => r.message_id === messageId).forEach((r) => {
      grouped[r.emoji] = (grouped[r.emoji] || 0) + 1;
    });
    return grouped;
  }

  function getRepliedMessage(replyToId: string | null) {
    if (!replyToId) return null;
    return messages.find((m) => m.id === replyToId) || null;
  }

  function startPress(messageId: string) {
    pressTimer.current = setTimeout(() => { setActionMenuFor(messageId); }, 450);
  }

  function cancelPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }

  const pinnedMessages = messages.filter((m) => pinnedMessageIds.has(m.id));

  if (loading) {
    return (
      <main className="flex h-screen items-center justify-center theme-bg-gradient text-white">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="relative flex h-screen flex-col overflow-hidden theme-bg-gradient text-white">
      <div className="relative z-10 flex h-full flex-col">

        {/* Header — single compact row, WhatsApp style */}
        <div className="flex-shrink-0 border-b border-white/10 bg-black/20 px-2 py-2 backdrop-blur-xl">
          {searchOpen ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={closeSearch}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-300 hover:bg-white/10"
                aria-label="Close search"
              >
                <ArrowLeft size={20} />
              </button>
              <input
                autoFocus
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search messages..."
                className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-gray-500"
              />
              <span className="shrink-0 px-1 text-xs text-gray-400">
                {searchHits.length ? `${activeHit + 1}/${searchHits.length}` : searchQuery.trim() ? "0/0" : ""}
              </span>
              <button
                type="button"
                onClick={() => stepSearch(1)}
                disabled={!searchHits.length}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-300 hover:bg-white/10 disabled:opacity-40"
                aria-label="Older match"
              >
                <ChevronUp size={18} />
              </button>
              <button
                type="button"
                onClick={() => stepSearch(-1)}
                disabled={!searchHits.length}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-300 hover:bg-white/10 disabled:opacity-40"
                aria-label="Newer match"
              >
                <ChevronDown size={18} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => router.back()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-300 hover:bg-white/10"
                aria-label="Back"
              >
                <ArrowLeft size={20} />
              </button>
              <img
                src={generatedAvatarUrl(otherUserId || "ghost")}
                alt=""
                className="h-9 w-9 shrink-0 rounded-full border border-white/20 bg-white/10 object-cover p-0.5"
              />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[15px] font-bold text-white">{otherLabel}</p>
                <p className={`truncate text-[11px] ${otherTyping || otherUserOnline ? "text-emerald-400" : "text-gray-400"}`}>
                  {otherTyping ? "typing..." : otherUserOnline ? "online" : "offline"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-300 hover:bg-white/10"
                aria-label="Search messages"
              >
                <Search size={19} />
              </button>
            </div>
          )}
        </div>

        {/* Pinned messages bar */}
        {pinnedMessages.length > 0 && (
          <div className="flex-shrink-0 border-b border-yellow-400/20 bg-yellow-400/5 px-4 py-2">
            <div className="flex items-center gap-2 text-xs text-yellow-400">
              <Pin size={12} />
              <span className="truncate">
                {pinnedMessages[pinnedMessages.length - 1].content || "📷 Photo"}
              </span>
              <span className="ml-auto shrink-0 text-yellow-400/60">{pinnedMessages.length} pinned</span>
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={messagesContainerRef} className="relative flex-1 overflow-y-auto">
          <div className="relative min-h-full px-3 py-4 md:px-6">
            <ChatDoodleBackground />

            {!chatUnlocked && (
              <GlassPanel className="rounded-3xl border border-cyan-300/20 p-6 text-center shadow-2xl shadow-cyan-500/10">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300/25 to-purple-400/25">
                  <LockKeyhole className="text-cyan-200" />
                </div>
                <h2 className="text-2xl font-black">Chat locked</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm text-gray-400">
                  {isFriendConversation
                    ? "Unlock this friend conversation once for 40 Coins to send messages."
                    : "Unlock this anonymous conversation once to send messages normally."}
                </p>
                <button
                  onClick={unlockChat}
                  disabled={unlocking}
                  className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-purple-600 px-5 py-3 font-black text-black shadow-lg shadow-cyan-400/20 transition active:scale-95 disabled:opacity-60"
                >
                  <Coins size={18} /> {unlocking ? "Unlocking..." : `Unlock for ${UNLOCK_CHAT_COST} Coins`}
                </button>
              </GlassPanel>
            )}

            {messages.length === 0 ? (
              <p className="mt-10 text-center text-gray-500">Say hi 👻 — they won&apos;t know who you are.</p>
            ) : (
              messages.map((msg, index) => {
                const previous = index > 0 ? messages[index - 1] : null;
                const next = index < messages.length - 1 ? messages[index + 1] : null;
                const startsDay = !previous || !sameDay(previous.created_at, msg.created_at);

                // A run is the same sender, same day, within five minutes — WhatsApp's
                // rule for collapsing consecutive messages into one visual block.
                const withinRun = (a: Message, b: Message) =>
                  a.sender_id === b.sender_id &&
                  sameDay(a.created_at, b.created_at) &&
                  Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) < 5 * 60_000;

                const isGroupStart = startsDay || !previous || !withinRun(previous, msg);
                const isGroupEnd = !next || !withinRun(msg, next);

                return (
                  <div key={msg.id}>
                    {startsDay && (
                      <div className="sticky top-2 z-10 my-4 flex justify-center">
                        <span className="rounded-full border border-white/10 bg-black/50 px-3 py-1 text-[11px] font-semibold text-gray-300 backdrop-blur-md">
                          {dayLabel(msg.created_at)}
                        </span>
                      </div>
                    )}
                    <MessageBubble
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
                      onDelete={(target) => setDeleteConfirm(target)}
                      onPin={togglePin}
                      isPinned={pinnedMessageIds.has(msg.id)}
                      isGroupStart={isGroupStart}
                      isGroupEnd={isGroupEnd}
                      isSearchHit={searchHits.includes(msg.id)}
                      isActiveHit={searchHits[activeHit] === msg.id}
                      registerRef={registerMessageRef}
                    />
                  </div>
                );
              })
            )}
            {otherTyping && (
              <div className="mt-3 flex items-end gap-2">
                <div className="rounded-2xl rounded-bl-sm border border-white/10 bg-white/[0.08] px-4 py-3 shadow-lg shadow-black/10">
                  <span className="flex items-center gap-1.5" aria-label={`${otherLabel} is typing`}>
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-300 [animation-delay:-0.2s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-300 [animation-delay:-0.1s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-300" />
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Scroll to latest */}
        {!atBottom && (
          <div className="pointer-events-none relative z-20">
            <button
              type="button"
              onClick={() => scrollToBottom()}
              className="pointer-events-auto absolute bottom-3 right-4 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/70 text-gray-200 shadow-lg backdrop-blur-md hover:bg-black/90"
              aria-label={unseenCount ? `${unseenCount} new messages, scroll to latest` : "Scroll to latest"}
            >
              <ChevronDown size={20} />
              {unseenCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-cyan-400 px-1 text-[11px] font-black text-black">
                  {unseenCount > 99 ? "99+" : unseenCount}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Pending photo preview */}
        {pendingPhoto && (
          <div className="flex-shrink-0 mx-3 mb-2 flex items-center gap-3 rounded-xl border border-cyan-400/30 bg-white/5 px-3 py-2 md:mx-6">
            <img src={pendingPhoto.previewUrl} alt="Selected photo" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
            <p className="flex-1 truncate text-xs text-gray-300">Ready to send — costs {SEND_IMAGE_COST} coins</p>
            <button type="button" onClick={cancelPendingPhoto} disabled={uploadingPhoto} className="disabled:opacity-60">
              <X size={14} className="text-gray-400" />
            </button>
          </div>
        )}

        {/* Reply preview */}
        {replyingTo && (
          <div className="flex-shrink-0 mx-3 mb-2 flex items-center justify-between rounded-xl border-l-2 border-cyan-400 bg-white/5 px-3 py-2 md:mx-6">
            <p className="truncate text-xs text-gray-300">Replying to: {replyingTo.content || "📷 Photo"}</p>
            <button onClick={() => setReplyingTo(null)}><X size={14} className="text-gray-400" /></button>
          </div>
        )}

        {/* Emoji picker */}
        {showEmojiPicker && (
          <div className="flex-shrink-0 border-t border-white/10 bg-black/40 px-3 py-2 backdrop-blur-xl">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Emoji</span>
              <button
                type="button"
                onClick={() => setShowEmojiPicker(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-white/10"
                aria-label="Close emoji picker"
              >
                <X size={14} />
              </button>
            </div>
            <div className="grid max-h-40 grid-cols-9 gap-1 overflow-y-auto">
              {EMOJI_PICKER.map((emoji, index) => (
                <button
                  key={`${emoji}-${index}`}
                  type="button"
                  onClick={() => insertEmoji(emoji)}
                  className="flex h-9 items-center justify-center rounded-lg text-xl transition hover:bg-white/10"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Attachment sheet */}
        {showAttachSheet && (
          <div className="flex-shrink-0 border-t border-white/10 bg-black/40 px-4 py-4 backdrop-blur-xl">
            <div className="flex items-start gap-6">
              <button
                type="button"
                onClick={() => { setShowAttachSheet(false); triggerPhotoPicker(); }}
                className="flex flex-col items-center gap-2 text-[11px] font-semibold text-gray-300"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500/80 to-purple-600/80 text-white">
                  <ImagePlus size={20} />
                </span>
                Gallery
              </button>
              <button
                type="button"
                onClick={() => { setShowAttachSheet(false); triggerCameraPicker(); }}
                className="flex flex-col items-center gap-2 text-[11px] font-semibold text-gray-300"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400/80 to-blue-600/80 text-white">
                  <Camera size={20} />
                </span>
                Camera
              </button>
              <p className="ml-auto max-w-[46%] text-[11px] leading-4 text-gray-500">
                Photos send as view-once and cost {SEND_IMAGE_COST} coins. Your identity stays hidden either way.
              </p>
            </div>
          </div>
        )}

        {/* Input form */}
        <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="flex-shrink-0 p-3 pt-2 md:px-6">
          <div className="flex items-end gap-1.5 rounded-2xl border border-white/10 bg-black/30 p-1.5">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelected} />
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoSelected} />
            <button
              type="button"
              onClick={() => { setShowEmojiPicker((open) => !open); setShowAttachSheet(false); }}
              className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-white/10"
              aria-label="Emoji"
              aria-expanded={showEmojiPicker}
            >
              <Smile size={20} />
            </button>
            <button
              type="button"
              onClick={() => { setShowAttachSheet((open) => !open); setShowEmojiPicker(false); }}
              disabled={uploadingPhoto}
              title={`Attach an image (${SEND_IMAGE_COST} coins)`}
              className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-white/10 disabled:opacity-60"
              aria-expanded={showAttachSheet}
            >
              <Paperclip size={19} />
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={pendingPhoto ? "Add a caption (optional)..." : chatUnlocked ? "Message anonymously..." : "Unlock chat to send messages"}
              disabled={!chatUnlocked}
              rows={1}
              className="max-h-40 flex-1 resize-none overflow-y-auto bg-transparent px-3 py-2.5 leading-6 outline-none placeholder:text-gray-500 disabled:cursor-not-allowed disabled:opacity-60 text-white"
            />
            <button
              type="submit"
              disabled={!chatUnlocked || (pendingPhoto ? uploadingPhoto : (input.trim().length === 0))}
              className={`mb-1 flex h-10 items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 to-purple-600 disabled:cursor-not-allowed disabled:opacity-50 shadow-lg shadow-cyan-500/20 ${pendingPhoto ? "gap-1.5 px-4" : "w-10"}`}
            >
              {pendingPhoto ? (
                uploadingPhoto ? <Loader2 size={16} className="animate-spin text-black" /> : (
                  <><Coins size={16} className="text-black" /><span className="text-sm font-black text-black">{SEND_IMAGE_COST}</span></>
                )
              ) : (
                <Send size={16} className="text-black" />
              )}
            </button>
          </div>
        </form>
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <GlassPanel strong className="w-full max-w-sm rounded-3xl p-6 text-center">
            <Trash2 size={32} className="mx-auto mb-3 text-rose-400" />
            <h2 className="text-lg font-black">Delete message?</h2>
            <p className="mt-1 text-sm text-gray-400">This will be removed for everyone.</p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 rounded-2xl border border-white/10 py-2 text-sm font-bold text-gray-300 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMessage(deleteConfirm)}
                className="flex-1 rounded-2xl bg-rose-500 py-2 text-sm font-black text-white hover:bg-rose-600"
              >
                Delete
              </button>
            </div>
          </GlassPanel>
        </div>
      )}

      {/* Photo modal */}
      {photoModalUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={closePhotoModal}>
          <div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
            {photoModalCaption && (
              <p className="mb-3 text-center text-sm font-medium text-white">{photoModalCaption}</p>
            )}
            <img src={photoModalUrl} alt="View-once photo" className="max-h-[80vh] max-w-full rounded-2xl object-contain" />
            <p className="mt-3 text-center text-xs text-gray-400">This photo won&apos;t be available again after you close this view.</p>
            <button onClick={closePhotoModal} className="absolute -top-3 -right-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-lg">
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}