"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/components/ToastProvider";
import { copyText } from "@/lib/clipboard";
import {
  buildPostTree,
  FEED_TOPICS,
  rankFeedPosts,
  topicMeta,
  type FeedLike,
  type FeedPost,
  type FeedPostNode,
  type FeedSort,
} from "@/lib/feed";
import { fetchFeedPage, fetchLikes } from "@/lib/feedApi";
import { HAPTIC, vibrate } from "@/lib/haptics";
import { requireOnline } from "@/lib/offline";
import { supabase } from "@/lib/supabase/client";
import type { DashboardTopic } from "./types";

const DASHBOARD_FEED_SIZE = 12;

function likeMaps(rows: FeedPost[], likes: FeedLike[], myId: string) {
  const counts: Record<string, number> = {};
  const mine: Record<string, boolean> = {};
  const authoritative = new Set<string>();

  for (const row of rows) {
    if (typeof row.like_count === "number") {
      counts[row.id] = row.like_count;
      authoritative.add(row.id);
    }
    if (row.viewer_liked) mine[row.id] = true;
  }
  for (const like of likes) {
    if (!authoritative.has(like.post_id)) {
      counts[like.post_id] = (counts[like.post_id] ?? 0) + 1;
    }
    if (like.user_id === myId) mine[like.post_id] = true;
  }
  return { counts, mine };
}

export function useDashboardFeed(myId: string) {
  const { showToast } = useToast();
  const [sort, setSort] = useState<FeedSort>("for_you");
  const [posts, setPosts] = useState<FeedPostNode[]>([]);
  const [likeCount, setLikeCount] = useState<Record<string, number>>({});
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const requestVersion = useRef(0);
  const likedRef = useRef(liked);

  useEffect(() => {
    likedRef.current = liked;
  }, [liked]);

  const load = useCallback(async (quiet = false) => {
    const version = ++requestVersion.current;
    if (!quiet) setLoading(true);
    else setRefreshing(true);

    try {
      const response = await fetchFeedPage({ sort, topic: null, search: "" }, 0, DASHBOARD_FEED_SIZE);
      if (version !== requestVersion.current) return;

      let roots: FeedPostNode[];
      if (response.mode === "rpc") {
        roots = response.rows
          .filter((post) => !post.parent_post_id)
          .map((post) => ({ ...post, children: [] }));
        const maps = likeMaps(response.rows, [], myId);
        setLikeCount(maps.counts);
        setLiked(maps.mine);
      } else {
        const likes = await fetchLikes(response.rows.map((post) => post.id));
        if (version !== requestVersion.current) return;
        const likesByPost = likes.reduce<Record<string, FeedLike[]>>((all, like) => {
          (all[like.post_id] ||= []).push(like);
          return all;
        }, {});
        roots = rankFeedPosts(buildPostTree(response.rows), sort, { likesByPost, myId });
        const maps = likeMaps(response.rows, likes, myId);
        setLikeCount(maps.counts);
        setLiked(maps.mine);
      }
      setPosts(roots.slice(0, DASHBOARD_FEED_SIZE));
    } catch (error) {
      console.warn("Dashboard community feed failed:", error);
      if (!quiet) showToast("The community feed couldn't load. Please try again.");
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [myId, showToast, sort]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const toggleLike = useCallback(async (postId: string) => {
    if (!myId || !requireOnline(showToast, "Liking a whisper")) return;

    const wasLiked = Boolean(likedRef.current[postId]);
    const nextLiked = { ...likedRef.current, [postId]: !wasLiked };
    likedRef.current = nextLiked;
    setLiked(nextLiked);
    setLikeCount((current) => ({
      ...current,
      [postId]: Math.max(0, (current[postId] ?? 0) + (wasLiked ? -1 : 1)),
    }));
    vibrate(HAPTIC.tap);

    const result = wasLiked
      ? await supabase.from("public_feed_likes").delete().eq("post_id", postId).eq("user_id", myId)
      : await supabase.from("public_feed_likes").insert({ post_id: postId, user_id: myId });

    if (!result.error) return;

    likedRef.current = { ...likedRef.current, [postId]: wasLiked };
    setLiked(likedRef.current);
    setLikeCount((current) => ({
      ...current,
      [postId]: Math.max(0, (current[postId] ?? 0) + (wasLiked ? 1 : -1)),
    }));
    showToast("That like didn't go through. Please try again.");
  }, [myId, showToast]);

  const sharePost = useCallback(async (post: FeedPost) => {
    const url = `${window.location.origin}/public-feed?post=${post.id}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Whisper", text: post.body, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    const copied = await copyText(url);
    showToast(copied ? "Whisper link copied" : "Couldn't copy that Whisper link.", copied ? { variant: "subtle" } : undefined);
  }, [showToast]);

  const topics = useMemo<DashboardTopic[]>(() => {
    const activity = new Map<string, number>();
    for (const post of posts) {
      if (!post.topic) continue;
      const engagement = 1 + (likeCount[post.id] ?? post.like_count ?? 0) + (post.reply_count ?? 0);
      activity.set(post.topic, (activity.get(post.topic) ?? 0) + engagement);
    }
    return [...activity.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, value]) => {
        const meta = topicMeta(key) ?? FEED_TOPICS.find((entry) => entry.key === key);
        return { key, label: meta?.label ?? key, emoji: meta?.emoji ?? "✦", activity: value };
      });
  }, [posts, likeCount]);

  return {
    sort,
    setSort,
    posts,
    likeCount,
    liked,
    loading,
    refreshing,
    refresh: () => load(true),
    toggleLike,
    sharePost,
    topics,
  };
}

export type DashboardFeedController = ReturnType<typeof useDashboardFeed>;
