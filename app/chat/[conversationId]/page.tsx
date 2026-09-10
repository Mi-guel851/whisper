"use client";

import ChatDoodleBackground from "@/components/ChatDoodleBackground";
import MessageStatus from "@/components/MessageStatus";
import { tempId } from "@/lib/tempId";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, useMemo, useRef, useState, useCallback, memo } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { safeErrorMessage } from "@/lib/safeErrorMessage";
import { getCachedSession } from "@/lib/supabase/session";
import GlassPanel from "@/components/GlassPanel";
import { UNLOCK_CHAT_COST, SEND_IMAGE_COST, SEND_VOICE_COST } from "@/lib/coins";
import { requireOnline } from "@/lib/offline";
import { anonNameOf, resolveAnonName } from "@/lib/anonNames";
import { PROSE_INPUT_PROPS } from "@/lib/textEntry";
import { typingManager } from "@/lib/realtime/typing";
import { presenceManager } from "@/lib/realtime/presence";
import { useToast } from "@/components/ToastProvider";
import { generatedAvatarUrl } from "@/lib/generatedAvatar";
import { useEventCallback } from "@/lib/useEventCallback";
import useViewportFrame from "@/lib/useViewportFrame";
import VoiceRecorder from "@/components/chat/VoiceRecorder";
import VoicePlayer from "@/components/chat/VoicePlayer";
import ChatSkeleton from "@/components/chat/ChatSkeleton";
import MediaPicker, { type MediaTab } from "@/components/chat/MediaPicker";
import MediaMessage from "@/components/chat/MediaMessage";
import ChatPrivacyNotice from "@/components/chat/ChatPrivacyNotice";
import { useMediaQuery } from "@/lib/useMediaQuery";
import {
  pushRecentEmoji,
  pushRecentSticker,
  BUNDLED_STICKER_SIZE,
  type StickerDef,
} from "@/lib/chatMedia";
import PaperPlaneFlight from "@/components/PaperPlaneFlight";
import ExplodingInput from "@/components/ui/ExplodingInput";
import type { VoiceRecording } from "@/lib/useVoiceRecorder";
import { messagePreviewText } from "@/lib/messagePreview";
import {
  CLOUDINARY_FOLDERS,
  CloudinaryUploadError,
  discardCloudinaryUpload,
  uploadToCloudinary,
  uploadRemoteToCloudinary,
} from "@/lib/cloudinary";
import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  Send, X, CornerUpLeft, LockKeyhole, Coins, ImagePlus, Eye, Loader2, Trash2, Pin, PinOff,
  ArrowLeft, Search, ChevronDown, ChevronUp, Smile, Paperclip, Camera, Copy, Handshake, Check, Phone,
} from "lucide-react";
import Button from "@/components/Button";
import { useVoiceCall } from "@/lib/calls/useVoiceCall";
import IncomingCallOverlay from "@/components/calls/IncomingCallOverlay";
import InCallSheet from "@/components/calls/InCallSheet";
import CallEntryRow from "@/components/chat/CallEntryRow";
import type { CallEntryInfo } from "@/lib/calls/callFormat";

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
  media_url: string | null;
  media_kind: "gif" | "sticker" | null;
  media_width: number | null;
  media_height: number | null;
  /**
   * Client-only. Never written to the database and never read back from it.
   *
   * `sending` is set the instant SEND is pressed, before any request is in
   * flight; `failed` replaces it when the insert comes back with an error. Both
   * disappear when the row is reconciled against the real one. Its presence in
   * the type is what lets an optimistic message and a delivered one live in the
   * same list without a parallel array to keep in sync.
   */
  send_state?: "sending" | "failed";
  /**
   * Client-only, and the mirror-image trick of the same idea: a `call_logs`
   * row (server data, different table) wearing the Message shape long enough
   * to be interleaved into the timeline by time. `call_entry` is the payload;
   * every other field on the carrier row is filler the bubble never reads,
   * because MessageBubble branches to <CallEntryRow> first.
   */
  call_entry?: CallEntryInfo;
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

const PIN_DURATIONS: { label: string; hours: number | null }[] = [
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
  { label: "until I remove it", hours: null },
];

/* Push for a new message is sent by the database, not from here.
   `direct_message_notification_trigger` writes the notifications row and
   202608190003 delivers it — see the note in that migration.

   What used to be here was a `fetch` to notify-new-direct-message with no
   Authorization header. Supabase edge functions verify a JWT by default, so
   every one of those calls was rejected with 401 before the function ran, and
   `.catch()` never saw it because a 401 is a resolved response, not a network
   error. That is why inbox pushes were silent while whispers worked.

   Sending it from SQL also covers the paths this helper could not: a voice note
   inserted by an RPC, and any message written while the sender's page is
   navigating away mid-request. */

function bubbleTime(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

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
    return message;
  }
  return message;
}

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

const MessageBubble = memo(function MessageBubbleBase({
  msg, isMe, repliedMsg, msgReactions, isActionMenuOpen, setActionMenuFor,
  toggleReaction, setReplyingTo, startPress, cancelPress, onSwipeReply,
  onViewPhoto, onPlayAudio, viewingPhotoId, onDelete, onCopy, onPin,
  isPinned, isGroupStart, isGroupEnd, isSearchHit, isActiveHit, isHighlighted,
  onJumpToQuote, registerRef, onRetry,
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
  /** Present for every row, used only by one whose send failed. */
  onRetry: (msg: Message) => void;
}) {
  const x = useMotionValue(0);
  const replyIconOpacity = useTransform(x, [0, SWIPE_THRESHOLD], [0, 1]);
  const tailCorner = isGroupEnd ? (isMe ? "rounded-br-sm" : "rounded-bl-sm") : "";
  /* `image_viewed_at` counts as evidence a photo was here, not just `image_path`.
     A spent view-once photo has no `image_path` any more — the server deletes the
     object and clears the column the moment it is opened, which is the entire point
     of view-once — so testing the path alone made a viewed photo stop looking like a
     photo message at all. It fell through to the text branch below, and a photo
     message has no `content`, so it rendered as an empty bubble with nothing in it
     but a timestamp. The audio arm on the next line already had this right; the
     photo arm simply never got the same treatment. */
  const isPhotoMessage = Boolean(msg.image_path) || Boolean(msg.image_viewed_at);
  const isAudioMessage = Boolean(msg.audio_path) || Boolean(msg.audio_viewed_at);
  /* GIFs and stickers ride on `media_url`/`media_kind` — ordinary rows with a
     different renderer. A sticker drops the bubble entirely (the transparent
     artwork is the message); a GIF keeps a clipped frame inside the bubble. */
  const isStickerMessage = Boolean(msg.media_url) && msg.media_kind === "sticker";
  const isGifMessage = Boolean(msg.media_url) && msg.media_kind === "gif";
  /* `is_view_once` is still required so a plain photo attachment can never be
     mislabelled as one-time; `image_viewed_at` is accepted alongside it purely as a
     fallback for a spent row whose flag has been cleared. */
  const isMediaMessage =
    isAudioMessage || ((msg.is_view_once || Boolean(msg.image_viewed_at)) && isPhotoMessage);
  /* Only a message that actually contains an unbreakable run — a pasted link, an
     email, a 40-character handle — opts into `overflow-wrap: anywhere`. Ordinary
     text keeps `break-word`, whose min-content is the longest word, so the bubble
     is always at least as wide as the word it holds and never splits one. */
  const hasUnbreakableRun = msg.content ? /\S{24,}/.test(msg.content) : false;

  return (
    <div
      ref={(node) => registerRef(msg.id, node)}
      /* `chat-msg` is the hook the frame's `.chat-context-active` selector blurs;
         `chat-msg-focused` is how the held bubble opts out of it and lifts above
         its neighbours. Both are className-only, so opening a menu re-renders this
         one bubble rather than every bubble in the thread. */
      className={`chat-msg flex ${isMe ? "justify-end" : "justify-start"} ${isGroupStart ? "mt-3" : "mt-0.5"} ${
        isActionMenuOpen ? "chat-msg-focused" : ""
      }`}
    >
      {/* `min-w-0` so the 80% cap always wins: without it a flex item's automatic
          minimum size is its min-content width, and a single very long word would
          push the bubble past the cap and give the thread a horizontal scrollbar
          instead of wrapping inside the bubble. */}
      <div className="relative min-w-0 max-w-[80%]">
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
          {isStickerMessage ? (
            /* No bubble: transparency is the point. The timestamp gets its own
               floating chip so it stays legible over the wallpaper. */
            <div
              className={`flex flex-col select-none ${isMe ? "items-end" : "items-start"} ${
                isHighlighted ? "chat-bubble-flash rounded-2xl" : ""
              }`}
            >
              {repliedMsg && (
                <button
                  type="button"
                  onClick={() => onJumpToQuote(repliedMsg.id)}
                  className="chat-quote mb-1 block max-w-[200px] truncate rounded-sm py-1 pl-2 pr-2 text-left text-xs"
                >
                  {messagePreviewText(repliedMsg)}
                </button>
              )}
              <MediaMessage
                url={msg.media_url!}
                kind="sticker"
                width={msg.media_width}
                height={msg.media_height}
              />
              {msg.content && (
                <div className={`chat-bubble ${isMe ? "chat-bubble-out" : ""} mt-1 rounded-2xl px-3 py-1.5`}>
                  <p className="chat-text text-sm">{msg.content}</p>
                </div>
              )}
              <div className="chat-day-chip mt-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] leading-none">
                {bubbleTime(msg.created_at)}
                {isMe && (
                    <MessageStatus
                      sendState={msg.send_state}
                      deliveredAt={msg.delivered_at}
                      readAt={msg.read_at}
                      onRetry={() => onRetry(msg)}
                    />
                  )}
              </div>
            </div>
          ) : (
          <div
            className={`chat-bubble ${isMe ? "chat-bubble-out" : ""} ${
              isHighlighted ? "chat-bubble-flash" : ""
            } rounded-2xl select-none ${isGifMessage ? "overflow-hidden p-1" : "px-3 py-2"} ${tailCorner} ${
              isPinned ? "ring-1 ring-yellow-400/50" : ""
            } ${isActiveHit ? "ring-2 ring-cyan-300" : isSearchHit ? "ring-1 ring-cyan-400/40" : ""}`}
          >
            {isPinned && (
              <div className={`mb-1 flex items-center gap-1 text-[10px] ${isGifMessage ? "px-2 pt-1" : ""}`} style={{ color: "var(--theme-warning)" }}>
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

            {isGifMessage ? (
              <div>
                <MediaMessage
                  url={msg.media_url!}
                  kind="gif"
                  width={msg.media_width}
                  height={msg.media_height}
                />
                {msg.content && (
                  <p className="chat-text px-2 pt-1 text-sm">{msg.content}</p>
                )}
                <div className="chat-meta flex items-center justify-end gap-1 px-2 py-1 text-[10px] leading-none">
                  {bubbleTime(msg.created_at)}
                  {isMe && (
                    <MessageStatus
                      sendState={msg.send_state}
                      deliveredAt={msg.delivered_at}
                      readAt={msg.read_at}
                      onRetry={() => onRetry(msg)}
                    />
                  )}
                </div>
              </div>
            ) : isMediaMessage ? (
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
                      {/* "Photo viewed", matching the voice note's "Played" and the
                          reply quote's "📷 Photo viewed". A spent one-time message
                          has to say what it was and that it is gone — "Opened" said
                          neither clearly enough to tell the two media types apart. */}
                      {msg.image_viewed_at
                        ? "Photo viewed"
                        : viewingPhotoId === msg.id
                          ? "Opening…"
                          : isMe
                            ? "Photo · once"
                            : "Tap to open"}
                    </span>
                  </button>
                ) : null}
                {msg.content && (
                  <p className={`chat-text mt-1 text-sm ${hasUnbreakableRun ? "chat-text-unbroken" : ""}`}>
                    {msg.content}
                  </p>
                )}
                <div className="chat-meta mt-1 flex items-center justify-end gap-1 text-[10px] leading-none">
                  {bubbleTime(msg.created_at)}
                  {isMe && (
                    <MessageStatus
                      sendState={msg.send_state}
                      deliveredAt={msg.delivered_at}
                      readAt={msg.read_at}
                      onRetry={() => onRetry(msg)}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className={`chat-text text-sm ${hasUnbreakableRun ? "chat-text-unbroken" : ""}`}>
                <span className="chat-meta float-right ml-2 mt-1.5 flex items-center gap-1 text-[10px] leading-none">
                  {bubbleTime(msg.created_at)}
                  {isMe && (
                    <MessageStatus
                      sendState={msg.send_state}
                      deliveredAt={msg.delivered_at}
                      readAt={msg.read_at}
                      onRetry={() => onRetry(msg)}
                    />
                  )}
                </span>
                {/* WHY THE TEXT IS INLINE HERE AND NOT IN ITS OWN `<p>`
                    ────────────────────────────────────────────────────────────
                    The timestamp is a right float, so it shortens the first line
                    the text gets. When the text lived in a `<p>` — a block sibling
                    of the float — the browser sized the bubble from the paragraph
                    alone: the float's width was never counted, so the bubble came
                    out exactly as wide as the text and the float then stole space
                    the text had already been measured into. Every short message
                    lost its last word to a second line ("More to come / 🥹"), and a
                    single word with nowhere to go was broken mid-word instead
                    ("Wassu / p").

                    Rendering the content as inline text in the same block as the
                    float puts both in one inline formatting context, where the
                    float's width *is* part of the intrinsic width. The bubble is
                    now measured as text + timestamp, so "More to come 🥹" sits on
                    one line beside its time, and wrapping only happens at spaces
                    once the text genuinely reaches the 80% cap. Nothing moves
                    visually: the float still sits in the top-right of the bubble
                    and the text still flows around it.

                    The wrapping rules themselves live in `.chat-text`
                    (pre-wrap + break-word + word-break:normal) in globals.css. */}
                {msg.content}
              </div>
            )}
          </div>
          )}
        </motion.div>

        {Object.keys(msgReactions).length > 0 && (
          <div className={`-mt-1.5 flex gap-1 ${isMe ? "justify-end" : "justify-start"}`}>
            {Object.entries(msgReactions).map(([emoji, count]) => (
              <span key={emoji} className="chat-bubble rounded-full px-1.5 py-0.5 text-[11px] leading-none">
                {emoji} {count > 1 ? count : ""}
              </span>
            ))}
          </div>
        )}

        {!isPhotoMessage && isActionMenuOpen && (
          <div className={`absolute z-20 -top-16 ${isMe ? "right-0" : "left-0"}`}>
            <div className="chat-chrome flex items-center gap-1 rounded-full border px-2 py-2 shadow-xl">
              {EMOJIS.map((emoji) => (
                <button key={emoji} onClick={() => toggleReaction(msg.id, emoji)} className="text-lg transition hover:scale-125">
                  {emoji}
                </button>
              ))}
              <button onClick={() => onCopy(msg)} className="chat-icon ml-1 flex h-7 w-7 items-center justify-center rounded-full" title="Copy">
                <Copy size={14} />
              </button>
              <button onClick={() => { setReplyingTo(msg); setActionMenuFor(null); }} className="chat-icon flex h-7 w-7 items-center justify-center rounded-full" title="Reply">
                <CornerUpLeft size={14} />
              </button>
              <button onClick={() => { onPin(msg); setActionMenuFor(null); }} className="chat-icon flex h-7 w-7 items-center justify-center rounded-full" title={isPinned ? "Unpin" : "Pin"}>
                {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
              {isMe && (
                <button onClick={() => { onDelete(msg); setActionMenuFor(null); }} className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/20 hover:bg-rose-500/40" title="Delete">
                  <Trash2 size={14} className="text-rose-500" />
                </button>
              )}
              <button onClick={() => setActionMenuFor(null)} className="chat-icon flex h-7 w-7 items-center justify-center rounded-full" aria-label="Close">
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * One page of thread history. 400 covers any active conversation's visible
 * scrollback many times over while keeping the initial payload and the
 * windowing arithmetic (unread marks, reactions chunks) well inside what a
 * GET query string can carry. "Load older" pages in MESSAGES_PAGE_SIZE rows
 * at a time from the top of the list.
 */
const MESSAGES_PAGE_SIZE = 400;

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const { showToast } = useToast();
  const conversationId = params.conversationId as string;

  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [pinnedMessageIds, setPinnedMessageIds] = useState<Set<string>>(new Set());
  /* Call outcomes for this conversation, keyed by call_logs.id so an INSERT
     and the UPDATE that closes the same call can never render two entries.
     Server state, realtime-refreshed: a missed call recorded while this
     screen was closed shows up the moment it is opened, and a call answered
     on the caller's side converges here without a timer. */
  const [callEntries, setCallEntries] = useState<Record<string, CallEntryInfo>>({});
  const [pinDurationFor, setPinDurationFor] = useState<Message | null>(null);
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
  /* The gate reads (friendship, unlock, pending request) FAILED — as opposed
     to answering "locked". A failed check must never masquerade as a paywall:
     while this is set the composer shows a retry instead of a dead input
     nobody explained. */
  const [gateError, setGateError] = useState<string | null>(null);
  const [gateChecking, setGateChecking] = useState(false);
  /*
   * The pending-request state behind the messaging gates (202609090002):
   *
   *   direction "incoming"  — the OTHER user asked to be friends. I must
   *                           accept before I may reply; the banner + locked
   *                           composer are this direction.
   *   direction "outgoing"  — I asked. I may send (after the coin unlock);
   *                           no banner for me, but if the request is
   *                           declined or I cancel it, the database deletes
   *                           the thread and this screen must leave, not sit
   *                           in a conversation that no longer exists.
   *
   * The database is the source of truth for all of it; this state only
   * decides what to draw between re-checks.
   */
  const [pendingRequest, setPendingRequest] = useState<{ id: string; direction: "incoming" | "outgoing" } | null>(null);
  const [acceptingRequest, setAcceptingRequest] = useState(false);
  const [decliningRequest, setDecliningRequest] = useState(false);

  /*
   * Accept-lock takes precedence over the coin lock. Paying 40 coins does not
   * make the reply legal — the database only allows it after the request is
   * accepted — so the paywall panel must not be offered where it can't be
   * satisfied; the "Accept the request to reply" state is. Both locks
   * coexist in the database; this ordering only decides which one the screen
   * shows first.
   */
  const acceptLocked = !loading && pendingRequest?.direction === "incoming" && !isFriendConversation;
  const composerLocked = !loading && !chatUnlocked && !acceptLocked;

  /*
   * The voice call, if this thread is an accepted friendship. `enabled` is
   * the whole feature gate: no friendship (the send gate's relationship arm
   * says so, not the UI) means no channel, no media, nothing — and a
   * pending thread can never ring, because a pending pair is not a friend
   * pair.
   */
  const call = useVoiceCall({
    conversationId,
    myId,
    otherUserId,
    enabled: Boolean(isFriendConversation) && !loading && Boolean(myId) && Boolean(otherUserId),
    onNotice: showToast,
  });

  /* The timeline of call outcomes. Fetch once the thread is open, then keep
     it exact via realtime; both write the same id-keyed map, so repeats are
     structural no-ops rather than duplicate rows. */
  useEffect(() => {
    if (!conversationId) return;
    let active = true;

    async function loadCallLogs() {
      const { data } = await supabase
        .from("call_logs")
        .select("id,caller_id,callee_id,started_at,ended_at,status")
        .eq("conversation_id", conversationId)
        .order("started_at", { ascending: true })
        .limit(120);
      if (!active || !data) return;
      const next: Record<string, CallEntryInfo> = {};
      for (const row of data as unknown as CallEntryInfo[]) {
        next[row.id] = row;
      }
      setCallEntries(next);
    }
    void loadCallLogs();

    const channel = supabase
      .channel(`call-entries-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "call_logs", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = (payload.new ?? {}) as Partial<CallEntryInfo>;
          const rowId = row.id;
          if (!rowId) return;
          if (payload.eventType === "DELETE") {
            setCallEntries((prev) => {
              if (!(rowId in prev)) return prev;
              const copy = { ...prev };
              delete copy[rowId];
              return copy;
            });
            return;
          }
          setCallEntries((prev) => ({ ...prev, [rowId]: row as CallEntryInfo }));
          /* An outcome that lands while the user is looking: the missed-call
             banner (if any) is already redundant — the thread is THE view of
             it. */
          if ((row.status === "missed" || row.status === "expired") && payload.eventType === "UPDATE") {
            void loadCallLogs();
          }
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  const visibleTimeline = useMemo(() => {
    const calls = Object.values(callEntries);
    if (calls.length === 0) return messages;
    const carriers: Message[] = calls.map((entry) => ({
      id: `call:${entry.id}`,
      sender_id: entry.caller_id,
      content: null,
      created_at: entry.started_at,
      reply_to_id: null,
      image_path: null,
      audio_path: null,
      audio_duration_ms: null,
      audio_waveform: null,
      audio_mime: null,
      is_view_once: false,
      image_viewed_at: null,
      audio_viewed_at: null,
      delivered_at: entry.ended_at,
      read_at: entry.ended_at,
      media_url: null,
      media_kind: null,
      media_width: null,
      media_height: null,
      call_entry: entry,
    }));
    return [...messages, ...carriers].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id)
    );
  }, [messages, callEntries]);
  const [actionMenuFor, setActionMenuFor] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [viewingPhotoId, setViewingPhotoId] = useState<string | null>(null);
  const [photoModalUrl, setPhotoModalUrl] = useState<string | null>(null);
  const [photoModalCaption, setPhotoModalCaption] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Message | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeHit, setActiveHit] = useState(0);
  /* One state pair drives the whole media picker: open/closed plus which tab.
     Tapping the composer's smile button toggles it; tapping the input closes
     it (the keyboard takes its place); tapping the active button again closes
     it. `mediaSending` holds the URL of the sticker/GIF mid-flight so the grid
     can pin a spinner on exactly that item. */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<MediaTab>("emoji");
  const [mediaSending, setMediaSending] = useState<string | null>(null);
  const [showAttachSheet, setShowAttachSheet] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [atBottom, setAtBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  /* The content box inside the scroller. Watched on open, because its height is
     what keeps changing after first paint. */
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /* The send button, so the paper plane departs from and returns to the real
     icon rather than an arbitrary point. */
  const sendButtonRef = useRef<HTMLButtonElement | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageNodes = useRef<Map<string, HTMLDivElement>>(new Map());
  const atBottomRef = useRef(true);
  const messagesRef = useRef<Message[]>([]);
  const myIdRef = useRef<string>("");

  /* Paper-plane celebration state. `flightId` only moves after the insert comes
     back clean; `flightOrigin` is measured in the handler while the button is
     still on screen. */
  const [flightId, setFlightId] = useState(0);
  const [flightOrigin, setFlightOrigin] = useState<{ x: number; y: number } | null>(null);
  /* Launch point per in-flight send, keyed by the temporary message id. The send
     is no longer synchronous, so the measurement taken at tap time has to survive
     until the insert resolves. */
  const pendingFlightRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { myIdRef.current = myId; }, [myId]);

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
    /* Capped deliberately. `update ... .in("id", ids)` rides the query string;
       a thread with thousands of unread messages would build a URL PostgREST
       rejects outright and nothing would be marked read at all. 200 covers
       every unread message on any realistic phone screen many times over, and
       the rest are marked by the follow-up call when the reader scrolls down. */
    const unreadIds = msgs
      .filter((m) => m.sender_id !== currentUserId && !m.read_at)
      .slice(0, 200)
      .map((m) => m.id);
    if (unreadIds.length === 0) return;
    const readNow = new Date().toISOString();
    const { error } = await supabase.from("direct_messages").update({ read_at: readNow }).in("id", unreadIds);
    if (!error) {
      setMessages((prev) => prev.map((m) => (unreadIds.includes(m.id) ? { ...m, read_at: readNow } : m)));
    }
  }, []);

  /* --------------------------------------------------------------------------
     Paging older history in from the top.
     ------------------------------------------------------------------------ */

  const loadingOlderRef = useRef(false);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderRef.current) return;
    const oldest = messagesRef.current[0];
    if (!oldest) return;

    loadingOlderRef.current = true;
    const container = messagesContainerRef.current;
    const heightBefore = container?.scrollHeight ?? 0;
    const topBefore = container?.scrollTop ?? 0;

    try {
      const { data } = await supabase
        .from("direct_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .lt("created_at", oldest.created_at)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PAGE_SIZE);

      const older = (data || []).slice().reverse();
      if (older.length > 0) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...older.filter((m: Message) => !seen.has(m.id)), ...prev];
        });

        /* Reactions for the newly revealed stretch, chunked like the initial
           fetch. Merged by id — the map is flat and re-renders of a bubble with
           its reactions are just the other bubbles keeping their identity. */
        const ids = older.map((m: Message) => m.id);
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
        void Promise.all(
          chunks.map((chunk) =>
            supabase
              .from("message_reactions")
              .select("message_id, user_id, emoji")
              .in("message_id", chunk)
          )
        ).then((results) => {
          const extra = results.flatMap((r) => r.data || []) as Reaction[];
          if (extra.length > 0) {
            setReactions((prev) => [
              ...prev,
              ...extra.filter((e) => !prev.some((p) => p.message_id === e.message_id && p.user_id === e.user_id)),
            ]);
          }
        });
      }

      setHasOlderMessages((data || []).length === MESSAGES_PAGE_SIZE);

      /* Keep the reader anchored: prepending rows grows the content above the
         viewport, and without this the visible messages would jump down by
         exactly what was added. Measured after React has committed — a
         rAF is the cheap way to land one frame later; ResizeObserver-level
         precision is not worth it for a scroll correction. */
      requestAnimationFrame(() => {
        const c = messagesContainerRef.current;
        if (c) c.scrollTop = c.scrollHeight - heightBefore + topBefore;
      });
    } finally {
      loadingOlderRef.current = false;
    }
  }, [conversationId]);

  /* --------------------------------------------------------------------------
     The messaging-gate relationship check.
     ------------------------------------------------------------------------ */

  const otherUserIdRef = useRef<string>("");
  useEffect(() => { otherUserIdRef.current = otherUserId; }, [otherUserId]);

  /**
   * Re-reads the four facts the composer's state depends on — is the thread
   * still alive, are we friends, is the chat unlocked, is a pending request
   * in flight — and moves the UI to match. The database answers all four;
   * the send policy (202609090002) enforces them independently of this state,
   * so a wrong UI can only confuse, never authorize.
   *
   * A missing conversation row means the thread was torn down (the request
   * died and the database deleted it) — leaving, not lingering in a screen
   * whose server-side row no longer exists, is the same behaviour init
   * already has for an unknown conversation id. A missing row *with* an error
   * means the read failed, and reports instead of redirecting: booting the
   * user out of a healthy chat because the network blinked is not leaving,
   * it's crashing.
   */
  const checkRelationship = useCallback(async () => {
    const uid = myIdRef.current;
    const otherId = otherUserIdRef.current;
    if (!uid || !otherId) return;

    const [convRes, friendRes, unlockRes, reqRes] = await Promise.all([
      supabase.from("conversations").select("id").eq("id", conversationId).maybeSingle(),
      supabase.from("friends").select("id").eq("user_id", uid).eq("friend_id", otherId).maybeSingle(),
      supabase.from("chat_unlocks").select("id").eq("user_id", uid).eq("conversation_id", conversationId).maybeSingle(),
      supabase
        .from("friend_requests")
        .select("id,sender_id,receiver_id")
        .or(`and(sender_id.eq.${otherId},receiver_id.eq.${uid}),and(sender_id.eq.${uid},receiver_id.eq.${otherId})`)
        .eq("status", "pending")
        .maybeSingle(),
    ]);

    if (!convRes.data && !convRes.error) {
      router.push("/active");
      return;
    }
    /* A failed re-check is reported, not acted on: re-locking the composer
       over a dropped read would deaden the typing box with no explanation,
       and that is exactly what "blocked by something invisible" feels like.
       The previous flags stand until a read succeeds. */
    const recheckFailure = convRes.error || friendRes.error || unlockRes.error || reqRes.error;
    setGateError(recheckFailure ? recheckFailure.message || "Couldn't verify this chat." : null);
    if (recheckFailure) return;
    setIsFriendConversation(Boolean(friendRes.data));
    setChatUnlocked(Boolean(unlockRes.data));
    setPendingRequest(
      reqRes.data
        ? {
            id: reqRes.data.id as string,
            direction: (reqRes.data.sender_id as string) === otherId ? "incoming" : "outgoing",
          }
        : null
    );
  }, [conversationId, router]);

  /* One re-check per burst: an acceptance fires four row events (request
     update, two friends inserts, this channel's four subscriptions), and
     re-running three queries four times in a row is just noise. */
  const relationshipCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRelationshipCheck = useCallback(() => {
    if (relationshipCheckTimer.current) return;
    relationshipCheckTimer.current = setTimeout(() => {
      relationshipCheckTimer.current = null;
      void checkRelationship();
    }, 120);
  }, [checkRelationship]);

  /* The composer's "Try again": re-runs the gate reads without tearing down
     the thread, realtime channels, or presence — a tap over a recovered
     connection lands the flags the first attempt missed. */
  async function retryGate() {
    if (gateChecking) return;
    setGateChecking(true);
    try {
      await checkRelationship();
    } finally {
      setGateChecking(false);
    }
  }

  /** Accept from inside the thread — the same two writes the Friends page
      performs, plus the re-check that swaps this screen from the pending
      state into the ordinary friend-chat state (coin paywall if not yet
      unlocked: acceptance does not grant an unlock, rule (c)). */
  async function acceptPendingRequest() {
    if (!myId || !pendingRequest || pendingRequest.direction !== "incoming") return;
    setAcceptingRequest(true);

    const { data: requestRow, error: fetchError } = await supabase
      .from("friend_requests").select("id,sender_id,receiver_id,status")
      .eq("id", pendingRequest.id).eq("receiver_id", myId).eq("status", "pending").maybeSingle();
    if (fetchError) { showToast("Couldn't load this request."); setAcceptingRequest(false); void checkRelationship(); return; }
    if (!requestRow) { setAcceptingRequest(false); void checkRelationship(); return; }

    const { error: updateError } = await supabase.from("friend_requests")
      .update({ status: "accepted", updated_at: new Date().toISOString() })
      .eq("id", pendingRequest.id).eq("receiver_id", myId).eq("status", "pending");
    if (updateError) { showToast(updateError.message); setAcceptingRequest(false); return; }

    const { error: friendError } = await supabase.from("friends")
      .insert({ user_id: myId, friend_id: requestRow.sender_id, source: "request" });
    if (friendError && friendError.code !== "23505") showToast("Accepted, but adding the friend failed.");
    else showToast("Friend added.");
    /* Reverse row so both Friends tabs list the pair — best-effort for the
       same reason as on the Friends page: the gate matches either
       direction, so a policy-rejected reverse row degrades gracefully. */
    const { error: reverseError } = await supabase.from("friends")
      .insert({ user_id: requestRow.sender_id, friend_id: myId, source: "request" });
    if (reverseError && reverseError.code !== "23505") {
      console.warn("Reverse friendship row not written (policy likely owner-only):", reverseError.message);
    }

    setAcceptingRequest(false);
    await checkRelationship();
  }

  /** Decline from inside the thread. The request row is removed by DELETE
      (the existing decline convention), and the database trigger then
      deletes the now-orphaned thread — so the re-check ends in the /active
      redirect rather than a lingering empty screen. */
  async function declinePendingRequest() {
    if (!myId || !pendingRequest || pendingRequest.direction !== "incoming") return;
    setDecliningRequest(true);
    const { error } = await supabase.from("friend_requests")
      .delete().eq("id", pendingRequest.id).eq("receiver_id", myId).eq("status", "pending");
    setDecliningRequest(false);
    if (error) { showToast("Couldn't decline the request."); return; }
    await checkRelationship();
  }

  useEffect(() => {
    let cancelled = false;
    let msgChannel: ReturnType<typeof supabase.channel> | null = null;
    let reactionChannel: ReturnType<typeof supabase.channel> | null = null;
    let relationshipChannel: ReturnType<typeof supabase.channel> | null = null;
    let unsubscribeTyping: (() => void) | undefined;
    let unsubscribePresence: (() => void) | undefined;

    /* ------------------------------------------------------------------------
       WHY THIS IS SHAPED THIS WAY: OPENING A CHAT USED TO TAKE TEN ROUND TRIPS

       Every query here was awaited in sequence, and `setLoading(false)` sat at
       the bottom of the chain — so the first bubble could not paint until all ten
       had returned. On a phone at 150ms latency that is a second and a half of
       spinner for data that mostly arrived in the first third of it. WhatsApp
       opens instantly because it paints what it has and fills in the rest; this
       now does the same, in three phases:

         1. Session + the conversation row. Genuinely serial: the row's
            `user_a`/`user_b` decide who the other person is, and nothing else can
            be issued without that. But the *messages* query only needs the id
            from the route, so it is fired here too and raced alongside.
         2. Everything the first paint depends on, concurrently — the messages,
            and the two flags that decide whether this thread is paywalled. A
            `Promise.all` rather than four awaits: they don't depend on each
            other, so the cost is one round trip, not four.
         3. Everything that decorates bubbles already on screen — pins,
            reactions, delivery receipts. These used to gate the paint; they now
            land after it, which is invisible because a bubble renders correctly
            without them.

       The two writes (marking the conversation read, ensuring a coin wallet) are
       no longer awaited at all. Nothing downstream reads their result, so an
       `await` on them was pure dead latency in front of the user.
       --------------------------------------------------------------------- */
    async function init() {
      const sessionPromise = getCachedSession();
      /* Issued before the session resolves on purpose: this is the query the
         user is actually waiting for, and `conversationId` comes from the route,
         so it needs nothing from auth. RLS still decides what comes back.

         CAPPED at the newest `MESSAGES_PAGE_SIZE` messages. The uncapped
         `select("*")` of the whole conversation was the single most expensive
         read in the app: a year-old thread of tens of thousands of messages
         shipped every row, every waveform JSON and every column to every open,
         and the list rendered them all. Older history now pages in as the
         reader reaches the top (`loadOlderMessages`). Newest-first + limit +
         reverse so the window is the *tail* of the thread. */
      const messagesPromise = supabase
        .from("direct_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PAGE_SIZE);

      const session = await sessionPromise;
      if (!session) { router.push("/login"); return; }
      if (cancelled) return;

      setMyId(session.user.id);
      myIdRef.current = session.user.id;

      const { data: convo } = await supabase.from("conversations").select("user_a, user_b").eq("id", conversationId).single();
      if (!convo) { router.push("/active"); return; }
      if (cancelled) return;

      const readColumn = convo.user_a === session.user.id ? "user_a_last_read_at" : "user_b_last_read_at";
      /* Fire-and-forget: this is a write whose result nothing here reads, and the
         inbox has already zeroed its own badge optimistically. */
      void supabase.from("conversations").update({ [readColumn]: new Date().toISOString() }).eq("id", conversationId);

      const otherUserId = convo.user_a === session.user.id ? convo.user_b : convo.user_a;
      setOtherUserId(otherUserId);
      /* The stored handle when it's already been fetched (a thread opened from
         the Inbox), or the stored handle fetched now. The fallback renders
         instantly; `resolveAnonName` swaps it the moment the row lands, so the
         header never shows a name the database doesn't own. */
      setOtherLabel(anonNameOf(otherUserId));
      void resolveAnonName(otherUserId).then((name) => {
        if (!cancelled) setOtherLabel(name);
      });

      unsubscribePresence = presenceManager.subscribe((users) => {
        setOtherUserOnline(users.some((user) => user.id === otherUserId));
      });
      void presenceManager.connect(session.user.id);
      unsubscribeTyping = typingManager.subscribe(conversationId, session.user.id, (typing) => {
        setOtherTyping(typing);
      });

      /* Also fire-and-forget. It's an idempotent upsert that the balance display
         reads later, not something the messages depend on. */
      void supabase.rpc("ensure_coin_wallet", { target_user: session.user.id });

      /* Phase 2: the paint set, in one round trip instead of three. The two flags
         stay blocking because they decide whether the thread is paywalled — a
         paint before them would flash the messages of a locked chat. */
      const [msgsResult, otherFriendship, unlockResult, pendingRequestResult] = await Promise.all([
        messagesPromise,
        supabase.from("friends").select("id").eq("user_id", session.user.id).eq("friend_id", otherUserId).maybeSingle(),
        supabase.from("chat_unlocks").select("id").eq("user_id", session.user.id).eq("conversation_id", conversationId).maybeSingle(),
        /* The pending request, in either direction. One query rather than two:
           the or() covers both row shapes, and maybeSingle is safe because
           friend_requests_pending_unique guarantees at most one pending row
           per pair. */
        supabase
          .from("friend_requests")
          .select("id,sender_id,receiver_id")
          .or(`and(sender_id.eq.${otherUserId},receiver_id.eq.${session.user.id}),and(sender_id.eq.${session.user.id},receiver_id.eq.${otherUserId})`)
          .eq("status", "pending")
          .maybeSingle(),
      ]);
      if (cancelled) return;

      /* Gate failure is not gate denial. The messages query is fired first with
         a head start, so on a dying connection it can land while these three
         fail — locking the composer over a network error, with the paywall
         panel scrolled out of sight, reads as "the typing box is blocked by
         something invisible". Record the failure so the composer offers a
         retry instead of a verdict. */
      const gateFailure = otherFriendship.error || unlockResult.error || pendingRequestResult.error;
      setGateError(gateFailure ? gateFailure.message || "Couldn't verify this chat." : null);
      setIsFriendConversation(Boolean(otherFriendship.data));
      setChatUnlocked(Boolean(unlockResult.data));
      if (pendingRequestResult.data) {
        setPendingRequest({
          id: pendingRequestResult.data.id as string,
          direction: (pendingRequestResult.data.sender_id as string) === otherUserId ? "incoming" : "outgoing",
        });
      }

      /* Newest-first + limit was the fetch shape; the thread renders old→new,
         so reverse into place and remember whether anything is left above. */
      const rawFetched = msgsResult.data || [];
      setHasOlderMessages(rawFetched.length === MESSAGES_PAGE_SIZE);
      const fetchedMsgs = rawFetched.slice().reverse();
      setMessages(fetchedMsgs);
      messagesRef.current = fetchedMsgs;
      setLoading(false);

      /* Phase 3: everything that decorates what is now already on screen. Not
         awaited by anything the user is looking at. */
      void (async () => {
        await supabase.rpc("sweep_expired_pins", { target_conversation_id: conversationId });
        const { data: pins } = await supabase.from("pinned_messages").select("message_id").eq("conversation_id", conversationId);
        if (!cancelled) setPinnedMessageIds(new Set((pins || []).map((p) => p.message_id)));
      })();

      /* Chunked `.in()` list: PostgREST GETs carry the filter in the query
         string, and a page of 400 uuids is ~15KB of URL — past what gateways
         accept. 100 ids ≈ 3.7KB, comfortably inside, and a 400-message page is
         at most four parallel requests, all off the paint path. */
      if (fetchedMsgs.length > 0) {
        const ids = fetchedMsgs.map((m) => m.id);
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
        void Promise.all(
          chunks.map((chunk) =>
            supabase
              .from("message_reactions")
              .select("message_id, user_id, emoji")
              .in("message_id", chunk)
          )
        ).then((results) => {
          if (!cancelled) setReactions(results.flatMap((r) => r.data || []));
        });
      }

      const now = new Date().toISOString();
      const undeliveredIds = fetchedMsgs
        .filter((m) => m.sender_id !== session.user.id && !m.delivered_at)
        .slice(0, 100)
        .map((m) => m.id);
      if (undeliveredIds.length > 0) {
        const { error: deliverError } = await supabase.from("direct_messages").update({ delivered_at: now }).in("id", undeliveredIds);
        if (!deliverError) {
          setMessages((prev) => prev.map((m) => undeliveredIds.includes(m.id) ? { ...m, delivered_at: now } : m));
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

              /* Reconciliation. This event may be the confirmation of a message
                 the composer already put on screen optimistically — and it can
                 easily arrive BEFORE the insert's own response, because the
                 socket and the HTTP round trip race each other and the socket
                 frequently wins.

                 Matching is by (sender, content) rather than by id, because the
                 optimistic row's id is a local temporary one and the real row
                 has no idea it exists. Swapping in place rather than appending
                 keeps the position the user saw it appear at, so a fast send
                 does not visibly jump to the bottom of the thread.

                 Only the FIRST match is consumed, so sending the same word twice
                 in a row reconciles one-for-one instead of both optimistic rows
                 collapsing onto one real one. */
              const pendingIndex = prev.findIndex(
                (m) =>
                  m.send_state === "sending" &&
                  m.sender_id === incoming.sender_id &&
                  (m.content ?? "") === (incoming.content ?? "")
              );
              if (pendingIndex >= 0) {
                const next = [...prev];
                next[pendingIndex] = incoming;
                return next;
              }

              return [...prev, incoming];
            });
            if (incoming.sender_id !== session.user.id) {
              const msgNow = new Date().toISOString();
              const readAt = document.visibilityState === "visible" ? msgNow : null;
              supabase.from("direct_messages").update({ delivered_at: msgNow, read_at: readAt }).eq("id", incoming.id)
                .then(({ error }) => {
                  if (!error) {
                    setMessages((prev) => prev.map((m) => m.id === incoming.id ? { ...m, delivered_at: msgNow, read_at: readAt } : m));
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
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "pinned_messages", filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            const pinned = payload.new as { message_id: string };
            setPinnedMessageIds((prev) => new Set([...prev, pinned.message_id]));
          }
        )
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "pinned_messages" },
          (payload) => {
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
              setReactions((prev) => prev.some((r) => r.message_id === incoming.message_id && r.user_id === incoming.user_id) ? prev : [...prev, incoming]);
            }
            if (payload.eventType === "UPDATE") {
              setReactions((prev) => prev.map((r) => r.message_id === (payload.new as Reaction).message_id && r.user_id === (payload.new as Reaction).user_id ? (payload.new as Reaction) : r));
            }
            if (payload.eventType === "DELETE") {
              setReactions((prev) => prev.filter((r) => !(r.message_id === (payload.old as Partial<Reaction>).message_id && r.user_id === (payload.old as Partial<Reaction>).user_id)));
            }
          }
        )
        .subscribe();

      /* Relationship events for the messaging gates. Four subscriptions on
         one channel because a realtime filter is a single equality clause
         and the pending request / friendship can live in any of the four
         (sender, receiver, user_id, friend_id) positions. Events for OTHER
         pairs of mine also fire these — the coalesced re-check reads only
         THIS conversation's rows, so a stray event costs one cheap triple
         read at most. */
      relationshipChannel = supabase
        .channel(`chat-relationship-${conversationId}-${Date.now()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "friend_requests", filter: `sender_id=eq.${session.user.id}` }, () => scheduleRelationshipCheck())
        .on("postgres_changes", { event: "*", schema: "public", table: "friend_requests", filter: `receiver_id=eq.${session.user.id}` }, () => scheduleRelationshipCheck())
        .on("postgres_changes", { event: "*", schema: "public", table: "friends", filter: `user_id=eq.${session.user.id}` }, () => scheduleRelationshipCheck())
        .on("postgres_changes", { event: "*", schema: "public", table: "friends", filter: `friend_id=eq.${session.user.id}` }, () => scheduleRelationshipCheck())
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
      cancelled = true;
      cleanupVisibility?.();
      unsubscribePresence?.();
      unsubscribeTyping?.();
      void typingManager.setTyping(conversationId, myIdRef.current, false);
      if (relationshipCheckTimer.current) clearTimeout(relationshipCheckTimer.current);
      if (msgChannel) supabase.removeChannel(msgChannel);
      if (reactionChannel) supabase.removeChannel(reactionChannel);
      if (relationshipChannel) supabase.removeChannel(relationshipChannel);
    };
  }, [conversationId, router, markMessagesRead, scheduleRelationshipCheck]);

  /* Pins the list to its newest message, without animating and without touching
     any scroller but this one. `bottomRef.scrollIntoView` used to do this, and it
     was the reason opening a thread felt unreliable: it walks *every* scrollable
     ancestor including the document, which has `scroll-behavior: smooth`, so an
     "auto" jump still played as a visible slide; and asking a zero-height
     sentinel inside a `min-h-full` flex child to align itself lands short often
     enough to notice. One assignment to the one element that scrolls is exact. */
  const pinToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight - container.clientHeight;
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const container = messagesContainerRef.current;
      if (container) {
        if (behavior === "smooth") {
          container.scrollTo({ top: container.scrollHeight - container.clientHeight, behavior: "smooth" });
        } else {
          container.scrollTop = container.scrollHeight - container.clientHeight;
        }
      }
      atBottomRef.current = true;
      setAtBottom(true);
      setUnseenCount(0);
    },
    []
  );

  /* Locks the document and republishes the frame height whenever the keyboard or
     the browser chrome changes it. The callback is the other half of the fix: the
     keyboard opening takes height away from the list, so without re-pinning, the
     message you are replying to slides up out of view exactly as you start
     typing — which is the "it goes under my keyboard" symptom from the list's
     side rather than the composer's. */
  useViewportFrame(() => {
    if (atBottomRef.current) pinToBottom();
  });

  useEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
    /* A composer growing to a second line takes that line out of the list. Re-pin
       so the newest message stays put instead of drifting up per keystroke. */
    if (atBottomRef.current) pinToBottom();
  }, [input, pinToBottom]);

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
      /* Reaching the top pages older history in; loadOlderMessages guards
         itself against re-entry and stops asking once a page comes back short. */
      if (container.scrollTop < 80 && hasOlderMessages) void loadOlderMessages();
    }
    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [loading, hasOlderMessages, loadOlderMessages]);

  const lastMessageId = messages.length ? messages[messages.length - 1].id : null;
  const previousLastId = useRef<string | null>(null);
  const openedRef = useRef(false);

  /* Landing the thread. Opening a chat used to be a 50ms guess, and 50ms is
     before the layout is finished: the doodle background, the avatars and every
     image bubble resolve a frame or two later and each one makes the list taller,
     so the jump was measured against a list shorter than the one the user ended
     up looking at and parked well above the newest message.

     Instead of guessing, watch the content box and re-land every time it grows,
     until it stops growing. And land on the first message that hasn't been read
     rather than always at the very bottom, so a thread with a backlog opens at
     the start of what's new — with a little headroom above it, so the last
     already-read message is visible and the jump makes sense. */
  useEffect(() => {
    if (loading || openedRef.current) return;
    const container = messagesContainerRef.current;
    const content = messagesContentRef.current;
    if (!container || !content) return;
    openedRef.current = true;

    const firstUnread = messagesRef.current.find(
      (message) => message.sender_id !== myIdRef.current && !message.read_at
    );
    const unreadCount = firstUnread
      ? messagesRef.current.filter(
          (message) => message.sender_id !== myIdRef.current && !message.read_at
        ).length
      : 0;

    /* An arrow function, not a `function` declaration, and that is load-bearing:
       TypeScript discards the `container`/`content` narrowing above inside a
       hoisted declaration — it can't prove the body doesn't run before the guard
       — but keeps it for a closure created after the guard. */
    const land = () => {
      const anchor = firstUnread ? messageNodes.current.get(firstUnread.id) : null;
      if (anchor) {
        /* Rect deltas rather than `offsetTop`, because a bubble's offset parent is
           whichever wrapper happens to be positioned, not reliably the scroller's
           content box. */
        const offset = anchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
        container.scrollTop = Math.max(0, container.scrollTop + offset - 72);
      } else {
        container.scrollTop = container.scrollHeight - container.clientHeight;
      }
    };

    land();
    /* Landing above the newest message leaves the jump-to-latest button on
       screen; give it the real number of messages waiting below so it says
       something true rather than appearing bare. The scroll handler clears it as
       soon as the user reaches the bottom. */
    if (unreadCount > 0) setUnseenCount(unreadCount);

    let lastHeight = content.scrollHeight;
    const observer = new ResizeObserver(() => {
      if (content.scrollHeight === lastHeight) return;
      lastHeight = content.scrollHeight;
      land();
    });
    observer.observe(content);

    /* The moment the user touches the list, it is theirs. Without this, an image
       finishing its load a second in would yank them back to the landing spot. */
    function release() {
      observer.disconnect();
    }
    container.addEventListener("pointerdown", release, { passive: true, once: true });
    container.addEventListener("wheel", release, { passive: true, once: true });

    /* Long enough for images and fonts to settle, short enough that the observer
       is gone before the user could plausibly have scrolled somewhere on purpose
       and be dragged back. */
    const stop = setTimeout(release, 1200);
    return () => {
      clearTimeout(stop);
      container.removeEventListener("pointerdown", release);
      container.removeEventListener("wheel", release);
      observer.disconnect();
    };
  }, [loading]);

  useEffect(() => {
    if (loading || !lastMessageId) return;
    const firstPaint = previousLastId.current === null;
    const isNew = !firstPaint && previousLastId.current !== lastMessageId;
    previousLastId.current = lastMessageId;
    /* First paint belongs to the effect above — it has the unread anchor and it
       keeps re-landing while the layout settles. */
    if (firstPaint || !isNew) return;
    const incoming = messages[messages.length - 1];
    /* Your own message always brings you back down, the way it does in WhatsApp.
       Someone else's only does if you were already at the bottom; otherwise it
       counts towards the badge on the jump-to-latest button. */
    if (atBottomRef.current || incoming.sender_id === myId) scrollToBottom("smooth");
    else setUnseenCount((count) => count + 1);
  }, [lastMessageId, loading, messages, myId, scrollToBottom]);

  const registerMessageRef = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) messageNodes.current.set(id, node);
    else messageNodes.current.delete(id);
  }, []);

  const searchHits = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [] as string[];
    return messages.filter((message) => (message.content || "").toLowerCase().includes(query)).map((message) => message.id).reverse();
  }, [messages, searchQuery]);

  const searchHitSet = useMemo(() => new Set(searchHits), [searchHits]);

  useEffect(() => {
    const target = searchHits[activeHit];
    if (!target) return;
    messageNodes.current.get(target)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeHit, searchHits]);

  useEffect(() => {
    if (!highlightedId) return;
    const timer = setTimeout(() => setHighlightedId(null), 1400);
    return () => clearTimeout(timer);
  }, [highlightedId]);

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

  const insertEmoji = useCallback((emoji: string) => {
    setInput((current) => current + emoji);
    pushRecentEmoji(emoji);
    /* Desktop keeps the caret live so typing continues seamlessly. On touch,
       focusing would summon the OS keyboard and shove the picker away — the
       WhatsApp behaviour is picker-stays-open, so no focus there. */
    if (window.matchMedia("(pointer: fine)").matches) textareaRef.current?.focus();
  }, []);

  /* Same button while the picker is open on that tab → close. Anything else →
     open on (or switch to) that tab. An event callback so it can read both
     states without being re-created per render. */
  const togglePicker = useEventCallback((tab: MediaTab) => {
    if (loading) return;
    if (gateError) {
      showToast("Couldn't verify this chat — tap Try again below.");
      return;
    }
    if (acceptLocked) {
      showToast("Accept the friend request to reply.");
      return;
    }
    if (!chatUnlocked) {
      showToast(isFriendConversation
        ? "You need 40 coins to unlock this conversation."
        : `Unlock this chat once for ${UNLOCK_CHAT_COST} Whisper Coins first.`);
      return;
    }
    setShowAttachSheet(false);
    if (pickerOpen && pickerTab === tab) {
      setPickerOpen(false);
      return;
    }
    setPickerTab(tab);
    setPickerOpen(true);
    /* Opening the picker while the keyboard is up: blur so the keyboard
       leaves and the picker takes its space instead of stacking above it. */
    if (!isDesktop) textareaRef.current?.blur();
  });

  const closePicker = useCallback(() => setPickerOpen(false), []);

  /* Opening or closing the picker resizes the thread the same way the
     keyboard does; keep the newest message pinned through it. The picker's
     spring runs ~300ms, so re-pin a few times across it. */
  useEffect(() => {
    if (!atBottomRef.current) return;
    const timers = [0, 90, 200, 340].map((ms) => setTimeout(pinToBottom, ms));
    return () => timers.forEach(clearTimeout);
  }, [pickerOpen, pinToBottom]);

  /**
   * Sends a sticker or GIF as an ordinary direct message with `media_url` +
   * `media_kind` set. GIFs are re-hosted into Cloudinary first, so the stored
   * URL is ours (small rendition + `q_auto:low` delivery keeps them tens of
   * KB); if the re-host fails the provider URL is sent as a fallback — the
   * DB constraint allows exactly those hosts. Bundled stickers send their
   * same-origin path; created stickers are already Cloudinary URLs.
   */
  const sendMediaMessage = useEventCallback(
    async (kind: "gif" | "sticker", url: string, width: number | null, height: number | null) => {
      if (!myId) return;
      if (acceptLocked) {
        showToast("Accept the friend request to reply.");
        return;
      }
      if (!chatUnlocked) {
        showToast(isFriendConversation
          ? "You need 40 coins to unlock this conversation."
          : `Unlock this chat once for ${UNLOCK_CHAT_COST} Whisper Coins first.`);
        return;
      }
      if (!requireOnline(showToast, "Sending")) return;
      if (mediaSending) return;

      setMediaSending(url);
      try {
        let finalUrl = url;
        if (kind === "gif") {
          try {
            const hosted = await uploadRemoteToCloudinary(
              url,
              `${CLOUDINARY_FOLDERS.chatGifs}/${myId}`
            );
            finalUrl = hosted.url;
            if (hosted.width && hosted.height) {
              width = hosted.width;
              height = hosted.height;
            }
          } catch {
            /* Provider URL is on the DB allowlist; a failed re-host should
               not eat the send. */
          }
        }

        const replyId = replyingTo?.id || null;
        const { error } = await supabase.from("direct_messages").insert({
          conversation_id: conversationId,
          sender_id: myId,
          content: null,
          reply_to_id: replyId,
          media_url: finalUrl,
          media_kind: kind,
          media_width: width,
          media_height: height,
        });
        if (error) {
          showToast(safeErrorMessage(error, "Couldn't send that message."));
          return;
        }

        if (kind === "sticker") pushRecentSticker(url);
        setReplyingTo(null);

        /* Guarded: a no-op whenever the 202609100004 trigger has stamped the
           row with fresh server time; the ordering keeper on unmigrated DBs. */
        stampConversationFallback(myId);
      } finally {
        setMediaSending(null);
      }
    }
  );

  const handlePickSticker = useEventCallback((sticker: StickerDef) => {
    void sendMediaMessage("sticker", sticker.url, BUNDLED_STICKER_SIZE, BUNDLED_STICKER_SIZE);
  });

  useEffect(() => {
    return () => { if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.previewUrl); };
  }, [pendingPhoto]);

  /* --------------------------------------------------------------------------
     Sending, optimistically.
     ------------------------------------------------------------------------ */

  /**
   * Puts the message on screen, clears the composer, and lets the network catch
   * up — in that order, and without awaiting any of it.
   *
   * WHAT THIS DOES NOT DO
   *
   * It does not claim the message was delivered. `send_state: "sending"` is a
   * clock, not a tick, and it only becomes a tick when the database has the row.
   * If the insert fails the row is marked `failed` and stays there with a Retry,
   * so a rejected send is never presented as a successful one.
   *
   * The temporary id is prefixed and locally generated. It can never collide with
   * a real uuid, which is what makes "is this row still optimistic" a safe test
   * everywhere else in this file, and it is what the reconciliation in the
   * realtime handler swaps out.
   */
  function optimisticMessage(
    content: string | null,
    replyId: string | null,
    media: Pick<Message, "media_url" | "media_kind" | "media_width" | "media_height"> | null
  ): Message {
    return {
      id: tempId(),
      sender_id: myIdRef.current,
      content,
      created_at: new Date().toISOString(),
      reply_to_id: replyId,
      image_path: null,
      audio_path: null,
      audio_duration_ms: null,
      audio_waveform: null,
      audio_mime: null,
      is_view_once: false,
      image_viewed_at: null,
      audio_viewed_at: null,
      delivered_at: null,
      read_at: null,
      media_url: media?.media_url ?? null,
      media_kind: media?.media_kind ?? null,
      media_width: media?.media_width ?? null,
      media_height: media?.media_height ?? null,
      send_state: "sending",
    };
  }

  /**
   * Runs the insert for one optimistic row and reconciles it.
   *
   * Fire-and-forget by design: the caller has already returned control to the
   * user, and holding the composer open until this settles is exactly the
   * behaviour being removed. The composer stays usable while this is in flight,
   * so several of these can be running at once.
   */
  /**
   * Fallback write for the conversation's activity stamp.
   *
   * The authoritative stamp is the database's: the direct_messages_touch
   * trigger (202609100004) sets last_message_at / last_message_sender_id from
   * the inserted row's server-side created_at, atomically with the insert.
   * This write exists for an UNMIGRATED database, where nothing else keeps
   * the column current — deploy order must not freeze the inbox.
   *
   * The guard is what makes it safe to keep: it only fires when the row has
   * no stamp or the stamp is more than five minutes older than "now". When the
   * trigger is present its stamp is seconds old, so this is a no-op and a
   * skewed device clock (the old failure mode — a fast phone stamping "now"
   * into the future, a slow one stamping the past) can no longer overwrite
   * the server's value.
   */
  const stampConversationFallback = useCallback(
    (senderId: string) => {
      /* Millis stripped: PostgREST's or() syntax is dot-delimited, and an ISO
         timestamp's ".000Z" would otherwise be parsed as filter structure. */
      const cutoff = new Date(Date.now() - 5 * 60_000).toISOString().replace(".000Z", "Z");
      void supabase
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
          last_message_sender_id: senderId,
        })
        .eq("id", conversationId)
        .or(`last_message_at.is.null,last_message_at.lt.${cutoff}`);
    },
    [conversationId]
  );

  const deliverMessage = useCallback(async (pending: Message) => {
    const { data, error } = await supabase
      .from("direct_messages")
      .insert({
        conversation_id: conversationId,
        sender_id: pending.sender_id,
        content: pending.content,
        reply_to_id: pending.reply_to_id,
        media_url: pending.media_url,
        media_kind: pending.media_kind,
        media_width: pending.media_width,
        media_height: pending.media_height,
      })
      .select("*")
      .single();

    if (error) {
      /* Marked, not removed. Silently dropping a message the user watched appear
         is worse than showing one that failed: they would have no idea it never
         went, and nothing to retry. */
      setMessages((prev) =>
        prev.map((m) => (m.id === pending.id ? { ...m, send_state: "failed" as const } : m))
      );
      return;
    }

    const real = data as Message;

    setMessages((prev) => {
      /* The realtime handler may already have swapped this row in (see the
         reconciliation note there), in which case the temporary id is gone and
         the real one is present. Both branches converge on the same list. */
      const withoutPending = prev.filter((m) => m.id !== pending.id);
      if (withoutPending.some((m) => m.id === real.id)) return withoutPending;
      return [...withoutPending, real];
    });

    /* Only now. Celebrating a send that failed is worse than not celebrating. */
    const launchPoint = pendingFlightRef.current.get(pending.id);
    if (launchPoint) {
      pendingFlightRef.current.delete(pending.id);
      setFlightOrigin(launchPoint);
      setFlightId((n) => n + 1);
    }

    /* Guarded: a no-op whenever the 202609100004 trigger has stamped the row
       with fresh server time (the old unguarded write is what let a skewed
       device clock reorder the inbox); on an unmigrated database it keeps the
       list ordered the way it always was. */
    stampConversationFallback(pending.sender_id);
  }, [conversationId, stampConversationFallback]);

  /** Re-sends a row whose insert failed. The row itself is reused, so the retry
      replaces it in place rather than appending a second copy. */
  const retryMessage = useEventCallback((msg: Message) => {
    if (msg.send_state !== "failed") return;
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, send_state: "sending" as const } : m))
    );
    void deliverMessage(msg);
  });

  async function sendMessage() {
    setShowAttachSheet(false);
    if (pendingPhoto) { await sendPendingPhoto(); return; }
    const hasMessage = input.trim().length > 0;
    /* Accept-lock first: the database would reject the row anyway (rule (b)),
       so the UI says the true reason instead of pointing at a paywall that
       acceptance — not coins — would actually satisfy. */
    if (acceptLocked) {
      showToast("Accept the friend request to reply.");
      return;
    }
    if (!chatUnlocked) {
      showToast(isFriendConversation
        ? "You need 40 coins to unlock this conversation."
        : `Unlock this chat once for ${UNLOCK_CHAT_COST} Whisper Coins to send messages.`);
      return;
    }
    if (!hasMessage || !myId) return;

    const content = input.trim();

    /* Measured here, before the input clears. Emptying it swaps the send button
       out for the voice recorder in the same React batch, and a rect read from a
       detached node is all zeros — the plane would launch from the top-left of
       the screen. See PaperPlaneFlight's note on `origin`.

       The flight now waits for the insert rather than firing on the tap, so the
       origin is stashed against the temporary id and read back in
       deliverMessage. */
    const sendBox = sendButtonRef.current?.getBoundingClientRect();
    const launchPoint = sendBox
      ? { x: sendBox.left + sendBox.width / 2, y: sendBox.top + sendBox.height / 2 }
      : null;

    /* The composer empties here, before anything is awaited. This single line is
       most of what "instant" means: everything after it is background work. */
    setInput("");
    const replyId = replyingTo?.id || null;
    setReplyingTo(null);

    const pending = optimisticMessage(content, replyId, null);
    if (launchPoint) pendingFlightRef.current.set(pending.id, launchPoint);
    setMessages((prev) => [...prev, pending]);

    void deliverMessage(pending);
  }

  async function deleteMessage(msg: Message) {
    setDeleteConfirm(null);

    /* Server-side delete: the route purges any unopened view-once photo
       (Cloudinary) and any unplayed voice note (storage) AND removes the row in
       one authorized call. A client-only row delete used to leave the media
       orphaned in Cloudinary / the voice bucket forever. */
    const { data: { session } } = await supabase.auth.getSession();
    const optimistic = () => setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    optimistic();

    if (!session) {
      showToast("Couldn't delete message.");
      return;
    }

    try {
      const res = await fetch("/api/chat/delete-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ messageId: msg.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "Couldn't delete message.");
        /* The realtime delete event would have removed the row too; on failure
           best effort is leaving local state as the server still has it, but
           the row is already gone locally for responsiveness. */
      }
    } catch {
      showToast("Couldn't delete message.");
    }
  }

  const togglePin = useEventCallback(async (msg: Message) => {
    if (!pinnedMessageIds.has(msg.id)) {
      setPinDurationFor(msg);
      return;
    }
    const { error } = await supabase.from("pinned_messages").delete().eq("conversation_id", conversationId).eq("message_id", msg.id);
    if (error) { showToast(safeErrorMessage(error, "Couldn't unpin that message.")); return; }
    setPinnedMessageIds((prev) => { const s = new Set(prev); s.delete(msg.id); return s; });
    showToast("Unpinned", { variant: "subtle" });
  });

  const confirmPin = useEventCallback(async (msg: Message, durationHours: number | null) => {
    setPinDurationFor(null);
    if (!myId) return;
    const expiresAt = durationHours === null ? null : new Date(Date.now() + durationHours * 3600_000).toISOString();
    const { error } = await supabase.from("pinned_messages").insert({
      conversation_id: conversationId,
      message_id: msg.id,
      pinned_by: myId,
      expires_at: expiresAt,
    });
    if (error) { showToast(safeErrorMessage(error, "Couldn't pin that message.")); return; }
    setPinnedMessageIds((prev) => new Set([...prev, msg.id]));
    showToast(durationHours === null ? "Pinned" : `Pinned for ${PIN_DURATIONS.find((d) => d.hours === durationHours)?.label ?? "a while"}`, { variant: "subtle" });
  });

  function triggerPhotoPicker() {
    if (acceptLocked) { showToast("Accept the friend request to reply."); return; }
    if (!chatUnlocked) {
      showToast(isFriendConversation ? "You need 40 coins to unlock this conversation." : `Unlock this chat once for ${UNLOCK_CHAT_COST} Whisper Coins first.`);
      return;
    }
    fileInputRef.current?.click();
  }

  function triggerCameraPicker() {
    if (acceptLocked) { showToast("Accept the friend request to reply."); return; }
    if (!chatUnlocked) {
      showToast(isFriendConversation ? "You need 40 coins to unlock this conversation." : `Unlock this chat once for ${UNLOCK_CHAT_COST} Whisper Coins first.`);
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
      showToast(isFriendConversation ? "You need 40 coins to unlock this conversation." : `Unlock this chat once for ${UNLOCK_CHAT_COST} Whisper Coins first.`);
      return;
    }

    /* Measured before the upload starts, for the same reason as the text path:
       `setUploadingPhoto(true)` turns the send button into a spinner, and a rect
       from a detached node is all zeros. See PaperPlaneFlight's note on `origin`. */
    const sendBox = sendButtonRef.current?.getBoundingClientRect();
    const launchPoint = sendBox
      ? { x: sendBox.left + sendBox.width / 2, y: sendBox.top + sendBox.height / 2 }
      : null;

    setUploadingPhoto(true);
    try {
      const { data: wallet, error: walletError } = await supabase.from("coins").select("balance").eq("user_id", myId).maybeSingle();
      if (walletError) { showToast(walletError.message); return; }
      if ((wallet?.balance ?? 0) < SEND_IMAGE_COST) { showToast(`You need ${SEND_IMAGE_COST} coins to send an image.`); return; }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast("Please sign in again to send a photo."); return; }

      /* `whisper/view-once/<sender-id>/…`. The folder is the sender's id rather
         than the conversation id so that the rollback below — and only the
         sender — can delete it; /api/cloudinary/destroy reads ownership out of
         that segment. The conversation is already on the message row, so nothing
         needed it in the path. */
      let imageUrl: string;
      try {
        const uploaded = await uploadToCloudinary(
          pendingPhoto.file,
          `${CLOUDINARY_FOLDERS.viewOnce}/${myId}`
        );
        imageUrl = uploaded.url;
      } catch (error) {
        showToast(error instanceof CloudinaryUploadError ? error.message : "Couldn't upload that photo.");
        return;
      }

      const { error: spendError } = await supabase.rpc("spend_coins_for_image", { target_conversation_id: conversationId });
      if (spendError) {
        await discardCloudinaryUpload(imageUrl, session.access_token);
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
        /* A full Cloudinary URL now, not a storage key. It is never selected into
           the browser — /api/photos/view is the only reader, and it nulls this
           column and destroys the asset on the single view. */
        image_path: imageUrl,
        is_view_once: true,
      });
      if (insertError) { showToast(insertError.message); return; }

      /* A photo is the same event as a message, so it gets the same send-off.
         After the insert, never before it. */
      if (launchPoint) {
        setFlightOrigin(launchPoint);
        setFlightId((n) => n + 1);
      }

      /* Guarded fallback, same as the text and media paths above. */
      stampConversationFallback(myId);

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

  const handleVoiceNote = useEventCallback(async (recording: VoiceRecording) => {
    if (!myId) return;
    setUploadingPhoto(true);
    const path = `${conversationId}/${crypto.randomUUID()}.${recording.extension}`;
    try {
      const { error: uploadError } = await supabase.storage.from("voice-messages").upload(path, recording.blob, { contentType: recording.mimeType, upsert: false });
      if (uploadError) { showToast(describeVoiceNoteFailure(uploadError.message)); return; }

      const { error: sendError } = await supabase.rpc("send_voice_note", {
        target_conversation_id: conversationId,
        storage_path: path,
        duration_ms: Math.round(recording.durationMs),
        waveform: recording.waveform,
        mime_type: recording.mimeType,
        caption: input.trim() || null,
        reply_to: replyingTo?.id ?? null,
        view_once: true,
      });

      if (sendError) {
        await supabase.storage.from("voice-messages").remove([path]);
        showToast(describeVoiceNoteFailure(sendError.message));
        return;
      }

      setInput("");
      setReplyingTo(null);
      showToast("Voice note sent", { variant: "subtle" });
    } finally {
      setUploadingPhoto(false);
    }
  });

  const handlePlayAudio = useEventCallback(async (msg: Message): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !msg.audio_path) return null;
    try {
      const res = await fetch("/api/audio/view", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ messageId: msg.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "Couldn't play voice note.");
        return null;
      }
      const url = URL.createObjectURL(await res.blob());
      setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, audio_viewed_at: new Date().toISOString(), audio_path: null } : m));
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
      await supabase.from("message_reactions").upsert({ message_id: messageId, user_id: myId, emoji }, { onConflict: "message_id,user_id" });
    }
  }, [myId]);

  async function unlockChat() {
    setUnlocking(true);
    const { error } = await supabase.rpc("unlock_chat_with_coins", { target_conversation_id: conversationId });
    if (error) showToast(safeErrorMessage(error));
    else { setChatUnlocked(true); showToast("Chat unlocked permanently."); }
    setUnlocking(false);
  }

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

  const NO_REACTIONS = useMemo(() => ({}) as Record<string, number>, []);

  const copyMessage = useEventCallback(async (msg: Message) => {
    const text = msg.content?.trim();
    if (!text) { showToast("Nothing to copy."); return; }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const scratch = document.createElement("textarea");
        scratch.value = text;
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        document.body.appendChild(scratch);
        scratch.select();
        document.execCommand("copy");
        document.body.removeChild(scratch);
      }
      navigator.vibrate?.(15);
      showToast("Copied", { variant: "subtle" });
    } catch {
      showToast("Couldn't copy that message.", { variant: "error" });
    }
    setActionMenuFor(null);
  });

  const startPress = useCallback((messageId: string) => {
    pressTimer.current = setTimeout(() => {
      navigator.vibrate?.(18);
      setActionMenuFor(messageId);
    }, 450);
  }, []);

  const cancelPress = useCallback(() => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }, []);

  const pinnedMessages = useMemo(() => messages.filter((m) => pinnedMessageIds.has(m.id)), [messages, pinnedMessageIds]);
  const pinIndex = pinnedMessages.length ? pinCursor % pinnedMessages.length : 0;
  const activePin = pinnedMessages[pinIndex] ?? null;

  function jumpToNextPin() {
    if (!activePin) return;
    const node = messageNodes.current.get(activePin.id);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(activePin.id);
    if (pinnedMessages.length > 1) setPinCursor((c) => c + 1);
  }

  /* Deliberately NOT `if (loading) return <Loading />`.
     A full-screen gate took the header, the composer and the back button away for
     the length of the first fetch, so opening a thread read as a page load rather
     than a panel opening — and a mis-tap during it left nothing to press. The
     frame below paints immediately instead; only the message region is
     provisional, and three things have to be told about it so they don't state
     something untrue in the meantime:

       - the paywall panel, which would otherwise flash "Chat locked" on every
         open, because `chatUnlocked` starts false and only the fetch can say
         otherwise;
       - the empty state, which would flash "Say hi 👻" over a thread that has
         hundreds of messages in it;
       - the composer's placeholder, for the same reason as the paywall panel.

     The status line is the fourth: `otherUserOnline` also starts false, so it
     would assert "offline" about somebody who is online. */
  return (
    /* A frame, not `h-screen`. `100vh` is the large viewport and never shrinks for
       a keyboard, so the composer used to sit behind it; and a full-viewport child
       of a `body` that carries the safe-area insets makes the document itself
       scrollable by the inset total, which is what stopped this page feeling
       static. `.viewport-frame` is sized from the visual viewport instead, and
       `lib/useViewportFrame` locks the document while it is mounted. Safe because
       `TemplateTransition` animates opacity only — nothing above this becomes a
       containing block. */
    <main className="chat-canvas viewport-frame relative flex flex-col">
      {/* `chat-context-active` is what pushes the whole screen out of focus while a
          message is held — the header, the pinned bar, the composer, the wallpaper
          and every bubble except the held one. See the block in globals.css for why
          it is one class here rather than a prop on each bubble. */}
      <div className={`relative z-10 flex h-full flex-col ${actionMenuFor ? "chat-context-active" : ""}`}>
        {/* The dismiss layer, covering the whole frame rather than just the thread.
            iOS makes the entire screen inert behind a message menu and lets a tap
            anywhere put it back; scoping this to the scroller would have left the
            receded header visibly greyed out but doing nothing at all when tapped,
            which reads as a frozen app. z-20 puts it over the static chrome and the
            blurred bubbles while staying under the held bubble's z-30, so the menu
            itself is still reachable. `touch-action: none` freezes the scroll
            underneath for the reason iOS does: the menu is anchored to the bubble,
            and a stray swipe would carry both off screen mid-decision. */}
        {actionMenuFor && (
          <button
            type="button"
            aria-label="Close message actions"
            onClick={() => setActionMenuFor(null)}
            className="absolute inset-0 z-20 cursor-default"
            style={{ touchAction: "none" }}
          />
        )}
        <div className="chat-chrome flex-shrink-0 border-b px-2 py-2">
          {searchOpen ? (
            <div className="flex items-center gap-1">
              <button type="button" onClick={closeSearch} className="chat-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full" aria-label="Close search">
                <ArrowLeft size={20} />
              </button>
              <input autoFocus value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setActiveHit(0); }} placeholder="Search messages..." className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-[var(--chat-meta)]" />
              <span className="chat-meta shrink-0 px-1 text-xs">
                {searchHits.length ? `${activeHit + 1}/${searchHits.length}` : searchQuery.trim() ? "0/0" : ""}
              </span>
              <button type="button" onClick={() => stepSearch(1)} disabled={!searchHits.length} className="chat-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-full disabled:opacity-40" aria-label="Older match">
                <ChevronUp size={18} />
              </button>
              <button type="button" onClick={() => stepSearch(-1)} disabled={!searchHits.length} className="chat-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-full disabled:opacity-40" aria-label="Newer match">
                <ChevronDown size={18} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => router.back()} className="chat-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full" aria-label="Back">
                <ArrowLeft size={20} />
              </button>
              <img src={generatedAvatarUrl(otherUserId || "ghost")} alt="" className="chat-bubble h-9 w-9 shrink-0 rounded-full object-cover p-0.5" />
              <div className="min-w-0 flex-1 leading-tight">
                {/* `otherLabel` is set from the locally cached handle the moment
                    the conversation row lands, so this bar is on screen for one
                    round trip at most — but an empty bold line where a name goes
                    reads as a broken header, and a placeholder name would be a
                    lie about who you are talking to. */}
                {otherLabel ? (
                  <p className="truncate text-[15px] font-bold">{otherLabel}</p>
                ) : (
                  <div className="skeleton my-[0.3rem] h-3.5 w-28 rounded-full" aria-hidden />
                )}
                {loading ? (
                  <div className="skeleton my-[0.2rem] h-2.5 w-14 rounded-full" aria-hidden />
                ) : (
                  <p className={`truncate text-[11px] ${otherTyping || otherUserOnline ? "" : "chat-meta"}`} style={otherTyping || otherUserOnline ? { color: "var(--theme-success)" } : undefined}>
                    {otherTyping ? "typing..." : otherUserOnline ? "online" : "offline"}
                  </p>
                )}
              </div>
              {/* The call button exists only for accepted friendships — the
                  same relationship the send gate holds, so a pending thread
                  can never ring. While a call is live it stays visible and
                  inert: the sheet below is where the call is managed. */}
              {!loading && isFriendConversation && (
                <button
                  type="button"
                  onClick={() => void call.startCall()}
                  disabled={call.status !== "idle"}
                  className="chat-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
                  aria-label="Start voice call"
                >
                  <Phone size={19} />
                </button>
              )}
              <button type="button" onClick={() => setSearchOpen(true)} className="chat-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full" aria-label="Search messages">
                <Search size={19} />
              </button>
            </div>
          )}
        </div>

        {activePin && (
          <div className="chat-chrome flex-shrink-0 border-b" style={{ borderColor: "color-mix(in srgb, var(--theme-warning) 28%, transparent)" }}>
            <div className="flex items-center gap-2 px-3 py-2">
              <button type="button" onClick={jumpToNextPin} className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs" style={{ color: "var(--theme-warning)" }} aria-label={`Jump to pinned message${pinnedMessages.length > 1 ? `, ${pinIndex + 1} of ${pinnedMessages.length}` : ""}`}>
                <Pin size={12} className="shrink-0" />
                <span className="truncate">{messagePreviewText(activePin)}</span>
                {pinnedMessages.length > 1 && <span className="shrink-0 opacity-60">{pinIndex + 1}/{pinnedMessages.length}</span>}
              </button>
              <button type="button" onClick={() => togglePin(activePin)} className="chat-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-full" aria-label="Unpin this message">
                <PinOff size={13} />
              </button>
            </div>
          </div>
        )}

        <div ref={messagesContainerRef} className="frame-scroll relative flex-1">
          <div ref={messagesContentRef} className="relative min-h-full px-3 py-4 md:px-6">
            <ChatDoodleBackground />
            {/* The WhatsApp-style trust chip, worded for what Whisper actually
                does (TLS + RLS, not E2EE) — see the component for the audit. */}
            {!loading && <ChatPrivacyNotice />}
            {/* The pending-request banner: shown to the RECEIVER of a pending
                request until they accept (or the thread is torn down). The
                composer below is locked for the same window — the banner is
                where that lock gets its explanation and its action. */}
            {acceptLocked && (
              <div className="chat-context-recede mx-auto my-4 w-full max-w-sm">
                <div className="chat-bubble rounded-3xl p-5 text-center" style={{ borderLeft: "3px solid var(--theme-accent-purple)" }}>
                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "color-mix(in srgb, var(--theme-accent-purple) 16%, transparent)", color: "var(--theme-accent-purple)" }}>
                    <Handshake size={24} />
                  </div>
                  <h2 className="text-lg font-black">Someone wants to be your friend</h2>
                  <p className="chat-meta mx-auto mt-1.5 max-w-[260px] text-sm">
                    Accept the request to reply. Your anonymity stays intact either way.
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <Button
                      size="sm"
                      variant="success"
                      loading={acceptingRequest}
                      onClick={acceptPendingRequest}
                      icon={<Check size={15} />}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={acceptingRequest || decliningRequest}
                      onClick={declinePendingRequest}
                    >
                      Decline
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {composerLocked && (
              <div className="chat-bubble rounded-3xl p-6 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "color-mix(in srgb, var(--theme-accent-purple) 16%, transparent)", color: "var(--theme-accent-purple)" }}>
                  <LockKeyhole />
                </div>
                <h2 className="text-2xl font-black">Chat locked</h2>
                <p className="chat-meta mx-auto mt-2 max-w-sm text-sm">
                  {isFriendConversation ? "Unlock this friend conversation once for 40 Coins to send messages." : "Unlock this anonymous conversation once to send messages normally."}
                </p>
                <button onClick={unlockChat} disabled={unlocking} className="mt-5 inline-flex items-center gap-2 rounded-2xl px-5 py-3 font-black shadow-lg transition active:scale-95 disabled:opacity-60" style={{ background: "linear-gradient(135deg, var(--theme-accent-from), var(--theme-accent-to))", color: "var(--theme-accent-contrast)" }}>
                  <Coins size={18} /> {unlocking ? "Unlocking..." : `Unlock for ${UNLOCK_CHAT_COST} Coins`}
                </button>
              </div>
            )}

            {loading ? (
              <ChatSkeleton />
            ) : visibleTimeline.length === 0 ? (
              <p className="chat-context-recede chat-meta mt-10 text-center">Say hi 👻 — they won&apos;t know who you are.</p>
            ) : (
              visibleTimeline.map((msg, index) => {
                const previous = index > 0 ? visibleTimeline[index - 1] : null;
                const next = index < visibleTimeline.length - 1 ? visibleTimeline[index + 1] : null;
                /* Call outcomes are system chips, not bubbles: they break the
                   run on both sides so nobody's avatar/date grouping gets
                   swallowed by a neighboring log row. */
                if (msg.call_entry) {
                  return (
                    <CallEntryRow
                      key={msg.id}
                      entry={msg.call_entry}
                      viewerId={myId}
                      isFriend={Boolean(isFriendConversation)}
                      onCallBack={isFriendConversation ? () => void call.startCall() : undefined}
                    />
                  );
                }
                const startsDay = !previous || !sameDay(previous.created_at, msg.created_at);
                const withinRun = (a: Message, b: Message) =>
                  !a.call_entry && !b.call_entry &&
                  a.sender_id === b.sender_id &&
                  sameDay(a.created_at, b.created_at) &&
                  Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) < 5 * 60_000;
                const isGroupStart = startsDay || !previous || !withinRun(previous, msg);
                const isGroupEnd = !next || !withinRun(msg, next);
                return (
                  <div key={msg.id}>
                    {startsDay && (
                      <div className="sticky top-2 z-10 my-4 flex justify-center">
                        <span className="chat-day-chip rounded-full px-3 py-1 text-[11px] font-semibold backdrop-blur-md">{dayLabel(msg.created_at)}</span>
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
                      onRetry={retryMessage}
                    />
                  </div>
                );
              })
            )}
            {otherTyping && (
              <div className="chat-context-recede mt-3 flex items-end gap-2">
                <div className="chat-bubble rounded-2xl rounded-bl-sm px-4 py-3">
                  <span className="flex items-center gap-1.5" aria-label={`${otherLabel} is typing`}>
                    <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--chat-meta)] [animation-delay:-0.2s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--chat-meta)] [animation-delay:-0.1s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--chat-meta)]" />
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Hidden rather than blurred while a message is held: it is a floating
            control on its own layer, so receding it would leave a soft grey disc
            competing with the reaction bar for the same corner. */}
        {!atBottom && !actionMenuFor && (
          <div className="pointer-events-none relative z-20">
            <button type="button" onClick={() => scrollToBottom()} className="chat-chrome pointer-events-auto absolute bottom-3 right-4 flex h-11 w-11 items-center justify-center rounded-full border shadow-lg" style={{ color: "var(--chat-icon)" }} aria-label={unseenCount ? `${unseenCount} new messages, scroll to latest` : "Scroll to latest"}>
              <ChevronDown size={20} />
              {unseenCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-black" style={{ background: "linear-gradient(135deg, var(--theme-accent-from), var(--theme-accent-to))", color: "var(--theme-accent-contrast)" }}>
                  {unseenCount > 99 ? "99+" : unseenCount}
                </span>
              )}
            </button>
          </div>
        )}

        {pendingPhoto && (
          <div className="chat-context-recede chat-field mx-3 mb-2 flex flex-shrink-0 items-center gap-3 rounded-xl px-3 py-2 md:mx-6">
            <img src={pendingPhoto.previewUrl} alt="Selected photo" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
            <p className="chat-meta flex-1 truncate text-xs">Ready to send — costs {SEND_IMAGE_COST} coins</p>
            <button type="button" onClick={cancelPendingPhoto} disabled={uploadingPhoto} className="chat-icon disabled:opacity-60">
              <X size={14} />
            </button>
          </div>
        )}

        {replyingTo && (
          <div className="chat-context-recede chat-field mx-3 mb-2 flex flex-shrink-0 items-center justify-between rounded-xl px-3 py-2 md:mx-6" style={{ borderLeft: "3px solid var(--theme-accent-purple)" }}>
            <p className="chat-meta truncate text-xs">Replying to: {messagePreviewText(replyingTo)}</p>
            <button onClick={() => setReplyingTo(null)} className="chat-icon" aria-label="Cancel reply">
              <X size={14} />
            </button>
          </div>
        )}

        {/* The media picker sits in the flex column between the thread and the
            composer, so opening it shrinks the thread exactly as the keyboard
            does — the composer never moves and nothing overlaps. */}
        {myId && chatUnlocked && (
          <MediaPicker
            open={pickerOpen}
            tab={pickerTab}
            onTabChange={setPickerTab}
            userId={myId}
            onPickEmoji={insertEmoji}
            onPickSticker={handlePickSticker}
            sendingMedia={mediaSending}
            showToast={showToast}
            isDesktop={isDesktop}
          />
        )}

        {showAttachSheet && (
          <div className="chat-chrome flex-shrink-0 border-t px-4 py-4">
            <div className="flex items-start gap-6">
              <button type="button" onClick={() => { setShowAttachSheet(false); triggerPhotoPicker(); }} className="chat-meta flex flex-col items-center gap-2 text-[11px] font-semibold">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-600" style={{ color: "#ffffff" }}>
                  <ImagePlus size={20} />
                </span>
                Gallery
              </button>
              <button type="button" onClick={() => { setShowAttachSheet(false); triggerCameraPicker(); }} className="chat-meta flex flex-col items-center gap-2 text-[11px] font-semibold">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600" style={{ color: "#ffffff" }}>
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

        <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="flex-shrink-0 p-3 pt-2 md:px-6">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelected} />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoSelected} />
          {!loading && gateError ? (
            /* The gates failed (network, not denial): a retry, not a paywall
               and not a dead input nobody explained. */
            <div className="flex items-center gap-3 rounded-[22px] border border-red-400/25 bg-red-500/10 px-4 py-3">
              <p className="min-w-0 flex-1 text-xs font-semibold leading-snug text-red-100">
                Couldn&apos;t verify this chat. <span className="font-normal opacity-75">{gateError}</span>
              </p>
              <button
                type="button"
                onClick={() => void retryGate()}
                disabled={gateChecking}
                className="shrink-0 rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-500 px-4 py-2 text-xs font-black text-white shadow-lg transition active:scale-95 disabled:opacity-60"
              >
                {gateChecking ? "Checking…" : "Try again"}
              </button>
            </div>
          ) : (
            <>
              {/* A disabled composer always explains itself, right where the
                  fingers are: the paywall/accept panels live at the top of a
                  thread nobody scrolls back through, so without this strip a
                  locked input reads as "blocked by something invisible". */}
              {!loading && !gateError && acceptLocked && (
                <div className="mb-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                  <p className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-200">
                    Accept {otherLabel || "this user"}&apos;s request to reply.
                  </p>
                  <button
                    type="button"
                    onClick={() => void acceptPendingRequest()}
                    disabled={acceptingRequest}
                    className="shrink-0 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 px-4 py-1.5 text-xs font-black text-white shadow transition active:scale-95 disabled:opacity-60"
                  >
                    {acceptingRequest ? "Accepting…" : "Accept"}
                  </button>
                </div>
              )}
              {!loading && !gateError && !acceptLocked && composerLocked && (
                <div className="mb-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                  <p className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-200">
                    Unlock this chat once to send messages.
                  </p>
                  <button
                    type="button"
                    onClick={() => void unlockChat()}
                    disabled={unlocking}
                    className="flex shrink-0 items-center gap-1 rounded-full px-4 py-1.5 text-xs font-black shadow transition active:scale-95 disabled:opacity-60"
                    style={{ background: "linear-gradient(135deg, var(--theme-accent-from), var(--theme-accent-to))", color: "var(--theme-accent-contrast)" }}
                  >
                    <Coins size={13} /> {unlocking ? "Unlocking…" : `Unlock · ${UNLOCK_CHAT_COST}`}
                  </button>
                </div>
              )}
              <div className="relative flex items-end gap-2">
            <div className="chat-field flex min-w-0 flex-1 items-end gap-0.5 rounded-[26px] p-1">
              <button
                type="button"
                onClick={() => togglePicker(pickerOpen ? pickerTab : "emoji")}
                className="chat-icon mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition"
                aria-label={pickerOpen ? "Close emoji and sticker picker" : "Open emoji and sticker picker"}
                aria-expanded={pickerOpen}
                style={pickerOpen ? { color: "var(--theme-accent-purple)" } : undefined}
              >
                {pickerOpen ? <X size={21} /> : <Smile size={21} />}
              </button>
              {/* The wrapper takes over the flex sizing so the composer still
                  grows exactly as it did; the textarea just fills it. The cubes
                  come from the app-wide emitter mounted in the root layout —
                  they used to come from here, clipped to this 44px box, which is
                  why the effect was invisible. */}
              <ExplodingInput className="flex min-w-0 flex-1">
                <textarea
                  ref={textareaRef}
                  {...PROSE_INPUT_PROPS}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  /* Tapping the input hands the space back to the OS keyboard:
                     the picker row unmounts as the keyboard arrives, so the
                     two never stack. Desktop pointers skip this — there is no
                     keyboard to make room for, and WhatsApp Web keeps its
                     panel open while you type. */
                  onFocus={() => { if (!isDesktop) closePicker(); }}
                  placeholder={pendingPhoto ? "Add a caption (optional)..." : acceptLocked ? "Accept the request to reply" : composerLocked ? "Unlock chat to send messages" : "Message"}
                  disabled={loading || !chatUnlocked || acceptLocked}
                  rows={1}
                  className="max-h-32 w-full min-w-0 resize-none overflow-y-auto bg-transparent px-1 py-2.5 leading-6 outline-none placeholder:text-[var(--chat-meta)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </ExplodingInput>
              <button type="button" onClick={() => { setShowAttachSheet((open) => !open); closePicker(); }} disabled={uploadingPhoto} title={`Attach an image (${SEND_IMAGE_COST} coins)`} aria-label="Attach" className="chat-icon mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition disabled:opacity-60" aria-expanded={showAttachSheet}>
                <Paperclip size={20} />
              </button>
              <button type="button" onClick={() => { closePicker(); setShowAttachSheet(false); triggerCameraPicker(); }} disabled={uploadingPhoto} title={`Take a photo (${SEND_IMAGE_COST} coins)`} aria-label="Camera" className="chat-icon mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition disabled:opacity-60">
                <Camera size={20} />
              </button>
            </div>
            {!recordingVoice && (input.trim().length > 0 || pendingPhoto) ? (
              <button ref={sendButtonRef} type="submit" disabled={!chatUnlocked || (pendingPhoto ? uploadingPhoto : false)} aria-label={pendingPhoto ? `Send photo for ${SEND_IMAGE_COST} coins` : "Send message"} className={`chat-send-circle chat-send-circle-press flex h-[52px] shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50 ${pendingPhoto ? "gap-1.5 px-4" : "w-[52px]"}`}>
                {pendingPhoto ? (
                  uploadingPhoto ? <Loader2 size={18} className="animate-spin" /> : (<><Coins size={17} /><span className="text-sm font-black">{SEND_IMAGE_COST}</span></>)
                ) : (
                  <Send size={19} />
                )}
              </button>
            ) : (
              <VoiceRecorder
                canRecord={!loading && chatUnlocked && !acceptLocked}
                cost={SEND_VOICE_COST}
                busy={uploadingPhoto}
                onBlocked={() => showToast(gateError ? "Couldn't verify this chat — tap Try again." : acceptLocked ? "Accept the friend request to reply." : loading ? "One moment — still opening this chat." : isFriendConversation ? "You need 40 coins to unlock this conversation." : `Unlock this chat once for ${UNLOCK_CHAT_COST} Whisper Coins first.`)}
                onSend={handleVoiceNote}
                onError={showToast}
                onRecordingChange={setRecordingVoice}
              />
              )}
              </div>
            </>
          )}
        </form>
      </div>

      {pinDurationFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={() => setPinDurationFor(null)}>
          <GlassPanel strong className="w-full max-w-sm rounded-t-3xl p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center gap-2">
              <Pin size={16} style={{ color: "var(--theme-warning)" }} />
              <h2 className="text-base font-black">Pin this message</h2>
            </div>
            <p className="mb-4 truncate text-sm text-[var(--theme-text-muted)]">{messagePreviewText(pinDurationFor)}</p>
            <div className="flex flex-col gap-1.5">
              {PIN_DURATIONS.map((duration) => (
                <button key={duration.label} type="button" onClick={() => confirmPin(pinDurationFor, duration.hours)} className="glass-control flex items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-semibold">
                  <span className="capitalize">{duration.label}</span>
                  {duration.hours === null && <PinOff size={14} className="opacity-50" />}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setPinDurationFor(null)} className="mt-3 w-full rounded-xl py-2.5 text-sm font-bold text-[var(--theme-text-muted)]">Cancel</button>
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
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-2xl border border-[var(--theme-border)] py-2 text-sm font-bold text-[var(--theme-text-secondary)]">Cancel</button>
              <button onClick={() => deleteMessage(deleteConfirm)} className="flex-1 rounded-2xl bg-rose-500 py-2 text-sm font-black text-white hover:bg-rose-600">Delete</button>
            </div>
          </GlassPanel>
        </div>
      )}

      {photoModalUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={closePhotoModal}>
          <div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
            {photoModalCaption && <p className="mb-3 text-center text-sm font-medium" style={{ color: "#ffffff" }}>{photoModalCaption}</p>}
            <img src={photoModalUrl} alt="View-once photo" className="max-h-[80vh] max-w-full rounded-2xl object-contain" />
            <p className="mt-3 text-center text-xs" style={{ color: "rgba(255,255,255,0.65)" }}>This photo won&apos;t be available again after you close this view.</p>
            <button onClick={closePhotoModal} className="absolute -top-3 -right-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-lg">
              <X size={18} />
            </button>
          </div>
        </div>
      )}
      {/* Outside the composer on purpose: the send button unmounts the moment the
          input clears, so anything rendered inside that branch would be torn down
          while the plane was still in the air. */}
      <PaperPlaneFlight flightId={flightId} origin={flightOrigin} />

      {/* The call surfaces, above every in-app layer (the overlay at z-70
          beats the pin-duration and delete modals at z-50 — a call arriving
          over an open dialog wins that screen, the way a phone call beats
          whatever is on the lock screen). */}
      {call.status === "incoming" && (
        <IncomingCallOverlay
          name={otherLabel || "Anonymous Friend"}
          avatarUrl={generatedAvatarUrl(otherUserId || "ghost")}
          onAccept={() => void call.acceptIncoming()}
          onDecline={call.declineIncoming}
        />
      )}
      {(call.status === "outgoing" || call.status === "connecting" || call.status === "in_call") && (
        <InCallSheet
          name={otherLabel || "Anonymous Friend"}
          avatarUrl={generatedAvatarUrl(otherUserId || "ghost")}
          status={call.status}
          startedAt={call.startedAt}
          muted={call.muted}
          speakerSupported={call.speakerSupported}
          speakerOn={call.speakerOn}
          onToggleMute={call.toggleMute}
          onToggleSpeaker={() => void call.toggleSpeaker()}
          onHangUp={call.hangUp}
        />
      )}
    </main>
  );
}