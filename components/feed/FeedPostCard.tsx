"use client";

import { memo } from "react";
import Link from "next/link";
import { anonymousDisplayName } from "@/lib/anonymousIdentity";
import { compactCount, countDescendants, timeAgo, type FeedPostNode } from "@/lib/feed";
import FeedAvatar from "./FeedAvatar";
import FeedActionBar from "./FeedActionBar";
import FeedReplyComposer from "./FeedReplyComposer";
import type { FeedController } from "./types";

/**
 * A post and its thread, laid out the way X lays out a conversation.
 *
 * The structural idea worth naming: the avatar column is a *rail*, not just a
 * slot. When a post has visible replies, a vertical line runs down that column
 * from under the avatar to the next avatar in the thread, so the eye follows
 * one continuous stroke instead of hunting indentation levels. That is what
 * makes an X thread readable at depth where a Facebook-style nested-and-indented
 * comment list collapses into a wedge on a phone.
 *
 * So indentation stops after the first level. Depth 1 steps in; everything
 * below reuses the same rail and is distinguished by the "replying to" line
 * instead. Threads stay legible however deep they run.
 */

const AVATAR_ROOT = 42;
const AVATAR_REPLY = 34;

/** Replies shown before the thread collapses behind a "show more" affordance. */
const VISIBLE_REPLIES = 2;

type FeedPostCardProps = {
  node: FeedPostNode;
  controller: FeedController;
  depth: number;
  /** Author of the post being answered — renders X's "Replying to" line. */
  parentAuthorId?: string;
  /** Ref callback that registers a root card for impression counting. */
  impressionRef?: (node: HTMLElement | null) => void;
};

function FeedPostCardBase({
  node,
  controller,
  depth,
  parentAuthorId,
  impressionRef,
}: FeedPostCardProps) {
  const isRoot = depth === 0;
  const likes = controller.likesByPost[node.id] || [];
  const liked = likes.some((like) => like.user_id === controller.myId);
  const replyCount = countDescendants(node);
  const isExpanded = Boolean(controller.expanded[node.id]);
  const isReplyOpen = Boolean(controller.replyOpen[node.id]);

  const children = node.children;
  const visibleChildren = isExpanded ? children : children.slice(0, VISIBLE_REPLIES);
  const hiddenCount = children.length - visibleChildren.length;

  /* The rail is drawn whenever something renders below this post in the same
     column — a reply, or the composer that will become one. */
  const hasRail = visibleChildren.length > 0 || isReplyOpen;

  return (
    <article
      ref={isRoot ? impressionRef : undefined}
      data-post-id={node.id}
      data-author-id={node.author_id}
      className={isRoot ? "feed-post" : "feed-post feed-post-reply"}
    >
      <div className="flex gap-3">
        <div className="relative flex shrink-0 flex-col items-center">
          <FeedAvatar authorId={node.author_id} size={isRoot ? AVATAR_ROOT : AVATAR_REPLY} />
          {hasRail && <span aria-hidden className="feed-thread-rail" />}
        </div>

        <div className="min-w-0 flex-1 pb-0.5">
          <div className="flex items-baseline gap-1.5 text-[15px] leading-tight">
            <span className="feed-author truncate font-black">
              {anonymousDisplayName(node.author_id)}
            </span>
            <span className="feed-dot shrink-0" aria-hidden>·</span>
            <time
              dateTime={node.created_at}
              title={new Date(node.created_at).toLocaleString()}
              className="feed-time shrink-0 text-[13px] font-medium"
            >
              {timeAgo(node.created_at)}
            </time>
          </div>

          {/* X's orientation line for a reply that's been lifted out of its
              parent's immediate context. Only shown past the first level,
              where the rail alone no longer says who is being answered. */}
          {parentAuthorId && depth > 1 && (
            <p className="feed-replying-to mt-0.5 truncate text-[13px]">
              Replying to{" "}
              <span className="feed-replying-to-name font-bold">
                {anonymousDisplayName(parentAuthorId)}
              </span>
            </p>
          )}

          <p
            className={`feed-body mt-1 whitespace-pre-wrap break-words leading-normal ${
              isRoot ? "text-[15px]" : "text-[14px]"
            }`}
          >
            {node.body}
          </p>

          {/* Only root posts carry the author's Whisper link. Repeating it on
              every reply would turn a thread into a wall of identical CTAs. */}
          {isRoot && node.whisper_link && (
            <Link href={node.whisper_link} className="feed-cta mt-2.5 block truncate">
              Send me an anonymous Whisper
            </Link>
          )}

          <FeedActionBar
            replyCount={replyCount}
            likeCount={likes.length}
            viewCount={node.view_count ?? 0}
            liked={liked}
            replyOpen={isReplyOpen}
            canDelete={node.author_id === controller.myId}
            onReply={() => controller.onToggleReplyBox(node.id)}
            onLike={() => controller.onToggleLike(node.id)}
            onShare={() => controller.onShare(node.id, node.body, node.whisper_link)}
            onDelete={() => controller.onRequestDelete(node.id)}
          />

          {isReplyOpen && (
            <FeedReplyComposer
              postId={node.id}
              value={controller.replyText[node.id] || ""}
              sending={Boolean(controller.replySending[node.id])}
              replyCost={controller.replyCost}
              onChange={controller.onReplyTextChange}
              onSend={controller.onRequestSend}
            />
          )}
        </div>
      </div>

      {visibleChildren.length > 0 && (
        /* Indent once, then never again — see the note at the top of the file. */
        <div className={depth === 0 ? "feed-thread-children" : undefined}>
          {visibleChildren.map((child) => (
            <FeedPostCard
              key={child.id}
              node={child}
              controller={controller}
              depth={depth + 1}
              parentAuthorId={node.author_id}
            />
          ))}

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => controller.onExpand(node.id)}
              className="feed-show-more"
            >
              Show {compactCount(hiddenCount)} more{" "}
              {hiddenCount === 1 ? "reply" : "replies"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export const FeedPostCard = memo(FeedPostCardBase);
export default FeedPostCard;
