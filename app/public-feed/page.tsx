"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Heart, Send, Sparkles, Trash2 } from "lucide-react";
import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";
import { supabase } from "@/lib/supabase/client";
import { generatedAvatarUrl } from "@/lib/generatedAvatar";
import { anonymousDisplayName } from "@/lib/anonymousIdentity";
import { useToast } from "@/components/ToastProvider";

type FeedPost = { id: string; author_id: string; body: string; whisper_link: string; created_at: string; expires_at: string };
type FeedLike = { post_id: string; user_id: string };

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

function timeAgo(value: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
  const cleanBody = stripLinks(body);
  const ownLink = username ? `/u/${username}` : "";

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }
      const uid = session.user.id;
      setMyId(uid);
      const [{ data: profile }, { data: postRows, error }] = await Promise.all([
        supabase.from("profiles").select("username").eq("id", uid).single(),
        supabase.from("public_feed_posts").select("id,author_id,body,whisper_link,created_at,expires_at").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }),
      ]);
      if (error) console.error("Public feed fetch error:", error);
      if (cancelled) return;
      setUsername(profile?.username || "");
      setPosts((postRows || []) as FeedPost[]);
      const ids = (postRows || []).map((post) => post.id);
      if (ids.length) {
        const { data: likeRows } = await supabase.from("public_feed_likes").select("post_id,user_id").in("post_id", ids);
        if (!cancelled) setLikes((likeRows || []) as FeedLike[]);
      }
      await supabase.from("public_feed_notifications").update({ is_read: true }).eq("user_id", uid).eq("is_read", false);
      setLoading(false);
      channel = supabase.channel(`public-feed-${uid}-${Date.now()}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "public_feed_posts" }, (payload) => {
          const post = payload.new as FeedPost;
          if (new Date(post.expires_at) > new Date()) setPosts((current) => current.some((item) => item.id === post.id) ? current : [post, ...current]);
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "public_feed_posts" }, (payload) => setPosts((current) => current.filter((post) => post.id !== (payload.old as { id: string }).id)))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "public_feed_likes" }, (payload) => {
          const like = payload.new as FeedLike;
          setLikes((current) => current.some((item) => item.post_id === like.post_id && item.user_id === like.user_id) ? current : [...current, like]);
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "public_feed_likes" }, (payload) => {
          const like = payload.old as FeedLike;
          setLikes((current) => current.filter((item) => !(item.post_id === like.post_id && item.user_id === like.user_id)));
        }).subscribe();
    }
    init();
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, []);

  const likesByPost = useMemo(() => likes.reduce<Record<string, FeedLike[]>>((result, like) => { (result[like.post_id] ||= []).push(like); return result; }, {}), [likes]);

  async function createPost(event: React.FormEvent) {
    event.preventDefault();
    if (!myId || !ownLink || !cleanBody || posting) return;
    setPosting(true);
    const { data, error } = await supabase.from("public_feed_posts").insert({ author_id: myId, body: cleanBody, whisper_link: ownLink }).select("id,author_id,body,whisper_link,created_at,expires_at").single();
    if (error) showToast(error.message);
    else if (data) { setPosts((current) => [data as FeedPost, ...current]); setBody(""); showToast("Posted to Public Feed."); }
    setPosting(false);
  }

  async function toggleLike(postId: string) {
    if (!myId) return;
    const liked = (likesByPost[postId] || []).some((like) => like.user_id === myId);
    setLikes((current) => liked ? current.filter((like) => !(like.post_id === postId && like.user_id === myId)) : [...current, { post_id: postId, user_id: myId }]);
    const result = liked ? await supabase.from("public_feed_likes").delete().eq("post_id", postId).eq("user_id", myId) : await supabase.from("public_feed_likes").insert({ post_id: postId, user_id: myId });
    if (result.error) showToast(result.error.message);
  }

  async function deletePost(postId: string) {
    const { error } = await supabase.from("public_feed_posts").delete().eq("id", postId).eq("author_id", myId);
    if (error) showToast(error.message); else setPosts((current) => current.filter((post) => post.id !== postId));
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center theme-bg-gradient text-white"><p className="text-gray-400">Loading feed...</p></main>;
  return (
    <main className="min-h-screen theme-bg-gradient px-4 pb-28 pt-10 text-white"><div className="mx-auto max-w-xl"><BackButton /><div className="mb-7 mt-5"><h1 className="text-4xl font-black">Public Feed</h1><p className="mt-1 text-sm text-gray-400">Real thoughts from the Whisper community.</p></div>
      <GlassPanel strong className="mb-7 rounded-3xl p-5"><form onSubmit={createPost}><textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={500} rows={3} placeholder="Share a thought with the Whisper community..." className="w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-gray-500" /><div className="mt-3 flex gap-2"><button type="button" onClick={() => setBody(SUGGESTED_POST)} className="glass-control min-w-0 flex-1 rounded-2xl px-3 py-2 text-left text-xs text-cyan-100 transition"><span className="font-bold text-cyan-300">Suggestion:</span> {SUGGESTED_POST}</button><button type="button" onClick={() => setShowAiSuggestions((visible) => !visible)} className="glass-control flex shrink-0 items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-bold text-fuchsia-200 transition" aria-expanded={showAiSuggestions}><Sparkles size={14} /> AI Write</button></div>{showAiSuggestions && <div className="glass-control mt-3 grid gap-2 rounded-2xl p-2">{AI_SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" onClick={() => { setBody(suggestion); setShowAiSuggestions(false); }} className="glass-control rounded-xl px-3 py-2 text-left text-xs leading-5 text-gray-200 transition hover:text-white">{suggestion}</button>)}</div>}<div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3"><div className="min-w-0 text-xs text-gray-400"><span className="block">Your Whisper link will be attached automatically.</span>{ownLink && <Link href={ownLink} className="truncate text-cyan-300">whisper.app{ownLink}</Link>}</div><button type="submit" disabled={!cleanBody || posting || !ownLink} className="glass-control flex shrink-0 items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-purple-500 px-4 py-2.5 text-sm font-black text-black disabled:opacity-50"><Send size={15} />{posting ? "Posting" : "Post"}</button></div></form></GlassPanel>
      <div className="space-y-4">{posts.length === 0 ? <GlassPanel className="rounded-3xl p-10 text-center text-gray-400">No posts yet. Start the conversation.</GlassPanel> : posts.map((post) => { const postLikes = likesByPost[post.id] || []; const liked = postLikes.some((like) => like.user_id === myId); return <GlassPanel key={post.id} className="rounded-3xl p-5"><div className="flex items-center gap-3"><img src={generatedAvatarUrl(post.author_id)} alt="" className="h-11 w-11 rounded-full border border-white/15 bg-white/10 object-cover p-0.5" /><div className="min-w-0 flex-1"><p className="truncate font-bold">{anonymousDisplayName(post.author_id)}</p><p className="text-xs text-gray-500">{timeAgo(post.created_at)} · expires in 30 days</p></div>{post.author_id === myId && <button type="button" onClick={() => deletePost(post.id)} className="rounded-full p-2 text-gray-500 hover:bg-rose-500/10 hover:text-rose-400" aria-label="Delete post"><Trash2 size={16} /></button>}</div><p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-gray-200">{post.body}</p><Link href={post.whisper_link} className="mt-4 block truncate rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm font-semibold text-cyan-200 hover:bg-cyan-300/20">Send me an anonymous Whisper</Link><div className="mt-4 flex items-center gap-3 border-t border-white/10 pt-3"><button type="button" onClick={() => toggleLike(post.id)} className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${liked ? "bg-rose-500/15 text-rose-300" : "text-gray-400 hover:bg-white/10 hover:text-rose-300"}`}><Heart size={16} fill={liked ? "currentColor" : "none"} />{postLikes.length}</button><span className="text-xs text-gray-500">Likes update live</span></div></GlassPanel>; })}</div>
    </div><BottomNavigation /></main>
  );
}