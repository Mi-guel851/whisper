"use client";

import { memo } from "react";
import { Loader2, Send, X } from "lucide-react";
import { PROSE_INPUT_PROPS } from "@/lib/textEntry";

/**
 * The inline reply box, shared by root posts and by comments further down a
 * thread — a reply to a reply is composed exactly like a reply to a post, so
 * there is one of these rather than one per depth.
 *
 * Laid out the way X lays out its composer: the box, then a footer with the
 * counter on the left and the actions on the right — cancel, then send. The
 * cancel control matters now that the reply icon opens the composer as part of
 * opening the thread (X's one-gesture "take me to the conversation"): without
 * it, a composer opened by accident had no way to be put away again, and a box
 * that can only fill and send is a trap, not a control.
 *
 * Replies are free. `replyCost` is still a props rather than being deleted,
 * because pricing replies again is a plausible future decision — but at zero it
 * renders nothing at all rather than a coin icon reading "0 to reply", which
 * would draw attention to a cost that isn't there. The character counter takes
 * that space instead: it is the only thing about a free reply worth stating up
 * front.
 */

type FeedReplyComposerProps = {
  postId: string;
  value: string;
  sending: boolean;
  replyCost: number;
  onChange: (postId: string, value: string) => void;
  onSend: (postId: string) => void;
  /** Puts the box away without sending. Absent when there is nothing to close. */
  onCancel?: () => void;
};

const MAX_REPLY_CHARS = 280;

function FeedReplyComposerBase({
  postId,
  value,
  sending,
  replyCost,
  onChange,
  onSend,
  onCancel,
}: FeedReplyComposerProps) {
  const empty = !value.trim();
  const remaining = MAX_REPLY_CHARS - value.length;

  return (
    <div className="feed-reply-box mt-2.5">
      <textarea
        {...PROSE_INPUT_PROPS}
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
        maxLength={MAX_REPLY_CHARS}
        placeholder="Post your reply"
        aria-label="Write a reply"
        className="feed-reply-input w-full resize-none bg-transparent text-[15px] leading-snug outline-none"
      />

      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span className="feed-reply-cost text-[11px] font-bold">
          {replyCost > 0
            ? `${replyCost} coins to reply`
            : /* Only surfaces near the ceiling. A counter that is always visible
                 reads as a limit being enforced; one that appears at 40 left
                 reads as a hint. */
              remaining <= 40
              ? `${remaining} left`
              : ""}
        </span>

        <div className="flex items-center gap-1.5">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Close reply box"
              className="feed-reply-cancel grid h-8 w-8 place-items-center rounded-full"
            >
              <X size={15} strokeWidth={2.4} />
            </button>
          )}

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
    </div>
  );
}

export const FeedReplyComposer = memo(FeedReplyComposerBase);
export default FeedReplyComposer;
