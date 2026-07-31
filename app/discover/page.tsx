"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Compass,
  UserPlus,
  Users,
  Newspaper,
  Bookmark,
  Pin,
  Lightbulb,
  Shield,
  FileText,
  LifeBuoy,
  ScrollText,
  History,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

import { supabase } from "@/lib/supabase/client";
import { presenceManager } from "@/lib/realtime/presence";
import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";
import { useToast } from "@/components/ToastProvider";
import { anonymousDisplayName as anonymousName } from "@/lib/anonymousIdentity";
import { generatedAvatarUrl } from "@/lib/generatedAvatar";

const PAGE_SIZE = 5;

type ProfileSummary = { id: string };

function AnonymousAvatar({ userId, online = false }: { userId?: string | null; online?: boolean }) {
  return (
    <div className="relative shrink-0">
      <img src={generatedAvatarUrl(userId || "ghost")} alt="" className="h-12 w-12 rounded-full border border-white/15 bg-white/10 object-cover p-0.5 shadow-lg shadow-black/20" loading="lazy" />
      {online && (
        <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#05010F] bg-green-500 shadow-[0_0_0_2px_rgba(0,0,0,0.15)]" />
      )}
    </div>
  );
}

const QUICK_LINKS: { href: string; label: string; icon: LucideIcon; desc: string }[] = [
  { href: "/friends?tab=friends", label: "Friends", icon: Users, desc: "Your friends, requests & active users" },
  { href: "/public-feed", label: "Public Feed", icon: Newspaper, desc: "See what everyone's sharing" },
  { href: "/saved-messages", label: "Saved Messages", icon: Bookmark, desc: "Messages you've saved" },
  { href: "/pinned-messages", label: "Pinned Messages", icon: Pin, desc: "Your pinned favorites" },
  { href: "/activity-log", label: "Activity Log", icon: History, desc: "Your recent activity" },
  { href: "/feedback", label: "Feedback", icon: Lightbulb, desc: "Tell us what you think" },
  { href: "/contact-support", label: "Contact Support", icon: LifeBuoy, desc: "Get help from our team" },
  { href: "/help-center", label: "Help Center", icon: Shield, desc: "Guides & FAQs" },
  { href: "/community-guidelines", label: "Community Guidelines", icon: ScrollText, desc: "How we keep Whisper safe" },
  { href: "/privacy", label: "Privacy Policy", icon: Shield, desc: "How we handle your data" },
  { href: "/terms", label: "Terms of Service", icon: FileText, desc: "The rules of using Whisper" },
];

export default function DiscoverPage() {
  const { showToast } = useToast();
  const [myId, setMyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverPage, setDiscoverPage] = useState(0);
  const [hasMorePeople, setHasMorePeople] = useState(false);
  const [people, setPeople] = useState<ProfileSummary[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);

  const showSupabaseError = useCallback(
    (fallback: string, error: { message?: string } | null | undefined) => {
      const message = error?.message?.trim() || fallback;
      console.error(fallback, error);
      showToast(message);
    },
    [showToast]
  );

  const loadRelatedUserIds = useCallback(
    async (userId: string) => {
      const [friendsRes, requestsRes, blockedRes] = await Promise.all([
        supabase.from("friends").select("friend_id").eq("user_id", userId),
        supabase
          .from("friend_requests")
          .select("sender_id,receiver_id,status")
          .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`),
        supabase
          .from("blocked_users")
          .select("user_id,blocked_user_id")
          .or(`user_id.eq.${userId},blocked_user_id.eq.${userId}`),
      ]);
      if (friendsRes.error) showSupabaseError("Could not load existing friends.", friendsRes.error);
      if (requestsRes.error) showSupabaseError("Could not load related requests.", requestsRes.error);
      if (blockedRes.error) showSupabaseError("Could not load blocked users.", blockedRes.error);

      const friendIds = new Set((friendsRes.data || []).map((f) => f.friend_id as string));
      const pendingIds = new Set<string>();
      for (const r of (requestsRes.data || []) as { sender_id: string; receiver_id: string; status: string }[]) {
        if (r.status !== "pending") continue;
        pendingIds.add(r.sender_id === userId ? r.receiver_id : r.sender_id);
      }
      const blockedUserIds = new Set(
        (blockedRes.data || []).map((row) => (row.user_id === userId ? row.blocked_user_id : row.user_id))
      );
      return { friendIds, pendingIds, blockedUserIds };
    },
    [showSupabaseError]
  );

  const loadPeople = useCallback(
    async (userId: string, page: number) => {
      setDiscoverLoading(true);
      const related = await loadRelatedUserIds(userId);
      const excluded = new Set([userId, ...related.friendIds, ...related.pendingIds, ...related.blockedUserIds]);
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .order("id", { ascending: true })
        .range(0, Math.max((page + 1) * PAGE_SIZE * 4, PAGE_SIZE + 1));
      if (error) {
        showSupabaseError("Could not discover people.", error);
        setDiscoverLoading(false);
        return;
      }
      const visible = ((data || []) as ProfileSummary[]).filter((p) => !excluded.has(p.id));
      setPeople(visible.slice(0, (page + 1) * PAGE_SIZE));
      setHasMorePeople(visible.length > (page + 1) * PAGE_SIZE);
      setDiscoverLoading(false);
    },
    [loadRelatedUserIds, showSupabaseError]
  );

  useEffect(() => {
    let cancelled = false;
    let unsubscribePresence: (() => void) | undefined;

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setLoading(false);
        return;
      }
      setMyId(session.user.id);
      await presenceManager.connect(session.user.id);
      unsubscribePresence = presenceManager.subscribe((users) => {
        if (!cancelled) setOnlineUserIds(users.map((u) => u.id));
      });
      await loadPeople(session.user.id, 0);
      if (cancelled) return;
      setLoading(false);
    }

    init();
    return () => {
      cancelled = true;
      unsubscribePresence?.();
    };
  }, [loadPeople]);

  async function showMorePeople() {
    if (!myId) return;
    const nextPage = discoverPage + 1;
    setDiscoverPage(nextPage);
    await loadPeople(myId, nextPage);
  }

  async function addFriend(profileId: string) {
    if (!myId) {
      showToast("Authentication missing. Please sign in again.");
      return;
    }
    if (profileId === myId) {
      showToast("You cannot send a friend request to yourself.");
      return;
    }
    setBusyId(profileId);
    const { data: existing, error: existingError } = await supabase
      .from("friend_requests")
      .select("id,sender_id,receiver_id,status")
      .or(`and(sender_id.eq.${myId},receiver_id.eq.${profileId}),and(sender_id.eq.${profileId},receiver_id.eq.${myId})`)
      .eq("status", "pending")
      .maybeSingle();
    if (existingError) {
      showSupabaseError("Could not check for an existing request.", existingError);
      setBusyId(null);
      return;
    }
    if (existing) {
      showToast("A friend request already exists between you two.");
      setBusyId(null);
      return;
    }
    const { error } = await supabase
      .from("friend_requests")
      .insert({ sender_id: myId, receiver_id: profileId, status: "pending" });
    if (error) {
      if (error.code === "23505") showToast("A friend request already exists between you two.");
      else showSupabaseError("Friend request failed.", error);
    } else {
      setPeople((prev) => prev.filter((p) => p.id !== profileId));
      showToast("Friend request sent.");
    }
    setBusyId(null);
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center theme-bg-gradient text-white">
        Loading...
      </main>
    );
  }

  return (
    <main className="min-h-screen theme-bg-gradient pb-28 text-white">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <BackButton />

        <div className="mt-4 flex items-center gap-3">
          <Compass className="text-purple-400" size={28} />
          <h1 className="text-3xl font-black">Discover</h1>
        </div>
        <p className="mt-1 text-sm text-gray-400">Find new people and explore Whisper.</p>

        <h2 className="mt-8 mb-3 text-xs font-bold uppercase tracking-widest text-gray-300">
          Find Friends
        </h2>
        <section className="space-y-3">
          {people.length === 0 ? (
            <GlassPanel className="rounded-3xl p-8 text-center text-gray-400">
              No people to discover right now.
            </GlassPanel>
          ) : (
            people.map((profile) => (
              <GlassPanel key={profile.id} className="flex items-center gap-4 rounded-2xl p-4">
                <AnonymousAvatar userId={profile.id} online={onlineUserIds.includes(profile.id)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{anonymousName(profile.id)}</p>
                  <p className="text-xs">
                    {onlineUserIds.includes(profile.id) ? (
                      <span className="font-semibold text-green-400">● Active now</span>
                    ) : (
                      <span className="text-gray-400">Anonymous Whisper user</span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => addFriend(profile.id)}
                  disabled={busyId === profile.id}
                  className="rounded-xl bg-purple-500 px-3 py-2 text-xs font-black text-[#05010F] disabled:opacity-60"
                >
                  <UserPlus size={14} className="mr-1 inline" /> Add Friend
                </button>
              </GlassPanel>
            ))
          )}
          {hasMorePeople && (
            <button
              onClick={showMorePeople}
              disabled={discoverLoading}
              className="w-full rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/15 disabled:opacity-60"
            >
              {discoverLoading ? "Loading..." : "Show More People"}
            </button>
          )}
        </section>

        <h2 className="mt-10 mb-3 text-xs font-bold uppercase tracking-widest text-gray-300">
          Explore
        </h2>
        <GlassPanel strong className="divide-y divide-white/5 rounded-2xl">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href} className="flex items-center gap-4 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-500/15 text-purple-300">
                  <Icon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">{link.label}</p>
                  <p className="truncate text-xs text-gray-400">{link.desc}</p>
                </div>
                <ChevronRight size={16} className="text-gray-400" />
              </Link>
            );
          })}
        </GlassPanel>
      </div>

      <BottomNavigation />
    </main>
  );
}