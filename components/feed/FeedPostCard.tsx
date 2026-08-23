"use client";

import { memo } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useAnonNames } from "@/lib/anonNames";
import {
  compactCount,
  countDescendants,
  timeAgo,
  topicMeta,
  type FeedPostNode,
} from "@/lib/feed";
import FeedAvatar from "./FeedAvatar";
import FeedActionBar from "./FeedActionBar";
import FeedReplyComposer from "./FeedReplyComposer";
import FeedImageWhisper from "./FeedImageWhisper";
import FeedPoll from "./FeedPoll";
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
 *
 * Threads start closed. The reply count beside the reply icon is the
 * affordance, and tapping it opens the whole conversation — every reply and
 * everything under them — rather than a two-line preview with a second
 * "show more" control behind it. A feed of root posts is scannable; a feed
 * where every post has already unpacked its replies is not.
 *
 * WHERE THE REPLY COUNT COMES FROM
 *
 * Two sources, and which one is right depends on whether the thread is loaded.
 * On the RPC path a root post arrives with `reply_count` and no children at all
 * — its replies are one `public_feed_thread` call away — so the server count is
 * the only count there is. Once those children are in hand, `countDescendants`
 * becomes the more current number: it sees the optimistic reply that was added a
 * frame ago and the server count does not. Hence the switch on `children.length`
 * rather than a `Math.max`, which would keep showing a stale server total after
 * a reply is deleted.
 */

const AVATAR_ROOT = 42;
const AVATAR_REPLY = 34;

type FeedPostCardProps = {
  node: FeedPostNode;
  controller: FeedController;
  depth: number;
  /** Author of the post being answered — renders X's "Replying to" line. */
  parentAuthorId?: string;
  /** Ref callback that registers a root card for impression counting. */
  impressionRef?: (node: HTMLElement | null) => void;
  /**
   * An ancestor is open, so this post's replies come with it. Opening a thread
   * is one action: it would be tedious to expand every level by hand just to
   * read a conversation the user already asked to see.
   */
  threadOpen?: boolean;
  /**
   * The post a `?post=` share link pointed at, pulsed so the reader can find it.
   *
   * Threaded through the recursion rather than resolved to a boolean by the page,
   * because a shared link routinely points at a *reply* — and a page that can only
   * mark roots would scroll to the right post and then highlight nothing.
   */
  highlightId?: string | null;
};

function FeedPostCardBase({
  node,
  controller,
  depth,
  parentAuthorId,
  impressionRef,
  threadOpen = false,
  highlightId = null,
}: FeedPostCardProps) {
  const isRoot = depth === 0;
  const highlighted = highlightId === node.id;
  const isMine = node.author_id === controller.myId;
  /* Two ids per card, but requests inside the same commit coalesce into one
     query — so a whole thread costs one round trip, not one per post. */
  const nameOf = useAnonNames([node.author_id, parentAuthorId]);

  const likeCount = controller.likeCount[node.id] ?? node.like_count ?? 0;
  const liked = controller.liked[node.id] ?? node.viewer_liked ?? false;

  const children = node.children;
  const replyCount = children.length > 0 ? countDescendants(node) : node.reply_count ?? 0;
  const isReplyOpen = Boolean(controller.replyOpen[node.id]);
  const isExpanded = threadOpen || Boolean(controller.expanded[node.id]);
  const isThreadLoading = Boolean(controller.threadLoading[node.id]);
  const visibleChildren = isExpanded ? children : [];

  const topic = isRoot ? topicMeta(node.topic) : null;

  const pollOptions = node.poll_options;
  const pollCounts = controller.pollCounts[node.id] ?? node.poll_counts ?? [];
  const pollChoice = controller.pollChoice[node.id] ?? node.viewer_vote ?? null;

  const imageState =
    controller.imageState[node.id] ?? (node.viewer_image_viewed ? "spent" : "locked");

  /* The rail is drawn whenever something renders below this post in the same
     column — a reply, the composer that will become one, or the spinner that
     precedes them. */
  const hasRail = visibleChildren.length > 0 || isReplyOpen || isThreadLoading;

  return (
    <article
      ref={isRoot ? impressionRef : undefined}
      data-post-id={node.id}
      data-author-id={node.author_id}
      className={`${isRoot ? "feed-post" : "feed-post feed-post-reply"}${
        highlighted ? " is-highlighted" : ""
      }`}
    >
      <div className="flex gap-3">
        <div className="relative flex shrink-0 flex-col items-center">
          <FeedAvatar authorId={node.author_id} size={isRoot ? AVATAR_ROOT : AVATAR_REPLY} />
          {hasRail && <span aria-hidden className="feed-thread-rail" />}
        </div>

        <div className="min-w-0 flex-1 pb-0.5">
          <div className="feed-post-head">
            <span className="feed-author truncate font-black">
              {nameOf(node.author_id)}
            </span>
            <span className="feed-dot shrink-0" aria-hidden>·</span>
            <time
              dateTime={node.created_at}
              title={new Date(node.created_at).toLocaleString()}
              className="feed-time shrink-0 text-[13px] font-medium"
            >
              {timeAgo(node.created_at)}
            </time>
            {topic && (
              <span className="feed-topic-tag">
                <span aria-hidden>{topic.emoji}</span>
                {topic.label}
              </span>
            )}
          </div>

          {/* X's orientation line for a reply that's been lifted out of its
              parent's immediate context. Only shown past the first level,
              where the rail alone no longer says who is being answered. */}
          {parentAuthorId && depth > 1 && (
            <p className="feed-replying-to mt-0.5 truncate text-[13px]">
              Replying to{" "}
              <span className="feed-replying-to-name font-bold">
                {nameOf(parentAuthorId)}
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

          {node.has_image && (
            <FeedImageWhisper
              preview={node.image_preview ?? null}
              state={imageState}
              isAuthor={isMine}
              onOpen={() => controller.onOpenImage(node.id)}
            />
          )}

          {pollOptions && pollOptions.length >= 2 && (
            <FeedPoll
              options={pollOptions}
              counts={pollCounts}
              choice={pollChoice}
              pending={Boolean(controller.pollPending[node.id])}
              onVote={(optionIndex) => controller.onVote(node.id, optionIndex)}
              reducedMotion={controller.reducedMotion}
            />
          )}

          {/* Only root posts carry the author's Whisper link. Repeating it on
              every reply would turn a thread into a wall of identical CTAs. */}
          {isRoot && node.whisper_link && (
            <Link href={node.whisper_link} className="feed-cta mt-2.5 block truncate">
              Send me an anonymous Whisper
            </Link>
          )}

          <FeedActionBar
            replyCount={replyCount}
            likeCount={likeCount}
            viewCount={node.view_count ?? 0}
            liked={liked}
            replyOpen={isReplyOpen}
            threadOpen={isExpanded}
            onReply={() => controller.onToggleReplyBox(node.id)}
            onToggleThread={
              /* Gated on the count rather than on loaded children: on the RPC
                 path a post with replies has none of them in hand yet, and
                 gating on `children.length` would make its thread unopenable.
                 Never offered on a post whose thread was opened from above —
                 collapsing a branch inside an open conversation would strand
                 the rail. */
              replyCount > 0 && !threadOpen
                ? () => controller.onToggleThread(node.id)
                : undefined
            }
            onLike={() => controller.onToggleLike(node.id)}
            onShare={() => controller.onShare(node)}
            onMore={() => controller.onOpenMenu(node)}
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

      {/* Fetching a thread is a round trip, and on a slow connection the tap
          would otherwise look ignored. */}
      {isThreadLoading && visibleChildren.length === 0 && (
        <div className="feed-thread-loading">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          Loading {replyCount === 1 ? "reply" : "replies"}
        </div>
      )}

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
              highlightId={highlightId}
              threadOpen
            />
          ))}

          {/* Closing from the bottom of a long thread saves scrolling back up
              to the reply icon that opened it. */}
          {!threadOpen && (
            <button
              type="button"
              onClick={() => controller.onToggleThread(node.id)}
              className="feed-show-more"
            >
              Hide {compactCount(replyCount)}{" "}
              {replyCount === 1 ? "reply" : "replies"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export const FeedPostCard = memo(FeedPostCardBase);
export default FeedPostCard;
