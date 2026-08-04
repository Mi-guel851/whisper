"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BarChart3, Heart, MessageCircle, Send, Sparkles, Trash2 } from "lucide-react";
import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";
import ConfirmDialog from "@/components/ConfirmDialog";
import { supabase } from "@/lib/supabase/client";
import { generatedAvatarUrl } from "@/lib/generatedAvatar";
import { anonymousDisplayName } from "@/lib/anonymousIdentity";
import { useToast } from "@/components/ToastProvider";

type FeedPost = {
  id: string;
  author_id: string;
  body: string;
  whisper_link: string;
  created_at: string;
  expires_at: string;
  parent_post_id?: string | null;
  view_count?: number | null;
};
type FeedLike = { post_id: string; user_id: string };
type FeedPostNode = FeedPost & { children: FeedPostNode[] };

const REPLY_COST = 2;

const SUGGESTED_POST = "Hi everyone! I have a little time to talk. Send me an anonymous Whisper and let’s see where the conversation goes.";
const AI_SUGGESTIONS = [
  SUGGESTED_POST,
  "I am in the mood for an honest conversation. Leave me a Whisper and tell me what is on your mind.",
  "Quick question for the community: what is one small thing that made you smile today? Send your answer anonymously.",
  "I am taking anonymous questions today. Ask me anything and I will answer as honestly as I can.",
  "Sometimes a stranger has the best advice. Leave me a Whisper and share something you have learned recently.",
  "Drop a kind message for someone who needs it today. My Whisper link is open for anonymous notes.",
  "I want to hear a story I have never heard before. Send me an anonymous Whisper and surprise me.",
  "No pressure, no names, just a real conversation. Say hello through my Whisper link.",
  "What would you tell your future self today? Leave your answer anonymously on my Whisper.",
  "I am collecting honest opinions. Tell me one thing you think more people should talk about.",
];

function stripLinks(value: string) {
  return value.replace(/(?:https?:\/\/|www\.)\S+/gi, "").replace(/\b[a-z0-9-]+\.(?:com|net|org|app|io|co)\S*/gi, "").replace(/[ \t]{2,}/g, " ").trim();
}

/** Compact relative time, Twitter style: 45s, 12m, 5h, 3d. */
function timeAgo(value: string) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function compactCount(value: number) {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function buildPostTree(postList: FeedPost[]): FeedPostNode[] {
  const newestFirst = [...postList].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const nodes = new Map<string, FeedPostNode>();

  for (const post of newestFirst) {
    nodes.set(post.id, { ...post, children: [] });
  }

  const roots: FeedPostNode[] = [];
  for (const post of newestFirst) {
    const node = nodes.get(post.id);
    if (!node) continue;

    if (post.parent_post_id && nodes.has(post.parent_post_id)) {
      nodes.get(post.parent_post_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Replies read oldest-first, like a comment thread.
  for (const node of nodes.values()) {
    node.children.reverse();
  }

  return roots;
}

/** Total descendants, so a root post can report its whole thread size. */
function countDescendants(node: FeedPostNode): number {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

function upsertPost(current: FeedPost[], incoming: FeedPost) {
  return current.some((item) => item.id === incoming.id)
    ? current.map((item) => (item.id === incoming.id ? incoming : item))
    : [incoming, ...current];
}

export default function PublicFeedPage() {
  const { showToast } = useToast();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [likes, setLikes] = useState<FeedLike[]>([]);
  const [body, setBody] = useState("");
  const [myId, setMyId] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);
  const [replyOpen, setReplyOpen] = useState<Record<string, boolean>>({});
  const [replyTextMap, setReplyTextMap] = useState<Record<string, string>>({});
  const [replySendingMap, setReplySendingMap] = useState<Record<string, boolean>>({});
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});
  const [pendingReply, setPendingReply] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const cleanBody = stripLinks(body);
  const ownLink = username ? `/u/${username}` : "";

  // Impressions are batched: seen ids collect here and flush on a timer so a fast
  // scroll doesn't fire one request per card.
  const pendingImpressions = useRef<Set<string>>(new Set());
  const recordedImpressions = useRef<Set<string>>(new Set());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushImpressions = useCallback(async () => {
    const batch = Array.from(pendingImpressions.current);
    pendingImpressions.current.clear();
    if (!batch.length) return;

    const { error } = await supabase.rpc("record_public_feed_impressions", { post_ids: batch });
    if (error) {
      // Migration may not be applied yet — degrade silently, the counter just stays put.
      console.warn("Impression recording skipped:", error.message);
      return;
    }

    setPosts((current) =>
      current.map((post) =>
        batch.includes(post.id) ? { ...post, view_count: (post.view_count ?? 0) + 1 } : post
      )
    );
  }, []);

  const trackImpression = useCallback((postId: string, authorId: string) => {
    if (!myId || authorId === myId) return;
    if (recordedImpressions.current.has(postId)) return;

    recordedImpressions.current.add(postId);
    pendingImpressions.current.add(postId);

    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => { void flushImpressions(); }, 900);
  }, [myId, flushImpressions]);

  useEffect(() => {
    return () => { if (flushTimer.current) clearTimeout(flushTimer.current); };
  }, []);

  // A single observer for every root card. Cards register through the ref callback
  // below; once a card has been counted it is unobserved so it can't fire twice.
  const observer = useRef<IntersectionObserver | null>(null);
  const observedNodes = useRef<Set<HTMLElement>>(new Set());
  const trackRef = useRef(trackImpression);

  useEffect(() => { trackRef.current = trackImpression; }, [trackImpression]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const instance = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const node = entry.target as HTMLElement;
          const { postId, authorId } = node.dataset;
          if (postId && authorId) {
            trackRef.current(postId, authorId);
            instance.unobserve(node);
            observedNodes.current.delete(node);
          }
        }
      },
      { threshold: 0.5 }
    );

    observer.current = instance;
    // Cards mounted before this effect ran still need picking up.
    observedNodes.current.forEach((node) => instance.observe(node));

    return () => { instance.disconnect(); observer.current = null; };
  }, []);

  const impressionRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    observedNodes.current.add(node);
    observer.current?.observe(node);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }

      const uid = session.user.id;
      setMyId(uid);

      const { data: profile } = await supabase.from("profiles").select("username").eq("id", uid).single();

      // Try fetching posts including parent_post_id and view_count. If either column
      // doesn't exist yet, fall back to the original selector.
      let postRows: FeedPost[] | null = null;
      try {
        const { data: rows, error: fetchError } = await supabase
          .from("public_feed_posts")
          .select("id,author_id,body,whisper_link,created_at,expires_at,parent_post_id,view_count")
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false });

        if (fetchError) {
          console.warn("Public feed fetch column error, falling back:", fetchError);
          const { data: fallbackRows, error: fallbackError } = await supabase
            .from("public_feed_posts")
            .select("id,author_id,body,whisper_link,created_at,expires_at")
            .gt("expires_at", new Date().toISOString())
            .order("created_at", { ascending: false });
          if (fallbackError) console.error("Public feed fetch fallback error:", fallbackError);
          postRows = (fallbackRows || []) as FeedPost[];
        } else {
          postRows = (rows || []) as FeedPost[];
        }
      } catch (error) {
        console.error("Public feed fetch unexpected error:", error);
        postRows = [];
      }

      if (cancelled) return;

      setUsername(profile?.username || "");
      setPosts(postRows || []);

      const ids = (postRows || []).map((post) => post.id);
      if (ids.length) {
        const { data: likeRows } = await supabase.from("public_feed_likes").select("post_id,user_id").in("post_id", ids);
        if (!cancelled) setLikes((likeRows || []) as FeedLike[]);
      }

      await supabase.from("public_feed_notifications").update({ is_read: true }).eq("user_id", uid).eq("is_read", false);
      setLoading(false);

      channel = supabase
        .channel(`public-feed-${uid}-${Date.now()}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "public_feed_posts" }, (payload) => {
          const post = payload.new as FeedPost;
          if (new Date(post.expires_at) > new Date()) setPosts((current) => upsertPost(current, post));
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "public_feed_posts" }, (payload) =>
          setPosts((current) => current.filter((post) => post.id !== (payload.old as { id: string }).id))
        )
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "public_feed_likes" }, (payload) => {
          const like = payload.new as FeedLike;
          setLikes((current) =>
            current.some((item) => item.post_id === like.post_id && item.user_id === like.user_id) ? current : [...current, like]
          );
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "public_feed_likes" }, (payload) => {
          const like = payload.old as FeedLike;
          setLikes((current) => current.filter((item) => !(item.post_id === like.post_id && item.user_id === like.user_id)));
        })
        .subscribe();
    }

    init();
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, []);

  const likesByPost = useMemo(
    () => likes.reduce<Record<string, FeedLike[]>>((result, like) => { (result[like.post_id] ||= []).push(like); return result; }, {}),
    [likes]
  );
  const postTree = useMemo(() => buildPostTree(posts), [posts]);

  async function createPost(event: React.FormEvent) {
    event.preventDefault();
    if (!myId || !ownLink || !cleanBody || posting) return;

    setPosting(true);
    const { data, error } = await supabase
      .from("public_feed_posts")
      .insert({ author_id: myId, body: cleanBody, whisper_link: ownLink })
      .select("id,author_id,body,whisper_link,created_at,expires_at,parent_post_id,view_count")
      .single();

    if (error) showToast(error.message);
    else if (data) {
      setPosts((current) => upsertPost(current, data as FeedPost));
      setBody("");
      showToast("Posted to Public Feed.");
    }
    setPosting(false);
  }

  async function toggleLike(postId: string) {
    if (!myId) return;

    const liked = (likesByPost[postId] || []).some((like) => like.user_id === myId);
    setLikes((current) =>
      liked
        ? current.filter((like) => !(like.post_id === postId && like.user_id === myId))
        : [...current, { post_id: postId, user_id: myId }]
    );

    const result = liked
      ? await supabase.from("public_feed_likes").delete().eq("post_id", postId).eq("user_id", myId)
      : await supabase.from("public_feed_likes").insert({ post_id: postId, user_id: myId });

    if (result.error) showToast(result.error.message);
  }

  async function deletePost(postId: string) {
    const { error } = await supabase.from("public_feed_posts").delete().eq("id", postId).eq("author_id", myId);
    if (error) showToast(error.message);
    else setPosts((current) => current.filter((post) => post.id !== postId));
    setDeleteTarget(null);
  }

  async function sendReply(postId: string) {
    const text = (replyTextMap[postId] || "").trim();
    if (!text) { showToast("Write a reply first"); return; }

    setReplySendingMap((map) => ({ ...map, [postId]: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast("Login required"); return; }

      const res = await fetch("/api/coins/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ message: text, postId }),
      });
      const json = await res.json();

      if (!res.ok) {
        showToast(json.error || "Failed to send reply");
      } else {
        showToast(`Reply posted publicly — ${REPLY_COST} coins charged`);
        if (json.post) setPosts((current) => upsertPost(current, json.post as FeedPost));
        setReplyTextMap((map) => ({ ...map, [postId]: "" }));
        setReplyOpen((map) => ({ ...map, [postId]: false }));
        // Make sure the new comment is visible even on a long thread.
        setExpandedThreads((map) => ({ ...map, [postId]: true }));
      }
    } catch (error) {
      console.error(error);
      showToast("Network error");
    } finally {
      setReplySendingMap((map) => ({ ...map, [postId]: false }));
    }
  }

  function toggleReplyBox(postId: string) {
    setReplyOpen((map) => ({ ...map, [postId]: !map[postId] }));
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center theme-bg-gradient text-white">
        <p className="text-gray-400">Loading feed...</p>
      </main>
    );
  }

  /**
   * The inline composer shared by root posts and comments. Deliberately a render
   * helper rather than a nested component — a nested component would be a new type
   * on every render, remounting the textarea and losing focus on each keystroke.
   */
  function renderReplyComposer(postId: string, compact: boolean) {
    const sending = Boolean(replySendingMap[postId]);
    return (
      <div className={compact ? "mt-2 flex items-end gap-2" : "mt-3 flex items-end gap-2"}>
        <textarea
          value={replyTextMap[postId] || ""}
          onChange={(event) => setReplyTextMap((map) => ({ ...map, [postId]: event.target.value }))}
          placeholder={`Write a reply (${REPLY_COST} coins)`}
          rows={1}
          className="min-h-[38px] flex-1 resize-none rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-[13px] text-white outline-none placeholder:text-gray-500 focus:border-cyan-300/40"
        />
        <button
          type="button"
          onClick={() => setPendingReply(postId)}
          disabled={sending || !(replyTextMap[postId] || "").trim()}
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 to-purple-500 text-white disabled:opacity-40"
          aria-label={`Send reply (${REPLY_COST} coins)`}
        >
          <Send size={15} />
        </button>
      </div>
    );
  }

  /** Compact Facebook/Instagram-style comment, nestable to any depth. */
  function renderComment(node: FeedPostNode, depth: number) {
    const commentLikes = likesByPost[node.id] || [];
    const liked = commentLikes.some((like) => like.user_id === myId);
    const childCount = node.children.length;
    const expanded = Boolean(expandedThreads[node.id]);
    // Show a couple of nested answers inline; the rest hide behind a "view more" link.
    const visibleChildren = expanded ? node.children : node.children.slice(0, 1);

    return (
      <div key={node.id} className="flex gap-2">
        <img
          src={generatedAvatarUrl(node.author_id)}
          alt=""
          className="h-7 w-7 shrink-0 rounded-full border border-white/15 bg-white/10 object-cover"
        />

        <div className="min-w-0 flex-1">
          <div className="inline-block max-w-full rounded-2xl bg-white/[0.07] px-3 py-2">
            <p className="truncate text-[12px] font-bold text-gray-200">{anonymousDisplayName(node.author_id)}</p>
            <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-gray-300">{node.body}</p>
          </div>

          <div className="mt-1 flex items-center gap-3 pl-3 text-[11px] font-semibold text-gray-500">
            <span className="font-normal">{timeAgo(node.created_at)}</span>
            <button
              type="button"
              onClick={() => toggleLike(node.id)}
              className={liked ? "text-rose-400" : "hover:text-gray-300"}
            >
              Like{commentLikes.length > 0 ? ` ${compactCount(commentLikes.length)}` : ""}
            </button>
            <button type="button" onClick={() => toggleReplyBox(node.id)} className="hover:text-gray-300">
              Reply
            </button>
            {node.author_id === myId && (
              <button type="button" onClick={() => setDeleteTarget(node.id)} className="hover:text-rose-400">
                Delete
              </button>
            )}
          </div>

          {replyOpen[node.id] && renderReplyComposer(node.id, true)}

          {childCount > 0 && (
            // Indent stops growing after a few levels so deep threads stay readable on phones.
            <div className={`mt-3 space-y-3 ${depth < 3 ? "border-l border-white/10 pl-3" : ""}`}>
              {visibleChildren.map((child) => renderComment(child, depth + 1))}

              {!expanded && childCount > 1 && (
                <button
                  type="button"
                  onClick={() => setExpandedThreads((map) => ({ ...map, [node.id]: true }))}
                  className="text-[11px] font-semibold text-gray-500 hover:text-gray-300"
                >
                  View {compactCount(childCount - 1)} more {childCount - 1 === 1 ? "reply" : "replies"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  /** Root post: Twitter-style card with an impressions/engagements row. */
  function renderPost(node: FeedPostNode) {
    const postLikes = likesByPost[node.id] || [];
    const liked = postLikes.some((like) => like.user_id === myId);
    const replyCount = countDescendants(node);
    const impressions = node.view_count ?? 0;
    const engagements = postLikes.length + replyCount;
    const threadExpanded = Boolean(expandedThreads[node.id]);
    const visibleComments = threadExpanded ? node.children : node.children.slice(0, 2);

    return (
      <GlassPanel key={node.id} className="rounded-3xl p-4">
        <article ref={impressionRef} data-post-id={node.id} data-author-id={node.author_id} className="flex gap-3">
          <img
            src={generatedAvatarUrl(node.author_id)}
            alt=""
            className="h-10 w-10 shrink-0 rounded-full border border-white/15 bg-white/10 object-cover"
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="truncate font-bold text-white">{anonymousDisplayName(node.author_id)}</span>
              <span className="text-gray-600">·</span>
              <span className="shrink-0 text-gray-500">{timeAgo(node.created_at)}</span>
              {node.author_id === myId && (
                <button
                  type="button"
                  onClick={() => setDeleteTarget(node.id)}
                  className="ml-auto shrink-0 rounded-full p-1.5 text-gray-500 hover:bg-rose-500/10 hover:text-rose-400"
                  aria-label="Delete post"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>

            <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6 text-gray-200">{node.body}</p>

            <Link
              href={node.whisper_link || "/"}
              className="mt-3 block truncate rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-[13px] font-semibold text-cyan-200 hover:bg-cyan-300/20"
            >
              Send me an anonymous Whisper
            </Link>

            <div className="mt-3 flex items-center justify-between gap-2 text-gray-500">
              <button
                type="button"
                onClick={() => toggleReplyBox(node.id)}
                className="group flex items-center gap-1.5 text-[13px] transition hover:text-cyan-300"
              >
                <span className="rounded-full p-1.5 transition group-hover:bg-cyan-400/10">
                  <MessageCircle size={16} />
                </span>
                {replyCount > 0 && compactCount(replyCount)}
              </button>

              <button
                type="button"
                onClick={() => toggleLike(node.id)}
                className={`group flex items-center gap-1.5 text-[13px] transition hover:text-rose-400 ${liked ? "text-rose-400" : ""}`}
              >
                <span className="rounded-full p-1.5 transition group-hover:bg-rose-500/10">
                  <Heart size={16} fill={liked ? "currentColor" : "none"} />
                </span>
                {postLikes.length > 0 && compactCount(postLikes.length)}
              </button>

              <span className="flex items-center gap-1.5 text-[13px]" title={`${impressions} impressions`}>
                <span className="p-1.5">
                  <BarChart3 size={16} />
                </span>
                {compactCount(impressions)}
              </span>

              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                {compactCount(engagements)} engagements
              </span>
            </div>

            {replyOpen[node.id] && renderReplyComposer(node.id, false)}

            {node.children.length > 0 && (
              <div className="mt-4 space-y-3 border-t border-white/10 pt-3">
                {visibleComments.map((child) => renderComment(child, 1))}

                {!threadExpanded && node.children.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setExpandedThreads((map) => ({ ...map, [node.id]: true }))}
                    className="text-[12px] font-semibold text-gray-500 hover:text-gray-300"
                  >
                    View all {compactCount(replyCount)} replies
                  </button>
                )}
              </div>
            )}
          </div>
        </article>
      </GlassPanel>
    );
  }

  return (
    <main className="min-h-screen theme-bg-gradient px-4 pb-28 pt-10 text-white">
      <div className="mx-auto max-w-xl">
        <BackButton />

        <div className="mb-7 mt-5">
          <h1 className="page-title">Public Feed</h1>
          <p className="page-subtitle mt-1">Real thoughts from the Whisper community.</p>
        </div>

        <GlassPanel strong className="mb-7 rounded-3xl p-5">
          <form onSubmit={createPost}>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Share a thought with the Whisper community..."
              className="w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
            />

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setBody(SUGGESTED_POST)}
                className="glass-control min-w-0 flex-1 rounded-2xl px-3 py-2 text-left text-xs text-cyan-100 transition"
              >
                <span className="font-bold text-cyan-300">Suggestion:</span> {SUGGESTED_POST}
              </button>
              <button
                type="button"
                onClick={() => setShowAiSuggestions((visible) => !visible)}
                className="glass-control flex shrink-0 items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-bold text-fuchsia-200 transition"
                aria-expanded={showAiSuggestions}
              >
                <Sparkles size={14} /> AI Write
              </button>
            </div>

            {showAiSuggestions && (
              <div className="glass-control mt-3 grid gap-2 rounded-2xl p-2">
                {AI_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => { setBody(suggestion); setShowAiSuggestions(false); }}
                    className="glass-control rounded-xl px-3 py-2 text-left text-xs leading-5 text-gray-200 transition hover:text-white"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
              <div className="min-w-0 text-xs text-gray-400">
                <span className="block">Your Whisper link will be attached automatically.</span>
                {ownLink && <Link href={ownLink} className="truncate text-cyan-300">whisper.app{ownLink}</Link>}
              </div>
              <button
                type="submit"
                disabled={!cleanBody || posting || !ownLink}
                className="glass-control flex shrink-0 items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-purple-500 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"
              >
                <Send size={15} />
                {posting ? "Posting" : "Post"}
              </button>
            </div>
          </form>
        </GlassPanel>

        <div className="space-y-4">
          {posts.length === 0 ? (
            <GlassPanel className="rounded-3xl p-10 text-center text-gray-400">No posts yet. Start the conversation.</GlassPanel>
          ) : (
            postTree.map((post) => renderPost(post))
          )}
        </div>
      </div>

      {pendingReply && (
        <ConfirmDialog
          title={`Reply for ${REPLY_COST} coins?`}
          description={`Posting this reply to the public feed costs ${REPLY_COST} Whisper coins.`}
          confirmLabel={`Reply (${REPLY_COST} coins)`}
          loading={Boolean(replySendingMap[pendingReply])}
          onCancel={() => setPendingReply(null)}
          onConfirm={() => {
            const target = pendingReply;
            setPendingReply(null);
            if (target) void sendReply(target);
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this post?"
          description="It will disappear from the public feed along with every reply under it."
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => { void deletePost(deleteTarget); }}
        />
      )}

      <BottomNavigation />
    </main>
  );
}
