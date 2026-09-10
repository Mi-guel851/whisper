"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Heart,
  Image as ImageIcon,
  MessageCircle,
  RefreshCw,
  Share2,
} from "lucide-react";

import FeedAvatar from "@/components/feed/FeedAvatar";
import OfficialBadge from "@/components/feed/OfficialBadge";
import { useAnonNames } from "@/lib/anonNames";
import { isCreatorPost, OFFICIAL_IDENTITY } from "@/lib/creator";
import { compactCount, FEED_SORTS, timeAgo, topicMeta } from "@/lib/feed";
import type { DashboardFeedController } from "./useDashboardFeed";

function Metric({ icon, value, label }: { icon: React.ReactNode; value: number | null | undefined; label: string }) {
  return (
    <span className="dashboard-feed-metric" aria-label={value == null ? `${label} unavailable` : `${value} ${label}`}>
      {icon}<span>{value == null ? "—" : compactCount(value)}</span>
    </span>
  );
}

export default function PublicFeedPreview({ feed }: { feed: DashboardFeedController }) {
  const visible = feed.posts.slice(0, 2);
  const nameOf = useAnonNames(visible.map((post) => post.author_id));

  return (
    <section className="dashboard-feed-section" aria-labelledby="community-title">
      <div className="dashboard-section-heading">
        <div>
          <h2 id="community-title">Public Whispers</h2>
        </div>
        <div className="dashboard-heading-actions">
          <button
            type="button"
            className="dashboard-refresh-button"
            onClick={feed.refresh}
            disabled={feed.refreshing}
            aria-label="Refresh public whispers"
          >
            <RefreshCw size={16} className={feed.refreshing ? "animate-spin" : ""} />
          </button>
          <Link href={`/public-feed?sort=${feed.sort}`} className="dashboard-view-all">
            View all <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      <div className="dashboard-feed-tabs" role="tablist" aria-label="Sort public whispers">
        {FEED_SORTS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={feed.sort === tab.key}
            className={feed.sort === tab.key ? "is-active" : ""}
            onClick={() => feed.setSort(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="dashboard-feed-list" aria-live="polite" aria-busy={feed.loading}>
        {feed.loading ? (
          Array.from({ length: 2 }).map((_, index) => (
            <div className="dashboard-feed-card dashboard-feed-skeleton" key={index}>
              <i /><div><span /><span /><span /></div>
            </div>
          ))
        ) : visible.length === 0 ? (
          <div className="dashboard-feed-empty">
            <span>◌</span>
            <strong>No public whispers here yet</strong>
            <p>Start an anonymous conversation in the full community feed.</p>
            <Link href="/public-feed">Open Public Feed</Link>
          </div>
        ) : (
          visible.map((post) => {
            const official = isCreatorPost(post);
            const topic = topicMeta(post.topic);
            const replies = post.reply_count ?? post.children.length;
            return (
              <article className="dashboard-feed-card" key={post.id}>
                <header className="dashboard-feed-author">
                  <FeedAvatar authorId={post.author_id} official={official} size={38} />
                  <div className="min-w-0">
                    <div className="dashboard-feed-name">
                      <strong>{official ? OFFICIAL_IDENTITY.name : nameOf(post.author_id)}</strong>
                      {official && <OfficialBadge />}
                    </div>
                    <span>{official ? "Public announcement" : "Anonymous"} · {timeAgo(post.created_at)}</span>
                  </div>
                  {topic && <Link href={`/public-feed?topic=${topic.key}`} className="dashboard-topic-pill">{topic.emoji} {topic.label}</Link>}
                </header>

                <Link href={`/public-feed?post=${post.id}`} className="dashboard-feed-body">
                  <p>{post.body}</p>
                  {(post.has_image || post.poll_options?.length) && (
                    <span className="dashboard-media-note">
                      {post.has_image ? <><ImageIcon size={14} /> Anonymous photo</> : <><BarChart3 size={14} /> Community poll</>}
                    </span>
                  )}
                </Link>

                <footer className="dashboard-feed-actions">
                  <button
                    type="button"
                    onClick={() => feed.toggleLike(post.id)}
                    className={feed.liked[post.id] ? "is-liked" : ""}
                    aria-label={`${feed.liked[post.id] ? "Unlike" : "Like"} this whisper`}
                    aria-pressed={feed.liked[post.id]}
                  >
                    <Heart size={16} fill={feed.liked[post.id] ? "currentColor" : "none"} />
                    <span>{compactCount(feed.likeCount[post.id] ?? post.like_count ?? 0)}</span>
                  </button>
                  <Link href={`/public-feed?post=${post.id}`} aria-label={`${replies} replies; open thread`}>
                    <MessageCircle size={16} /><span>{compactCount(replies)}</span>
                  </Link>
                  <Metric icon={<BarChart3 size={16} />} value={post.view_count} label="views" />
                  <button type="button" onClick={() => feed.sharePost(post)} aria-label="Share this whisper" className="dashboard-feed-share">
                    <Share2 size={16} /><span>Share</span>
                  </button>
                </footer>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
