"use client";

import { memo } from "react";
import { BarChart3, Heart, MessageCircle, Share2 } from "lucide-react";
import { compactCount, formatCount, formatFullCount } from "@/lib/feed";

/**
 * The engagement row under a post, laid out the way X lays it out: every
 * control the same kind of unit — icon, then count — and the units distributed
 * evenly across the full width of the post, so the row reads as one rhythm
 * instead of two groups. Nothing is parked at the far edge and no control is
 * text-only, because a word wedged between icons is the one thing X never does
 * here.
 *
 * X shows five slots — reply, repost, like, views, bookmark — and only four of
 * them mean anything in Whisper. Rather than draw a dead icon to complete the
 * silhouette, this renders the four that are wired to something real: reply,
 * like, views, share. A button that looks tappable and does nothing costs more
 * trust than a missing one.
 *
 * The overflow control that used to end this row now lives in the post header,
 * where X puts it — see FeedPostCard. That is what frees the whole width here
 * for the four counts.
 *
 * Tapping reply is one gesture with one meaning, the same promise X's reply
 * icon makes: take me to the conversation. The card decides what that means
 * concretely (open the thread, and have the composer waiting); this row only
 * reports whether that surface is already up, via `active`, so the icon can
 * wear its open state.
 *
 * Counts sit in `tabular-nums` because they change under realtime updates, and
 * proportional digits make the whole row shuffle sideways when a like lands.
 */

type FeedActionBarProps = {
  replyCount: number;
  likeCount: number;
  viewCount: number;
  liked: boolean;
  /** True while the thread or reply composer this row opens is showing. */
  active?: boolean;
  onReply: () => void;
  onLike: () => void;
  onShare: () => void;
};

function FeedActionBarBase({
  replyCount,
  likeCount,
  viewCount,
  liked,
  active = false,
  onReply,
  onLike,
  onShare,
}: FeedActionBarProps) {
  return (
    <div className="feed-action-row">
      <button
        type="button"
        onClick={onReply}
        aria-expanded={active}
        aria-label={
          replyCount > 0
            ? `Replies and reply box — ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`
            : "Write a reply"
        }
        className={`feed-action feed-action-reply ${active ? "is-active" : ""}`}
      >
        <span className="feed-action-icon">
          <MessageCircle size={16} strokeWidth={2} />
        </span>
        {replyCount > 0 && <span className="tabular-nums">{compactCount(replyCount)}</span>}
      </button>

      <button
        type="button"
        onClick={onLike}
        aria-pressed={liked}
        aria-label={liked ? "Remove like" : "Like"}
        className={`feed-action feed-action-like ${liked ? "is-active" : ""}`}
      >
        <span className="feed-action-icon">
          <Heart size={16} strokeWidth={2} fill={liked ? "currentColor" : "none"} />
        </span>
        {likeCount > 0 && <span className="tabular-nums">{compactCount(likeCount)}</span>}
      </button>

      {/* Views are read-only, so this is a plain span — a button here would
          promise an analytics screen that doesn't exist. The visible number is
          abbreviated (1.25K); the label carries the exact integer. */}
      <span
        className="feed-action feed-action-view"
        aria-label={`${formatFullCount(viewCount)} views`}
      >
        <span className="feed-action-icon">
          <BarChart3 size={16} strokeWidth={2} />
        </span>
        <span className="tabular-nums">{formatCount(viewCount)}</span>
      </span>

      <button
        type="button"
        onClick={onShare}
        aria-label="Share this post"
        className="feed-action feed-action-share"
      >
        <span className="feed-action-icon">
          <Share2 size={16} strokeWidth={2} />
        </span>
      </button>
    </div>
  );
}

export const FeedActionBar = memo(FeedActionBarBase);
export default FeedActionBar;
