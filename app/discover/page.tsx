"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Compass,
  Users,
  Newspaper,
  Bookmark,
  Lightbulb,
  Shield,
  FileText,
  ScrollText,
  History,
  Pin,
  LifeBuoy,
  type LucideIcon,
} from "lucide-react";

import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import { supabase } from "@/lib/supabase/client";
import { getCachedSession } from "@/lib/supabase/session";
import { presenceManager } from "@/lib/realtime/presence";

function WavingAnimeAvatar() {
  return (
    <svg viewBox="0 0 96 96" className="discover-anime-avatar relative h-8 w-8" role="img" aria-label="Blonde anime avatar waving hello">
      <defs>
        <linearGradient id="anime-shirt" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
        <linearGradient id="anime-hair" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#fff3a6" />
          <stop offset="1" stopColor="#e7a83e" />
        </linearGradient>
      </defs>
      <path d="M17 96c2-22 15-31 31-31s29 9 31 31H17Z" fill="url(#anime-shirt)" />
      <path d="M39 57h18v15H39z" fill="#ffd0aa" />
      <ellipse cx="48" cy="39" rx="22" ry="25" fill="#ffd9b8" />
      <path d="M26 40c-4-25 10-36 25-34 15 1 25 13 19 39l-9-15-7 7-5-12-10 12-7-8-6 18Z" fill="url(#anime-hair)" />
      <path d="M39 43c3 3 6 3 9 0M53 43c3 3 6 3 9 0" fill="none" stroke="#7c4a36" strokeLinecap="round" strokeWidth="2" />
      <circle cx="40" cy="37" r="2.5" fill="#34231f" />
      <circle cx="57" cy="37" r="2.5" fill="#34231f" />
      <path d="M45 49c2 2 5 2 7 0" fill="none" stroke="#d47770" strokeLinecap="round" strokeWidth="2" />
      <g className="discover-anime-wave">
        <path d="M67 68c8-6 12-14 12-23" fill="none" stroke="#ffd9b8" strokeLinecap="round" strokeWidth="8" />
        <path d="M79 45c-5-5-4-13 0-17 2 5 3 8 3 11 1-8 4-12 7-13 1 6-1 11-3 15 4-6 8-8 10-6-1 7-5 13-11 17" fill="#ffd9b8" stroke="#b96e61" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      </g>
    </svg>
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
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [unreadFeedCount, setUnreadFeedCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let unsubscribePresence: (() => void) | undefined;
    let feedChannel: ReturnType<typeof supabase.channel> | null = null;

    async function loadFriendPresence() {
      const session = await getCachedSession();

      if (!session || cancelled) return;

      const { data: friends, error } = await supabase
        .from("friends")
        .select("friend_id")
        .eq("user_id", session.user.id);
      if (error) console.error("Discover friends fetch error:", error);
      if (cancelled) return;

      setFriendIds((friends || []).map((friend) => friend.friend_id));
      const { count: feedCount } = await supabase
        .from("public_feed_notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", session.user.id)
        .eq("is_read", false);
      if (!cancelled) setUnreadFeedCount(feedCount || 0);

      await presenceManager.connect(session.user.id);
      unsubscribePresence = presenceManager.subscribe((users) => {
        if (!cancelled) setOnlineUserIds(users.map((user) => user.id));
      });

      feedChannel = supabase
        .channel(`discover-feed-badge-${session.user.id}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "public_feed_notifications",
            filter: `user_id=eq.${session.user.id}`,
          },
          async () => {
            const { count } = await supabase
              .from("public_feed_notifications")
              .select("id", { count: "exact", head: true })
              .eq("user_id", session.user.id)
              .eq("is_read", false);
            if (!cancelled) setUnreadFeedCount(count || 0);
          }
        )
        .subscribe();
    }

    loadFriendPresence();
    return () => {
      cancelled = true;
      unsubscribePresence?.();
      if (feedChannel) supabase.removeChannel(feedChannel);
    };
  }, []);

  /* `friendIds.filter((id) => onlineUserIds.includes(id))` is a linear scan of
     the online list for every friend, and presence pushes a new array on every
     connect and disconnect anywhere in the app — so this ran on every render,
     at O(friends × online). Indexing once turns the inner check into a hash
     lookup, and the memo means a re-render that didn't touch presence doesn't
     redo the count at all. */
  const onlineFriendCount = useMemo(() => {
    const online = new Set(onlineUserIds);
    let count = 0;
    for (const id of friendIds) if (online.has(id)) count += 1;
    return count;
  }, [friendIds, onlineUserIds]);

  return (
    <main className="min-h-screen theme-bg-gradient pb-28 text-white">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <BackButton />

        <div className="mt-4 flex items-center gap-3">
          <Compass className="text-purple-400" size={24} />
          <h1 className="page-title">Discover</h1>
        </div>
        <p className="page-subtitle mt-1">Explore Whisper and manage your connections.</p>

        <h2 className="eyebrow mt-10 mb-5">
          Explore
        </h2>
        <section className="discover-icon-grid grid grid-cols-2 gap-3 sm:grid-cols-3">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon;
            const isFriendsLink = link.href.startsWith("/friends");
            const isFeedLink = link.href === "/public-feed";
            return (
              <Link
                key={link.href}
                href={link.href}
                className="discover-tile group relative flex min-w-0 flex-col items-center gap-2 rounded-2xl px-3 py-4 text-center"
              >
                {/* The label lives *inside* the fill, so the whole thing is one
                    pressable object — same as the Share button on the
                    dashboard. Previously the caption sat outside on the page
                    background, which made the coloured part read as an icon
                    badge rather than as a button. */}
                <span className="discover-tile-icon relative flex h-9 w-9 items-center justify-center rounded-xl">
                  {isFriendsLink ? (
                    <WavingAnimeAvatar />
                  ) : (
                    <Icon size={17} strokeWidth={1.9} className="relative" />
                  )}

                  {isFriendsLink && onlineFriendCount > 0 && (
                    <span className="discover-tile-badge absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-400 px-1 text-[9px] font-black text-[#062019]">
                      {onlineFriendCount}
                    </span>
                  )}
                  {isFeedLink && unreadFeedCount > 0 && (
                    <span className="discover-tile-badge absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white">
                      {unreadFeedCount > 9 ? "9+" : unreadFeedCount}
                    </span>
                  )}
                </span>

                <span className="discover-tile-label line-clamp-2 text-[12px] font-bold leading-tight">
                  {link.label}
                </span>
                {isFriendsLink && onlineFriendCount > 0 && (
                  <span className="discover-tile-meta text-[10px] font-bold">
                    {onlineFriendCount} active now
                  </span>
                )}
                <span className="sr-only">{link.desc}</span>
              </Link>
            );
          })}
        </section>
      </div>

      <BottomNavigation />
    </main>
  );
}