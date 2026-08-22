"use client";

import { memo, useCallback } from "react";
import Image from "next/image";
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
  onOpen: (conversationId: string) => void;
};

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
  onOpen,
}: ChatRowProps) {
  /* Bound here rather than as an inline arrow in the parent's map: an arrow
     created during render is a new function identity every time, which would
     invalidate the memo on every parent render and undo the whole point. */
  const handleOpen = useCallback(() => onOpen(conversationId), [onOpen, conversationId]);

  return (
    <li>
      <button
        type="button"
        onClick={handleOpen}
        /* `px-4 sm:px-6` matches the page container's own padding, which the
           list cancels with `-mx-4 sm:-mx-6`. Net effect: the row's background
           runs edge to edge like WhatsApp's, while its text still lines up with
           the heading above the list. Hover and press live in `.chat-row` —
           a Tailwind `active:` variant compiles to a class the theme bridge
           doesn't rewrite, so it would flash white in light theme. */
        className="chat-row flex w-full items-center gap-3 px-4 py-3 text-left sm:px-6"
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
            {unreadCount > 0 && (
              <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-black text-black">
                {unreadCount > 99 ? "99+" : unreadCount}
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
