"use client";

import { Ban, Copy, Flag, Share2, Trash2 } from "lucide-react";
import Modal from "@/components/Modal";
import { timeAgo, topicMeta, type FeedPost } from "@/lib/feed";
import { vibrate, HAPTIC } from "@/lib/haptics";

/**
 * The overflow sheet for one post.
 *
 * Rendered once by the page and pointed at whichever post was tapped, rather
 * than mounted per card — see the note on `onOpenMenu` in ./types.
 *
 * What lives here and what stays on the action bar is a deliberate split. The
 * action bar carries the four things people do constantly (reply, like, see the
 * count, share) and nothing else; everything rare or destructive comes here.
 * Delete moved off the bar for exactly that reason: it was one row away from the
 * like button, at thumb height, on your own posts.
 */

type FeedPostMenuProps = {
  post: FeedPost | null;
  isMine: boolean;
  onClose: () => void;
  onCopyLink: (post: FeedPost) => void;
  onShare: (post: FeedPost) => void;
  onReport: (post: FeedPost) => void;
  onBlock: (post: FeedPost) => void;
  onDelete: (post: FeedPost) => void;
};

export default function FeedPostMenu({
  post,
  isMine,
  onClose,
  onCopyLink,
  onShare,
  onReport,
  onBlock,
  onDelete,
}: FeedPostMenuProps) {
  const topic = topicMeta(post?.topic);

  /* Each item closes the sheet before acting. Two of these open another sheet,
     and leaving this one mounted underneath would stack two backdrops and two
     focus traps. */
  const run = (action: (post: FeedPost) => void) => () => {
    if (!post) return;
    vibrate(HAPTIC.tap);
    onClose();
    action(post);
  };

  return (
    <Modal
      open={Boolean(post)}
      onClose={onClose}
      variant="sheet"
      showClose={false}
      className="feed-sheet"
    >
      <div className="feed-sheet-body">
        {post && (
          <header className="feed-sheet-head">
            <p className="feed-sheet-quote">{post.body}</p>
            <p className="feed-sheet-meta">
              {topic ? `${topic.emoji} ${topic.label} · ` : ""}
              {timeAgo(post.created_at)} ago
            </p>
          </header>
        )}

        <button type="button" onClick={run(onCopyLink)} className="feed-sheet-item">
          <Copy size={17} aria-hidden />
          Copy link
        </button>

        <button type="button" onClick={run(onShare)} className="feed-sheet-item">
          <Share2 size={17} aria-hidden />
          Share whisper
        </button>

        {/* Reporting your own post is refused by the table's insert policy, so
            the control is absent rather than shown and then rejected. */}
        {!isMine && (
          <>
            <button type="button" onClick={run(onReport)} className="feed-sheet-item is-danger">
              <Flag size={17} aria-hidden />
              Report this whisper
            </button>

            <button type="button" onClick={run(onBlock)} className="feed-sheet-item is-danger">
              <Ban size={17} aria-hidden />
              Block this author
            </button>
          </>
        )}

        {isMine && (
          <button type="button" onClick={run(onDelete)} className="feed-sheet-item is-danger">
            <Trash2 size={17} aria-hidden />
            Delete whisper
          </button>
        )}

        <button type="button" onClick={onClose} className="feed-sheet-cancel">
          Cancel
        </button>
      </div>
    </Modal>
  );
}
