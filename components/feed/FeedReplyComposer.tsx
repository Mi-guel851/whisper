"use client";

import { memo } from "react";
import { Loader2, Send } from "lucide-react";
import WhisperCoinIcon from "@/components/WhisperCoinIcon";

/**
 * The inline reply box, shared by root posts and by comments further down a
 * thread — a reply to a reply is composed exactly like a reply to a post, so
 * there is one of these rather than one per depth.
 *
 * Replying costs coins, so the price is stated on the control that spends them
 * instead of appearing as a surprise toast afterwards.
 */

type FeedReplyComposerProps = {
  postId: string;
  value: string;
  sending: boolean;
  replyCost: number;
  onChange: (postId: string, value: string) => void;
  onSend: (postId: string) => void;
};

function FeedReplyComposerBase({
  postId,
  value,
  sending,
  replyCost,
  onChange,
  onSend,
}: FeedReplyComposerProps) {
  const empty = !value.trim();

  return (
    <div className="feed-reply-box mt-2.5">
      <textarea
        value={value}
        onChange={(event) => onChange(postId, event.target.value)}
        onKeyDown={(event) => {
          /* Enter sends, Shift+Enter breaks the line — the convention every
             chat surface in the app already follows. */
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (!empty && !sending) onSend(postId);
          }
        }}
        rows={2}
        maxLength={280}
        placeholder="Post your reply"
        aria-label="Write a reply"
        className="feed-reply-input w-full resize-none bg-transparent text-[15px] leading-snug outline-none"
      />

      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span className="feed-reply-cost flex items-center gap-1 text-[11px] font-bold">
          <WhisperCoinIcon size={13} />
          {replyCost} to reply
        </span>

        <button
          type="button"
          onClick={() => onSend(postId)}
          disabled={empty || sending}
          className="feed-reply-send flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-black disabled:opacity-45"
        >
          {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          {sending ? "Sending" : "Reply"}
        </button>
      </div>
    </div>
  );
}

export const FeedReplyComposer = memo(FeedReplyComposerBase);
export default FeedReplyComposer;
