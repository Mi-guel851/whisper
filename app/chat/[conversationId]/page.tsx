"use client";

import ChatDoodleBackground from "@/components/ChatDoodleBackground";
import MessageTicks from "@/components/MessageTicks";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, useMemo, useRef, useState, useCallback, memo } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import GlassPanel from "@/components/GlassPanel";
import { UNLOCK_CHAT_COST, SEND_IMAGE_COST, SEND_VOICE_COST } from "@/lib/coins";
import { anonymousDisplayName } from "@/lib/anonymousIdentity";
import { typingManager } from "@/lib/realtime/typing";
import { presenceManager } from "@/lib/realtime/presence";
import { useToast } from "@/components/ToastProvider";
import { generatedAvatarUrl } from "@/lib/generatedAvatar";
import { useEventCallback } from "@/lib/useEventCallback";
import VoiceRecorder from "@/components/chat/VoiceRecorder";
import VoicePlayer from "@/components/chat/VoicePlayer";
import type { VoiceRecording } from "@/lib/useVoiceRecorder";
import { messagePreviewText } from "@/lib/messagePreview";
import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  Send, X, CornerUpLeft, LockKeyhole, Coins, ImagePlus, Eye, Loader2, Trash2, Pin, PinOff,
  ArrowLeft, Search, ChevronDown, ChevronUp, Smile, Paperclip, Camera, Copy,
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
  audio_path: string | null;
  audio_duration_ms: number | null;
  audio_waveform: number[] | null;
  audio_mime: string | null;
  is_view_once: boolean;
  image_viewed_at: string | null;
  audio_viewed_at: string | null;
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

/* Pin lifetimes. `null` means it stays until someone removes it — the rest are
   swept on next open by `sweep_expired_pins`. WhatsApp offers three; the fourth
   exists because Whisper threads are often kept as a record. */
const PIN_DURATIONS: { label: string; hours: number | null }[] = [
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
  { label: "until I remove it", hours: null },
];

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

/**
 * Turn a Supabase storage/RPC failure into something the sender can act on.
 *
 * Every one of these means the same thing in practice — the voice-note
 * migration (`202608070001_voice_notes_and_pins.sql`) hasn't been applied to
 * this project, so the bucket, the policies or the `send_voice_note` function
 * is missing. Passing the raw string through showed people a toast reading
 * "Bucket not found", which is accurate, unfixable by them, and looks like the
 * app is broken rather than unprovisioned.
 */
function describeVoiceNoteFailure(message: string) {
  const text = message.toLowerCase();

  if (text.includes("bucket not found") || text.includes("bucket")) {
    return "Voice notes aren't set up on this server yet. (Storage bucket missing.)";
  }
  if (text.includes("send_voice_note") || text.includes("pgrst202") || text.includes("could not find the function")) {
    return "Voice notes aren't set up on this server yet. (Database function missing.)";
  }
  if (text.includes("row-level security") || text.includes("violates")) {
    return "You don't have permission to send a voice note in this chat.";
  }
  if (text.includes("mime") || text.includes("content type") || text.includes("invalid_mime_type")) {
    return "This device recorded a format the server doesn't accept yet.";
  }
  if (text.includes("payload too large") || text.includes("size")) {
    return "That voice note is too long to upload.";
  }
  if (text.includes("coins")) {
    return message; // Already a human sentence from the RPC.
  }
  return message;
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

/**
 * One chat bubble.
 *
 * Memoized, and the prop surface is shaped around that. The list re-renders
 * constantly for reasons no individual bubble cares about — the other side
 * typing, a presence blip, a delivery receipt, every keystroke in the composer —
 * and each bubble is not cheap to rebuild: it owns a Framer Motion drag
 * recognizer, a `useMotionValue` and a `useTransform`. Rebuilding six hundred of
 * those to show a "typing..." caption is what made long threads stutter.
 *
 * Note `isActionMenuOpen` rather than the `actionMenuFor` id it replaced.
 * Passing the raw id handed every bubble a value that changed whenever any
 * menu opened, so all of them re-rendered to update one. The boolean changes
 * for exactly the two bubbles involved.
 */
const MessageBubble = memo(function MessageBubbleBase({
  msg,
  isMe,
  repliedMsg,
  msgReactions,
  isActionMenuOpen,
  setActionMenuFor,
  toggleReaction,
  setReplyingTo,
  startPress,
  cancelPress,
  onSwipeReply,
  onViewPhoto,
  onPlayAudio,
  viewingPhotoId,
  onDelete,
  onCopy,
  onPin,
  isPinned,
  isGroupStart,
  isGroupEnd,
  isSearchHit,
  isActiveHit,
  isHighlighted,
  onJumpToQuote,
  registerRef,
}: {
  msg: Message;
  isMe: boolean;
  repliedMsg: Message | null;
  msgReactions: Record<string, number>;
  isActionMenuOpen: boolean;
  setActionMenuFor: (id: string | null) => void;
  toggleReaction: (messageId: string, emoji: string) => void;
  setReplyingTo: (msg: Message | null) => void;
  startPress: (id: string) => void;
  cancelPress: () => void;
  onSwipeReply: (msg: Message) => void;
  onViewPhoto: (msg: Message) => void;
  /** Resolves to a playable object URL for a view-once note, or null. */
  onPlayAudio: (msg: Message) => Promise<string | null>;
  viewingPhotoId: string | null;
  onDelete: (msg: Message) => void;
  onCopy: (msg: Message) => void;
  onPin: (msg: Message) => void;
  isPinned: boolean;
  isGroupStart: boolean;
  isGroupEnd: boolean;
  isSearchHit: boolean;
  isActiveHit: boolean;
  isHighlighted: boolean;
  onJumpToQuote: (id: string) => void;
  registerRef: (id: string, node: HTMLDivElement | null) => void;
}) {
  const x = useMotionValue(0);
  const replyIconOpacity = useTransform(x, [0, SWIPE_THRESHOLD], [0, 1]);

  // WhatsApp squares off the corner only on the last bubble of a run, so a group
  // reads as one block with a single tail.
  const tailCorner = isGroupEnd ? (isMe ? "rounded-br-sm" : "rounded-bl-sm") : "";

  const isPhotoMessage = Boolean(msg.image_path);
  /* `audio_viewed_at` matters as much as `audio_path` here: playing a view-once
     note nulls the path server-side, and without the second check the bubble
     would fall through to the plain-text branch and render as empty. */
  const isAudioMessage = Boolean(msg.audio_path) || Boolean(msg.audio_viewed_at);
  const isMediaMessage = isAudioMessage || (msg.is_view_once && isPhotoMessage);

  return (
    <div
      ref={(node) => registerRef(msg.id, node)}
      className={`flex ${isMe ? "justify-end" : "justify-start"} ${isGroupStart ? "mt-3" : "mt-0.5"}`}
    >
      <div className="relative max-w-[80%]">
        <motion.div
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
          style={{ opacity: replyIconOpacity, color: "var(--theme-accent-purple)" }}
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
          {/* An opaque card, not a GlassPanel. A translucent bubble over the
              doodle wallpaper drags the pattern through its own text — which is
              what made the light theme unreadable. WhatsApp's bubbles are solid
              for exactly this reason; only the chrome stays frosted. */}
          <div
            className={`chat-bubble ${isMe ? "chat-bubble-out" : ""} ${
              isHighlighted ? "chat-bubble-flash" : ""
            } rounded-2xl px-3 py-2 select-none ${tailCorner} ${
              isPinned ? "ring-1 ring-yellow-400/50" : ""
            } ${isActiveHit ? "ring-2 ring-cyan-300" : isSearchHit ? "ring-1 ring-cyan-400/40" : ""}`}
          >
            {isPinned && (
              <div className="mb-1 flex items-center gap-1 text-[10px]" style={{ color: "var(--theme-warning)" }}>
                <Pin size={10} /> Pinned
              </div>
            )}
            {repliedMsg && (
              <button
                type="button"
                onClick={() => onJumpToQuote(repliedMsg.id)}
                className="chat-quote mb-2 block w-full truncate rounded-sm py-1 pl-2 pr-2 text-left text-xs"
              >
                {messagePreviewText(repliedMsg)}
              </button>
            )}

            {isMediaMessage ? (
              <div>
                {isAudioMessage ? (
                  <VoicePlayer
                    messageId={msg.id}
                    audioPath={msg.audio_path}
                    durationMs={msg.audio_duration_ms}
                    waveform={msg.audio_waveform}
                    isMe={isMe}
                    isViewOnce={msg.is_view_once}
                    viewedAt={msg.audio_viewed_at}
                    onRequestViewOnce={() => onPlayAudio(msg)}
                  />
                ) : isPhotoMessage ? (
                  /* WhatsApp's unopened-photo tile: a blurred placeholder with a
                     "1" ring, tappable as a whole. The version this replaces was
                     a line of text reading "Tap to view photo (once)", which
                     gave a photo no visual weight in the thread at all. */
                  <button
                    type="button"
                    onClick={() => { if (!isMe && !msg.image_viewed_at) onViewPhoto(msg); }}
                    disabled={isMe || Boolean(msg.image_viewed_at) || viewingPhotoId === msg.id}
                    aria-label={
                      msg.image_viewed_at ? "Photo already viewed"
                        : isMe ? "Photo sent, view once"
                        : "View photo once"
                    }
                    className={`chat-photo-once ${
                      msg.image_viewed_at || isMe ? "chat-photo-once-spent" : ""
                    } disabled:cursor-default`}
                  >
                    <span className="chat-photo-once-ring">
                      {viewingPhotoId === msg.id ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : msg.image_viewed_at ? (
                        <Eye size={18} />
                      ) : (
                        <span className="text-[15px] font-black leading-none">1</span>
                      )}
                    </span>

                    <span className="chat-photo-once-caption flex items-center justify-center gap-1.5 text-[11px] font-bold">
                      <ImagePlus size={12} />
                      {msg.image_viewed_at
                        ? "Opened"
                        : viewingPhotoId === msg.id
                          ? "Opening…"
                          : isMe
                            ? "Photo · once"
                            : "Tap to open"}
                    </span>
                  </button>
                ) : null}
                {msg.content && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{msg.content}</p>
                )}
                <div className="chat-meta mt-1 flex items-center justify-end gap-1 text-[10px] leading-none">
                  {bubbleTime(msg.created_at)}
                  {isMe && <MessageTicks deliveredAt={msg.delivered_at} readAt={msg.read_at} />}
                </div>
              </div>
            ) : (
              <div className="text-sm">
                {/* Floated so short messages keep the timestamp on the same line and
                    long ones wrap around it — the WhatsApp bubble layout. */}
                <span className="chat-meta float-right ml-2 mt-1.5 flex items-center gap-1 text-[10px] leading-none">
                  {bubbleTime(msg.created_at)}
                  {isMe && <MessageTicks deliveredAt={msg.delivered_at} readAt={msg.read_at} />}
                </span>
                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.content}</p>
              </div>
            )}
          </div>
        </motion.div>

        {Object.keys(msgReactions).length > 0 && (
          <div className={`-mt-1.5 flex gap-1 ${isMe ? "justify-end" : "justify-start"}`}>
            {Object.entries(msgReactions).map(([emoji, count]) => (
              <span
                key={emoji}
                className="chat-bubble rounded-full px-1.5 py-0.5 text-[11px] leading-none"
              >
                {emoji} {count > 1 ? count : ""}
              </span>
            ))}
          </div>
        )}

        {!isPhotoMessage && isActionMenuOpen && (
          <div className={`absolute z-20 -top-16 ${isMe ? "right-0" : "left-0"}`}>
            <div className="chat-chrome flex items-center gap-1 rounded-full border px-2 py-2 shadow-xl">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => toggleReaction(msg.id, emoji)}
                  className="text-lg transition hover:scale-125"
                >
                  {emoji}
                </button>
              ))}
              <button
                onClick={() => onCopy(msg)}
                className="chat-icon ml-1 flex h-7 w-7 items-center justify-center rounded-full"
                title="Copy"
              >
                <Copy size={14} />
              </button>
              <button
                onClick={() => {
                  setReplyingTo(msg);
                  setActionMenuFor(null);
                }}
                className="chat-icon flex h-7 w-7 items-center justify-center rounded-full"
                title="Reply"
              >
                <CornerUpLeft size={14} />
              </button>
              <button
                onClick={() => {
                  onPin(msg);
                  setActionMenuFor(null);
                }}
                className="chat-icon flex h-7 w-7 items-center justify-center rounded-full"
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
                  <Trash2 size={14} className="text-rose-500" />
                </button>
              )}
              <button
                onClick={() => setActionMenuFor(null)}
                className="chat-icon flex h-7 w-7 items-center justify-center rounded-full"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const { showToast } = useToast();
  const conversationId = params.conversationId as string;

  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [pinnedMessageIds, setPinnedMessageIds] = useState<Set<string>>(new Set());
  /** The message awaiting a pin duration, if the picker is open. */
  const [pinDurationFor, setPinDurationFor] = useState<Message | null>(null);
  // Which pin the top bar is showing, and the message flashed after any jump
  // (pin bar, reply tap). Monotonic counter rather than an index so it never
  // needs resetting when the pin list changes length.
  const [pinCursor, setPinCursor] = useState(0);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
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
  /* Mirrors the recorder's own state up here so the composer can hold the
     mic/send swap still for the duration of a take. */
  const [recordingVoice, setRecordingVoice] = useState(false);
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
      /* Listener before connect, connect not awaited. The header's online dot is
         ambient; blocking the rest of thread setup on a presence handshake made
         a slow socket look like a slow chat. */
      unsubscribePresence = presenceManager.subscribe((users) => {
        setOtherUserOnline(users.some((user) => user.id === otherUserId));
      });
      void presenceManager.connect(session.user.id);
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

      /* Pins can carry an expiry. Sweeping on open is what makes "pin for 24h"
         mean anything without a scheduled job — the next person to open the
         thread clears what has lapsed, and the fetch below then reflects it. */
      await supabase.rpc("sweep_expired_pins", { target_conversation_id: conversationId });

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
        /* Without these two, a pin only appeared for whoever tapped it — the
           other participant kept the stale bar until they reloaded, which is
           half of what "pinned messages don't take effect" looked like. */
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "pinned_messages", filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            const pinned = payload.new as { message_id: string };
            setPinnedMessageIds((prev) => new Set([...prev, pinned.message_id]));
          }
        )
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "pinned_messages" },
          (payload) => {
            /* DELETE payloads carry only the replica identity, so there is no
               conversation_id to filter on — dropping an id the set never held
               is a no-op anyway. */
            const unpinned = payload.old as { message_id?: string };
            if (!unpinned.message_id) return;
            setPinnedMessageIds((prev) => {
              if (!prev.has(unpinned.message_id!)) return prev;
              const next = new Set(prev);
              next.delete(unpinned.message_id!);
              return next;
            });
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

  /* Membership as a Set. `searchHits.includes(id)` inside the render map is a
     linear scan per bubble — O(n²) across the thread, and it ran on every
     render whether or not a search was open. Empty in the common case, so the
     lookup is free when nobody is searching. */
  const searchHitSet = useMemo(() => new Set(searchHits), [searchHits]);

  useEffect(() => {
    const target = searchHits[activeHit];
    if (!target) return;
    messageNodes.current.get(target)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeHit, searchHits]);

  // The post-jump flash is self-clearing: any jump sets the id, and it fades on
  // its own rather than needing every call site to schedule a reset.
  useEffect(() => {
    if (!highlightedId) return;
    const timer = setTimeout(() => setHighlightedId(null), 1400);
    return () => clearTimeout(timer);
  }, [highlightedId]);

  /** Jump to a quoted message from its reply bubble, and flash it. */
  const jumpToMessage = useCallback((id: string) => {
    const node = messageNodes.current.get(id);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(id);
  }, []);

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

  /* `useEventCallback` on the four handlers below, and only those four.
   *
   * They are what gets passed down to every `MessageBubble`, so their identity
   * is what decides whether the memo actually holds. Each one reads several
   * pieces of page state — pins, coins, the playing-audio id, the conversation —
   * so a plain `useCallback` would list half the component in its dependency
   * array and change identity constantly, re-rendering the whole thread to
   * open one photo. Everything else in this file stays a plain function; it
   * isn't handed to the list and doesn't need the indirection. */
  const togglePin = useEventCallback(async (msg: Message) => {
    if (!pinnedMessageIds.has(msg.id)) {
      /* Pinning asks how long first. A pin with no expiry is a pin you have to
         remember to clean up, which is why WhatsApp made the duration part of
         the action rather than a setting somewhere else. */
      setPinDurationFor(msg);
      return;
    }
    const { error } = await supabase.from("pinned_messages").delete()
      .eq("conversation_id", conversationId).eq("message_id", msg.id);
    if (error) { showToast(error.message); return; }
    setPinnedMessageIds((prev) => { const s = new Set(prev); s.delete(msg.id); return s; });
    showToast("Message unpinned.");
  });

  const confirmPin = useEventCallback(async (msg: Message, durationHours: number | null) => {
    setPinDurationFor(null);
    if (!myId) return;
    const expiresAt = durationHours === null
      ? null
      : new Date(Date.now() + durationHours * 3600_000).toISOString();

    const { error } = await supabase.from("pinned_messages").insert({
      conversation_id: conversationId,
      message_id: msg.id,
      pinned_by: myId,
      expires_at: expiresAt,
    });
    /* This used to be `if (!error)` with no else, which is why pinning read as
       a silent no-op: the table had RLS enabled and no policies, so every
       insert was rejected and the rejection was discarded. Surfacing it means
       a future policy gap is visible instead of invisible. */
    if (error) { showToast(error.message); return; }
    setPinnedMessageIds((prev) => new Set([...prev, msg.id]));
    showToast(durationHours === null ? "Message pinned." : `Pinned for ${PIN_DURATIONS.find((d) => d.hours === durationHours)?.label ?? "a while"}.`);
  });

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
      if (insertError) {
        showToast(insertError.message);
        return;
      }

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

  const handleViewPhoto = useEventCallback(async (msg: Message) => {
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
  });

  /**
   * Uploads a finished recording and sends it.
   *
   * Two things changed from the version this replaces. The object is stored
   * with the container the browser actually produced — `recording.mimeType`
   * rather than a hardcoded `audio/webm` — because WebKit writes MP4 and a
   * mislabelled object is served with a `Content-Type` no decoder will accept.
   * And the spend and the insert now happen inside one `send_voice_note`
   * transaction: the old code deducted 20 coins in one round trip and inserted
   * the message in another, so a failure between them charged for a note that
   * never arrived.
   */
  const handleVoiceNote = useEventCallback(async (recording: VoiceRecording) => {
    if (!myId) return;
    setUploadingPhoto(true);

    const path = `${conversationId}/${crypto.randomUUID()}.${recording.extension}`;
    try {
      const { error: uploadError } = await supabase.storage
        .from("voice-messages")
        .upload(path, recording.blob, { contentType: recording.mimeType, upsert: false });

      if (uploadError) {
        showToast(describeVoiceNoteFailure(uploadError.message));
        return;
      }

      const { error: sendError } = await supabase.rpc("send_voice_note", {
        target_conversation_id: conversationId,
        storage_path: path,
        duration_ms: Math.round(recording.durationMs),
        waveform: recording.waveform,
        mime_type: recording.mimeType,
        caption: input.trim() || null,
        reply_to: replyingTo?.id ?? null,
        /* Always. A voice note is the sender's actual voice, which is the one
           thing in an anonymous app that can't be taken back once it's stored —
           so it isn't stored. `/api/audio/view` deletes the object and nulls
           `audio_path` on the first play, exactly as view-once photos work, and
           that path only runs for rows flagged here. Making this a choice meant
           the safe behaviour was the one you had to remember to pick. */
        view_once: true,
      });

      if (sendError) {
        /* The note never landed, so the object is orphaned — remove it rather
           than leave storage accruing files no row points at. */
        await supabase.storage.from("voice-messages").remove([path]);
        showToast(describeVoiceNoteFailure(sendError.message));
        return;
      }

      setInput("");
      setReplyingTo(null);
      showToast("Voice note sent — plays once.");
    } finally {
      setUploadingPhoto(false);
    }
  });

  /**
   * Consumes a view-once note and hands the bytes back as an object URL.
   *
   * This used to own an `Audio` element and call `.play()` itself, which is why
   * a one-shot note could only ever be played straight through — the page held
   * the element, the bubble drew the waveform, and neither could scrub. Now the
   * server round trip (the thing that deletes the object and nulls
   * `audio_path`) stays here, and the element belongs to the `VoicePlayer` that
   * renders the track. The URL returned is the only remaining copy of the file;
   * the player revokes it on unmount.
   */
  const handlePlayAudio = useEventCallback(async (msg: Message): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !msg.audio_path) return null;

    try {
      const res = await fetch("/api/audio/view", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ messageId: msg.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "Couldn't play voice note.");
        return null;
      }

      const url = URL.createObjectURL(await res.blob());
      setMessages((prev) => prev.map((m) =>
        m.id === msg.id ? { ...m, audio_viewed_at: new Date().toISOString(), audio_path: null } : m
      ));
      return url;
    } catch (error) {
      console.error(error);
      showToast("Could not play voice note.");
      return null;
    }
  });

  function closePhotoModal() {
    if (Capacitor.isNativePlatform()) { try { SecureScreen.disable(); } catch (e) {} }
    if (photoModalUrl) URL.revokeObjectURL(photoModalUrl);
    setPhotoModalUrl(null);
    setPhotoModalCaption(null);
  }

  /* Wrapped, and deliberately not dependent on `reactions`.
   *
   * Handed to every bubble, so its identity decides whether the memo holds. The
   * obvious version closes over `reactions` to find the existing entry, which
   * gives it a new identity every time anyone reacts to anything — re-rendering
   * the whole thread to toggle one emoji. Reading the current value inside the
   * functional updater gets the same answer from state React already has, and
   * leaves this callback stable for the life of the conversation. */
  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    setActionMenuFor(null);

    let wasSameEmoji = false;
    setReactions((prev) => {
      const existing = prev.find((r) => r.message_id === messageId && r.user_id === myId);
      wasSameEmoji = existing?.emoji === emoji;
      const withoutMine = prev.filter((r) => !(r.message_id === messageId && r.user_id === myId));
      return wasSameEmoji ? withoutMine : [...withoutMine, { message_id: messageId, user_id: myId, emoji }];
    });

    if (wasSameEmoji) {
      await supabase.from("message_reactions").delete().eq("message_id", messageId).eq("user_id", myId);
    } else {
      await supabase.from("message_reactions").upsert(
        { message_id: messageId, user_id: myId, emoji },
        { onConflict: "message_id,user_id" }
      );
    }
  }, [myId]);

  async function unlockChat() {
    setUnlocking(true);
    const { error } = await supabase.rpc("unlock_chat_with_coins", { target_conversation_id: conversationId });
    if (error) showToast(error.message);
    else { setChatUnlocked(true); showToast("Chat unlocked permanently."); }
    setUnlocking(false);
  }

  /* Both of these used to be per-message helper functions called from inside the
     render map, and both were linear scans — `reactions.filter(...)` over every
     reaction, and `messages.find(...)` over every message, once per bubble. In a
     600-message thread that is two O(n²) passes on every single render, and the
     chat re-renders on typing, presence, delivery receipts and every incoming
     message. Indexing once and looking up per bubble makes it O(n).

     The stable object identity matters as much as the complexity here: the old
     `getReactionsFor` returned a freshly-built object on every call, so passing
     its result as a prop guaranteed a re-render of every bubble no matter what
     else was memoized. These entries only change identity when `reactions`
     itself changes. */
  const reactionsByMessage = useMemo(() => {
    const grouped = new Map<string, Record<string, number>>();
    for (const reaction of reactions) {
      const existing = grouped.get(reaction.message_id);
      if (existing) existing[reaction.emoji] = (existing[reaction.emoji] || 0) + 1;
      else grouped.set(reaction.message_id, { [reaction.emoji]: 1 });
    }
    return grouped;
  }, [reactions]);

  const messagesById = useMemo(() => {
    const index = new Map<string, Message>();
    for (const message of messages) index.set(message.id, message);
    return index;
  }, [messages]);

  /* Shared empty object so a message with no reactions gets the *same* reference
     every render rather than a new `{}` — the one case that would otherwise slip
     past the memo for the majority of bubbles in a thread. */
  const NO_REACTIONS = useMemo(() => ({}) as Record<string, number>, []);

  /**
   * Copy a message body to the clipboard.
   *
   * `navigator.clipboard` needs a secure context and isn't there in every
   * Android WebView the Capacitor shell runs in, so this falls back to the
   * old execCommand path rather than throwing on those devices.
   */
  const copyMessage = useEventCallback(async (msg: Message) => {
    const text = msg.content?.trim();
    if (!text) {
      showToast("Nothing to copy.");
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const scratch = document.createElement("textarea");
        scratch.value = text;
        // Off-screen rather than `display: none` — a hidden element can't be
        // selected, which is what execCommand("copy") operates on.
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        document.body.appendChild(scratch);
        scratch.select();
        document.execCommand("copy");
        document.body.removeChild(scratch);
      }
      navigator.vibrate?.(15);
      showToast("Copied to clipboard.", { variant: "success" });
    } catch {
      showToast("Couldn't copy that message.", { variant: "error" });
    }
    setActionMenuFor(null);
  });

  /* `useCallback` on both halves of the long-press because they are handed to
     every bubble. As plain functions they were re-created on each render, which
     alone would have been enough to invalidate a memoized bubble on every
     keystroke in the composer. Neither closes over anything that changes, so
     the empty dependency list is honest. */
  const startPress = useCallback((messageId: string) => {
    pressTimer.current = setTimeout(() => {
      // Haptic at the moment the menu commits, so the press has a felt
      // threshold rather than the menu just appearing.
      navigator.vibrate?.(18);
      setActionMenuFor(messageId);
    }, 450);
  }, []);

  const cancelPress = useCallback(() => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }, []);

  const pinnedMessages = useMemo(
    () => messages.filter((m) => pinnedMessageIds.has(m.id)),
    [messages, pinnedMessageIds]
  );

  // The pin the bar is currently showing. Clamped rather than stored as an id so
  // unpinning the visible one falls through to a neighbour instead of blanking
  // the bar while pins remain.
  const pinIndex = pinnedMessages.length ? pinCursor % pinnedMessages.length : 0;
  const activePin = pinnedMessages[pinIndex] ?? null;

  /** Scroll to the shown pin, then advance so a second tap steps to the next. */
  function jumpToNextPin() {
    if (!activePin) return;
    const node = messageNodes.current.get(activePin.id);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(activePin.id);
    if (pinnedMessages.length > 1) setPinCursor((c) => c + 1);
  }

  if (loading) {
    return (
      <main className="chat-canvas flex h-screen items-center justify-center">
        <p className="chat-meta">Loading...</p>
      </main>
    );
  }

  return (
    <main className="chat-canvas relative flex h-screen flex-col overflow-hidden">
      <div className="relative z-10 flex h-full flex-col">

        {/* Header — single compact row, WhatsApp style */}
        <div className="chat-chrome flex-shrink-0 border-b px-2 py-2">
          {searchOpen ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={closeSearch}
                className="chat-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                aria-label="Close search"
              >
                <ArrowLeft size={20} />
              </button>
              <input
                autoFocus
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search messages..."
                className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-[var(--chat-meta)]"
              />
              <span className="chat-meta shrink-0 px-1 text-xs">
                {searchHits.length ? `${activeHit + 1}/${searchHits.length}` : searchQuery.trim() ? "0/0" : ""}
              </span>
              <button
                type="button"
                onClick={() => stepSearch(1)}
                disabled={!searchHits.length}
                className="chat-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
                aria-label="Older match"
              >
                <ChevronUp size={18} />
              </button>
              <button
                type="button"
                onClick={() => stepSearch(-1)}
                disabled={!searchHits.length}
                className="chat-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
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
                className="chat-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                aria-label="Back"
              >
                <ArrowLeft size={20} />
              </button>
              <img
                src={generatedAvatarUrl(otherUserId || "ghost")}
                alt=""
                className="chat-bubble h-9 w-9 shrink-0 rounded-full object-cover p-0.5"
              />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[15px] font-bold">{otherLabel}</p>
                <p
                  className={`truncate text-[11px] ${otherTyping || otherUserOnline ? "" : "chat-meta"}`}
                  style={otherTyping || otherUserOnline ? { color: "var(--theme-success)" } : undefined}
                >
                  {otherTyping ? "typing..." : otherUserOnline ? "online" : "offline"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="chat-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                aria-label="Search messages"
              >
                <Search size={19} />
              </button>
            </div>
          )}
        </div>

        {/* Pinned messages bar.
            Previously this only *displayed* the newest pin. WhatsApp's bar is a
            control: tapping it jumps to the message, and tapping again cycles to
            the next pin rather than re-jumping to the same one. */}
        {activePin && (
          <div
            className="chat-chrome flex-shrink-0 border-b"
            style={{ borderColor: "color-mix(in srgb, var(--theme-warning) 28%, transparent)" }}
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={jumpToNextPin}
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs"
                style={{ color: "var(--theme-warning)" }}
                aria-label={`Jump to pinned message${pinnedMessages.length > 1 ? `, ${pinIndex + 1} of ${pinnedMessages.length}` : ""}`}
              >
                <Pin size={12} className="shrink-0" />
                <span className="truncate">{messagePreviewText(activePin)}</span>
                {pinnedMessages.length > 1 && (
                  <span className="shrink-0 opacity-60">
                    {pinIndex + 1}/{pinnedMessages.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => togglePin(activePin)}
                className="chat-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                aria-label="Unpin this message"
              >
                <PinOff size={13} />
              </button>
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={messagesContainerRef} className="relative flex-1 overflow-y-auto">
          <div className="relative min-h-full px-3 py-4 md:px-6">
            <ChatDoodleBackground />

            {!chatUnlocked && (
              <div className="chat-bubble rounded-3xl p-6 text-center">
                <div
                  className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full"
                  style={{ background: "color-mix(in srgb, var(--theme-accent-purple) 16%, transparent)", color: "var(--theme-accent-purple)" }}
                >
                  <LockKeyhole />
                </div>
                <h2 className="text-2xl font-black">Chat locked</h2>
                <p className="chat-meta mx-auto mt-2 max-w-sm text-sm">
                  {isFriendConversation
                    ? "Unlock this friend conversation once for 40 Coins to send messages."
                    : "Unlock this anonymous conversation once to send messages normally."}
                </p>
                <button
                  onClick={unlockChat}
                  disabled={unlocking}
                  className="mt-5 inline-flex items-center gap-2 rounded-2xl px-5 py-3 font-black shadow-lg transition active:scale-95 disabled:opacity-60"
                  style={{
                    background: "linear-gradient(135deg, var(--theme-accent-from), var(--theme-accent-to))",
                    color: "var(--theme-accent-contrast)",
                  }}
                >
                  <Coins size={18} /> {unlocking ? "Unlocking..." : `Unlock for ${UNLOCK_CHAT_COST} Coins`}
                </button>
              </div>
            )}

            {messages.length === 0 ? (
              <p className="chat-meta mt-10 text-center">Say hi 👻 — they won&apos;t know who you are.</p>
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
                        <span className="chat-day-chip rounded-full px-3 py-1 text-[11px] font-semibold backdrop-blur-md">
                          {dayLabel(msg.created_at)}
                        </span>
                      </div>
                    )}
                    <MessageBubble
                      msg={msg}
                      isMe={msg.sender_id === myId}
                      repliedMsg={msg.reply_to_id ? messagesById.get(msg.reply_to_id) ?? null : null}
                      msgReactions={reactionsByMessage.get(msg.id) ?? NO_REACTIONS}
                      isActionMenuOpen={actionMenuFor === msg.id}
                      setActionMenuFor={setActionMenuFor}
                      toggleReaction={toggleReaction}
                      setReplyingTo={setReplyingTo}
                      startPress={startPress}
                      cancelPress={cancelPress}
                      onSwipeReply={setReplyingTo}
                      onViewPhoto={handleViewPhoto}
                      onPlayAudio={handlePlayAudio}
                      viewingPhotoId={viewingPhotoId}
                      onDelete={setDeleteConfirm}
                      onCopy={copyMessage}
                      onPin={togglePin}
                      isPinned={pinnedMessageIds.has(msg.id)}
                      isGroupStart={isGroupStart}
                      isGroupEnd={isGroupEnd}
                      isSearchHit={searchHitSet.has(msg.id)}
                      isActiveHit={searchHits[activeHit] === msg.id}
                      isHighlighted={highlightedId === msg.id}
                      onJumpToQuote={jumpToMessage}
                      registerRef={registerMessageRef}
                    />
                  </div>
                );
              })
            )}
            {otherTyping && (
              <div className="mt-3 flex items-end gap-2">
                <div className="chat-bubble rounded-2xl rounded-bl-sm px-4 py-3">
                  <span className="flex items-center gap-1.5" aria-label={`${otherLabel} is typing`}>
                    <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--chat-meta)] [animation-delay:-0.2s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--chat-meta)] [animation-delay:-0.1s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--chat-meta)]" />
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
              className="chat-chrome pointer-events-auto absolute bottom-3 right-4 flex h-11 w-11 items-center justify-center rounded-full border shadow-lg"
              style={{ color: "var(--chat-icon)" }}
              aria-label={unseenCount ? `${unseenCount} new messages, scroll to latest` : "Scroll to latest"}
            >
              <ChevronDown size={20} />
              {unseenCount > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-black"
                  style={{
                    background: "linear-gradient(135deg, var(--theme-accent-from), var(--theme-accent-to))",
                    color: "var(--theme-accent-contrast)",
                  }}
                >
                  {unseenCount > 99 ? "99+" : unseenCount}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Pending photo preview */}
        {pendingPhoto && (
          <div className="chat-field mx-3 mb-2 flex flex-shrink-0 items-center gap-3 rounded-xl px-3 py-2 md:mx-6">
            <img src={pendingPhoto.previewUrl} alt="Selected photo" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
            <p className="chat-meta flex-1 truncate text-xs">Ready to send — costs {SEND_IMAGE_COST} coins</p>
            <button type="button" onClick={cancelPendingPhoto} disabled={uploadingPhoto} className="chat-icon disabled:opacity-60">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Reply preview */}
        {replyingTo && (
          <div
            className="chat-field mx-3 mb-2 flex flex-shrink-0 items-center justify-between rounded-xl px-3 py-2 md:mx-6"
            style={{ borderLeft: "3px solid var(--theme-accent-purple)" }}
          >
            <p className="chat-meta truncate text-xs">Replying to: {messagePreviewText(replyingTo)}</p>
            <button onClick={() => setReplyingTo(null)} className="chat-icon" aria-label="Cancel reply">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Emoji picker */}
        {showEmojiPicker && (
          <div className="chat-chrome flex-shrink-0 border-t px-3 py-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="chat-meta text-[11px] font-semibold uppercase tracking-wide">Emoji</span>
              <button
                type="button"
                onClick={() => setShowEmojiPicker(false)}
                className="chat-icon flex h-7 w-7 items-center justify-center rounded-full"
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
                  className="chat-icon flex h-9 items-center justify-center rounded-lg text-xl transition"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Attachment sheet */}
        {showAttachSheet && (
          <div className="chat-chrome flex-shrink-0 border-t px-4 py-4">
            <div className="flex items-start gap-6">
              <button
                type="button"
                onClick={() => { setShowAttachSheet(false); triggerPhotoPicker(); }}
                className="chat-meta flex flex-col items-center gap-2 text-[11px] font-semibold"
              >
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-600"
                  style={{ color: "#ffffff" }}
                >
                  <ImagePlus size={20} />
                </span>
                Gallery
              </button>
              <button
                type="button"
                onClick={() => { setShowAttachSheet(false); triggerCameraPicker(); }}
                className="chat-meta flex flex-col items-center gap-2 text-[11px] font-semibold"
              >
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600"
                  style={{ color: "#ffffff" }}
                >
                  <Camera size={20} />
                </span>
                Camera
              </button>
              <p className="chat-meta ml-auto max-w-[46%] text-[11px] leading-4">
                Photos send as view-once and cost {SEND_IMAGE_COST} coins. Your identity stays hidden either way.
              </p>
            </div>
          </div>
        )}

        {/* Input form */}
        <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="flex-shrink-0 p-3 pt-2 md:px-6">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelected} />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoSelected} />

          {/* Two elements, not one: the pill holds everything that acts on the
              draft, and the circle beside it is the single commit control. That
              split is what lets the mic and the send button be the same button
              in two states rather than two buttons competing for the corner.
              `relative` is load-bearing — the recorder's bar and panel are
              absolutely positioned over this row, so recording replaces the
              pill and the circle together. */}
          <div className="relative flex items-end gap-2">
            <div className="chat-field flex min-w-0 flex-1 items-end gap-0.5 rounded-[26px] p-1">
              <button
                type="button"
                onClick={() => { setShowEmojiPicker((open) => !open); setShowAttachSheet(false); }}
                className="chat-icon mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition"
                aria-label="Emoji"
                aria-expanded={showEmojiPicker}
              >
                <Smile size={21} />
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={pendingPhoto ? "Add a caption (optional)..." : chatUnlocked ? "Message" : "Unlock chat to send messages"}
                disabled={!chatUnlocked}
                rows={1}
                className="max-h-32 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2.5 leading-6 outline-none placeholder:text-[var(--chat-meta)] disabled:cursor-not-allowed disabled:opacity-60"
              />
              {/* Paperclip keeps opening the sheet — gallery, and anything added
                  later. Camera skips it, because reaching for the camera is
                  already an unambiguous choice. */}
              <button
                type="button"
                onClick={() => { setShowAttachSheet((open) => !open); setShowEmojiPicker(false); }}
                disabled={uploadingPhoto}
                title={`Attach an image (${SEND_IMAGE_COST} coins)`}
                aria-label="Attach"
                className="chat-icon mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition disabled:opacity-60"
                aria-expanded={showAttachSheet}
              >
                <Paperclip size={20} />
              </button>
              <button
                type="button"
                onClick={() => { setShowEmojiPicker(false); setShowAttachSheet(false); triggerCameraPicker(); }}
                disabled={uploadingPhoto}
                title={`Take a photo (${SEND_IMAGE_COST} coins)`}
                aria-label="Camera"
                className="chat-icon mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition disabled:opacity-60"
              >
                <Camera size={20} />
              </button>
            </div>

            {/* One slot, two meanings. With a draft it commits; empty, it's the
                mic. Swapping in place rather than showing both is what keeps a
                voice note one press away without a permanent second button.
                While a take is in flight the swap is suspended outright — the
                textarea underneath the panel can still hold focus on desktop,
                and a stray keystroke unmounting the recorder would end the
                recording rather than just change a button. */}
            {!recordingVoice && (input.trim().length > 0 || pendingPhoto) ? (
              <button
                type="submit"
                disabled={!chatUnlocked || (pendingPhoto ? uploadingPhoto : false)}
                aria-label={pendingPhoto ? `Send photo for ${SEND_IMAGE_COST} coins` : "Send message"}
                className={`chat-send-circle chat-send-circle-press flex h-[52px] shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50 ${pendingPhoto ? "gap-1.5 px-4" : "w-[52px]"}`}
              >
                {pendingPhoto ? (
                  uploadingPhoto ? <Loader2 size={18} className="animate-spin" /> : (
                    <><Coins size={17} /><span className="text-sm font-black">{SEND_IMAGE_COST}</span></>
                  )
                ) : (
                  <Send size={19} />
                )}
              </button>
            ) : (
              /* Hold to record, slide left to cancel, slide up to lock. */
              <VoiceRecorder
                canRecord={chatUnlocked}
                cost={SEND_VOICE_COST}
                busy={uploadingPhoto}
                onBlocked={() => showToast(isFriendConversation
                  ? "You need 40 coins to unlock this conversation."
                  : `Unlock this chat once for ${UNLOCK_CHAT_COST} Whisper Coins first.`)}
                onSend={handleVoiceNote}
                onError={showToast}
                onRecordingChange={setRecordingVoice}
              />
            )}
          </div>
        </form>
      </div>

      {/* Pin duration. A sheet rather than a centred dialog: it's a choice, not
          a confirmation, and it drops from the bar it affects. */}
      {pinDurationFor && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          onClick={() => setPinDurationFor(null)}
        >
          <GlassPanel
            strong
            className="w-full max-w-sm rounded-t-3xl p-5 sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center gap-2">
              <Pin size={16} style={{ color: "var(--theme-warning)" }} />
              <h2 className="text-base font-black">Pin this message</h2>
            </div>
            <p className="mb-4 truncate text-sm text-[var(--theme-text-muted)]">
              {messagePreviewText(pinDurationFor)}
            </p>
            <div className="flex flex-col gap-1.5">
              {PIN_DURATIONS.map((duration) => (
                <button
                  key={duration.label}
                  type="button"
                  onClick={() => confirmPin(pinDurationFor, duration.hours)}
                  className="glass-control flex items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-semibold"
                >
                  <span className="capitalize">{duration.label}</span>
                  {duration.hours === null && <PinOff size={14} className="opacity-50" />}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPinDurationFor(null)}
              className="mt-3 w-full rounded-xl py-2.5 text-sm font-bold text-[var(--theme-text-muted)]"
            >
              Cancel
            </button>
          </GlassPanel>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <GlassPanel strong className="w-full max-w-sm rounded-3xl p-6 text-center">
            <Trash2 size={32} className="mx-auto mb-3 text-rose-500" />
            <h2 className="text-lg font-black">Delete message?</h2>
            <p className="mt-1 text-sm text-[var(--theme-text-muted)]">This will be removed for everyone.</p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 rounded-2xl border border-[var(--theme-border)] py-2 text-sm font-bold text-[var(--theme-text-secondary)]"
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
              /* Fixed white, not a token: this sits on an always-black scrim in
                 both themes, so it must not follow the theme's text colour. */
              <p className="mb-3 text-center text-sm font-medium" style={{ color: "#ffffff" }}>{photoModalCaption}</p>
            )}
            <img src={photoModalUrl} alt="View-once photo" className="max-h-[80vh] max-w-full rounded-2xl object-contain" />
            <p className="mt-3 text-center text-xs" style={{ color: "rgba(255,255,255,0.65)" }}>This photo won&apos;t be available again after you close this view.</p>
            <button onClick={closePhotoModal} className="absolute -top-3 -right-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-lg">
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}