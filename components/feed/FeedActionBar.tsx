"use client";

import { memo } from "react";
import { BarChart3, Heart, MessageCircle, Share2, Trash2 } from "lucide-react";
import { compactCount } from "@/lib/feed";

/**
 * The engagement row under a post, laid out the way X lays it out: icons on the
 * left spread across the width, each with its count inline, and the share
 * affordance pushed to the trailing edge.
 *
 * X shows five slots — reply, repost, like, views, bookmark — and only four of
 * them mean anything in Whisper. Rather than draw two dead icons to complete the
 * silhouette, this renders the four that are wired to something real. A button
 * that looks tappable and does nothing costs more trust than a missing one.
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
  canDelete: boolean;
  onReply: () => void;
  onLike: () => void;
  onShare: () => void;
  onDelete: () => void;
};

function FeedActionBarBase({
  replyCount,
  likeCount,
  viewCount,
  liked,
  replyOpen,
  canDelete,
  onReply,
  onLike,
  onShare,
  onDelete,
}: FeedActionBarProps) {
  return (
    <div className="mt-2.5 flex items-center justify-between pr-1">
      <button
        type="button"
        onClick={onReply}
        aria-expanded={replyOpen}
        aria-label={replyCount === 1 ? "1 reply" : `${replyCount} replies`}
        className={`feed-action feed-action-reply ${replyOpen ? "is-active" : ""}`}
      >
        <span className="feed-action-icon">
          <MessageCircle size={15} strokeWidth={2} />
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

      <div className="flex items-center gap-0.5">
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

        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete this post"
            className="feed-action feed-action-delete"
          >
            <span className="feed-action-icon">
              <Trash2 size={15} strokeWidth={2} />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

export const FeedActionBar = memo(FeedActionBarBase);
export default FeedActionBar;
