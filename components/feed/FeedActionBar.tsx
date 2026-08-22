"use client";

import { memo } from "react";
import { BarChart3, Heart, MessageCircle, MoreHorizontal, Share2 } from "lucide-react";
import { compactCount } from "@/lib/feed";

/**
 * The engagement row under a post, laid out the way X lays it out: icons on the
 * left spread across the width, each with its count inline, and the trailing
 * controls pushed to the far edge.
 *
 * X shows five slots — reply, repost, like, views, bookmark — and only four of
 * them mean anything in Whisper. Rather than draw two dead icons to complete the
 * silhouette, this renders the four that are wired to something real. A button
 * that looks tappable and does nothing costs more trust than a missing one.
 *
 * The reply slot carries both jobs X gives it, split by whether replies exist.
 * With replies, tapping opens the thread — that is what a count next to an icon
 * promises, and making it open a composer instead is the small betrayal that
 * makes a feed feel wrong. Writing one is then a separate labelled control, so
 * neither action is hidden behind the other.
 *
 * Delete used to sit at the end of this row and now lives in the overflow sheet.
 * It was one row away from the like button, at thumb height, on your own posts —
 * a destructive action inside a rhythm of taps people make without looking.
 *
 * Counts sit in `tabular-nums` because they change under realtime updates, and
 * proportional digits make the whole row shuffle sideways when a like lands.
 */

type FeedActionBarProps = {
  replyCount: number;
  likeCount: number;
  viewCount: number;
  liked: boolean;
  replyOpen: boolean;
  threadOpen: boolean;
  onReply: () => void;
  /** Absent when this post has no replies, or when an ancestor opened them. */
  onToggleThread?: () => void;
  onLike: () => void;
  onShare: () => void;
  onMore: () => void;
};

function FeedActionBarBase({
  replyCount,
  likeCount,
  viewCount,
  liked,
  replyOpen,
  threadOpen,
  onReply,
  onToggleThread,
  onLike,
  onShare,
  onMore,
}: FeedActionBarProps) {
  const showsThread = Boolean(onToggleThread) && replyCount > 0;

  return (
    <div className="feed-action-row">
      <button
        type="button"
        onClick={showsThread ? onToggleThread : onReply}
        aria-expanded={showsThread ? threadOpen : replyOpen}
        aria-label={
          showsThread
            ? `${threadOpen ? "Hide" : "Show"} ${replyCount === 1 ? "1 reply" : `${replyCount} replies`}`
            : "Write a reply"
        }
        className={`feed-action feed-action-reply ${
          (showsThread ? threadOpen : replyOpen) ? "is-active" : ""
        }`}
      >
        <span className="feed-action-icon">
          <MessageCircle size={15} strokeWidth={2} />
        </span>
        {replyCount > 0 && <span className="tabular-nums">{compactCount(replyCount)}</span>}
      </button>

      {/* Only once the count has taken over the icon — on a post with no
          replies the icon still opens the composer, so a second control would
          be two buttons for one action. */}
      {showsThread && (
        <button
          type="button"
          onClick={onReply}
          aria-expanded={replyOpen}
          aria-label="Write a reply"
          className={`feed-action feed-action-write ${replyOpen ? "is-active" : ""}`}
        >
          Reply
        </button>
      )}

      <button
        type="button"
        onClick={onLike}
        aria-pressed={liked}
        aria-label={liked ? "Remove like" : "Like"}
        className={`feed-action feed-action-like ${liked ? "is-active" : ""}`}
      >
        <span className="feed-action-icon">
          <Heart size={15} strokeWidth={2} fill={liked ? "currentColor" : "none"} />
        </span>
        {likeCount > 0 && <span className="tabular-nums">{compactCount(likeCount)}</span>}
      </button>

      {/* Views are read-only, so this is a plain span — a button here would
          promise an analytics screen that doesn't exist. */}
      <span className="feed-action feed-action-view" aria-label={`${viewCount} views`}>
        <span className="feed-action-icon">
          <BarChart3 size={15} strokeWidth={2} />
        </span>
        <span className="tabular-nums">{compactCount(viewCount)}</span>
      </span>

      <div className="feed-action-tail">
        <button
          type="button"
          onClick={onShare}
          aria-label="Share this post"
          className="feed-action feed-action-share"
        >
          <span className="feed-action-icon">
            <Share2 size={15} strokeWidth={2} />
          </span>
        </button>

        <button
          type="button"
          onClick={onMore}
          aria-label="More options"
          aria-haspopup="dialog"
          className="feed-action feed-action-more"
        >
          <span className="feed-action-icon">
            <MoreHorizontal size={15} strokeWidth={2} />
          </span>
        </button>
      </div>
    </div>
  );
}

export const FeedActionBar = memo(FeedActionBarBase);
export default FeedActionBar;
