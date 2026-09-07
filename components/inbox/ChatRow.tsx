"use client";

import { memo, useCallback, useRef } from "react";
import Image from "next/image";
import { Pin } from "lucide-react";
import MessageTicks from "@/components/MessageTicks";
import { generatedAvatarUrl } from "@/lib/generatedAvatar";

export type ChatRowProps = {
  conversationId: string;
  avatarUserId: string;
  label: string;
  timestamp: string;
  previewText: string;
  unread: boolean;
  unreadCount: number;
  active: boolean;
  typing: boolean;
  /** Ticks render only on your own latest message, WhatsApp-style. */
  showTicks: boolean;
  deliveredAt: string | null;
  readAt: string | null;
  /** Pinned chats float to the top; the glyph mirrors WhatsApp's. */
  pinned: boolean;
  /** Held row while its long-press action menu is open. */
  selected: boolean;
  onOpen: (conversationId: string) => void;
  /** Long-press / right-click: open the WhatsApp-style row menu. */
  onLongPress: (conversationId: string, anchor: { x: number; y: number }) => void;
};

/** How long a press has to stay down before it counts as a hold, matching the
    chat bubble menu's 450ms. */
const LONG_PRESS_MS = 420;

/**
 * One row of the chat list.
 *
 * Extracted and memoized because of how often the inbox re-renders for reasons
 * that have nothing to do with any individual row. Presence arrives as a whole
 * array of online ids, typing arrives per conversation, previews and unread
 * counts arrive as maps — and every one of those set a state value on the page
 * component, which re-rendered every row in the list. A row whose props are
 * unchanged now bails out at the memo boundary instead.
 *
 * Every prop is a primitive for that reason. Handing this component the
 * conversation row plus the `previews` and `onlineUserIds` collections would
 * re-render all of them whenever any entry changed, which is the situation the
 * memo exists to avoid. The parent flattens; the row compares cheaply.
 */
function ChatRowBase({
  conversationId,
  avatarUserId,
  label,
  timestamp,
  previewText,
  unread,
  unreadCount,
  active,
  typing,
  showTicks,
  deliveredAt,
  readAt,
  pinned,
  selected,
  onOpen,
  onLongPress,
}: ChatRowProps) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  /* Where the finger went down — the menu anchors there rather than on a
     hardcoded corner, so it appears next to the held row. */
  const anchorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  /* Bound here rather than as an inline arrow in the parent's map: an arrow
     created during render is a new function identity every time, which would
     invalidate the memo on every parent render and undo the whole point. */
  const handleOpen = useCallback(() => {
    /* A long-press that just fired must not also count as the tap that opens
       the conversation. */
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    onOpen(conversationId);
  }, [onOpen, conversationId]);

  const startPress = useCallback(
    (event: React.PointerEvent) => {
      anchorRef.current = { x: event.clientX, y: event.clientY };
      longPressed.current = false;
      if (pressTimer.current) clearTimeout(pressTimer.current);
      pressTimer.current = setTimeout(() => {
        longPressed.current = true;
        navigator.vibrate?.(18);
        onLongPress(conversationId, { ...anchorRef.current });
      }, LONG_PRESS_MS);
    },
    [conversationId, onLongPress]
  );

  const cancelPress = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      /* Desktop: right-click opens the same menu instead of the browser one. */
      event.preventDefault();
      cancelPress();
      longPressed.current = true;
      onLongPress(conversationId, { x: event.clientX, y: event.clientY });
      /* Release the swallow flag on the next tick so a subsequent ordinary
         click still opens the chat. */
      window.setTimeout(() => {
        longPressed.current = false;
      }, 0);
    },
    [conversationId, onLongPress, cancelPress]
  );

  return (
    <li>
      <button
        type="button"
        onClick={handleOpen}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={handleContextMenu}
        /* `px-4 sm:px-6` matches the page container's own padding, which the
           list cancels with `-mx-4 sm:-mx-6`. Net effect: the row's background
           runs edge to edge like WhatsApp's, while its text still lines up with
           the heading above the list. Hover and press live in `.chat-row` —
           a Tailwind `active:` variant compiles to a class the theme bridge
           doesn't rewrite, so it would flash white in light theme. */
        className={`chat-row flex w-full items-center gap-3 px-4 py-3 text-left sm:px-6 ${
          selected ? "chat-row-selected" : ""
        }`}
      >
        <div className="relative h-12 w-12 shrink-0">
          {/* `unoptimized` on purpose: DiceBear returns an SVG, and running an
              already-tiny vector through the optimizer costs a server round trip
              to produce something larger. What `next/image` is here for is the
              rest of its behaviour — explicit dimensions so the row reserves its
              box and the list never shifts, plus native lazy loading and async
              decode so a long chat list doesn't decode 30 avatars on the main
              thread during the first paint. */}
          <Image
            src={generatedAvatarUrl(avatarUserId)}
            alt=""
            width={48}
            height={48}
            unoptimized
            className="h-12 w-12 rounded-full border border-white/15 bg-white/10 object-cover p-0.5"
          />
          <span
            className={`chat-row-presence absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 ${
              active ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-gray-600"
            }`}
            aria-label={active ? "Active now" : "Offline"}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p
              className={`min-w-0 flex-1 truncate text-[15px] ${
                unread ? "font-bold text-white" : "font-semibold text-gray-200"
              }`}
            >
              {label}
            </p>
            {pinned && (
              <Pin
                size={12}
                className="shrink-0 text-gray-400"
                fill="currentColor"
                aria-label="Pinned chat"
              />
            )}
            <span
              className={`shrink-0 text-[11px] ${
                unread ? "font-bold text-emerald-400" : "text-gray-500"
              }`}
            >
              {timestamp}
            </span>
          </div>

          <div className="mt-0.5 flex items-center gap-1.5">
            {showTicks && <MessageTicks deliveredAt={deliveredAt} readAt={readAt} />}
            <p
              className={`min-w-0 flex-1 truncate text-[13px] ${
                typing ? "font-semibold text-emerald-400" : unread ? "text-gray-200" : "text-gray-500"
              }`}
            >
              {typing ? "typing..." : previewText}
            </p>
            {unread && (
              <span
                className={`flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-black text-black ${
                  unreadCount > 0 ? "bg-emerald-500" : "chat-row-dot-unread"
                }`}
                aria-label={unreadCount > 0 ? `${unreadCount} unread messages` : "Marked unread"}
              >
                {unreadCount > 0 ? (unreadCount > 99 ? "99+" : unreadCount) : ""}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

const ChatRow = memo(ChatRowBase);
export default ChatRow;
