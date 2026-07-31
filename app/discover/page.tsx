"use client";

import { useEffect, useState } from "react";
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
import { presenceManager } from "@/lib/realtime/presence";

function WavingAnimeAvatar() {
  return (
    <svg viewBox="0 0 96 96" className="discover-anime-avatar relative h-14 w-14" role="img" aria-label="Blonde anime avatar waving hello">
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

  useEffect(() => {
    let cancelled = false;
    let unsubscribePresence: (() => void) | undefined;

    async function loadFriendPresence() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;

      const { data: friends, error } = await supabase
        .from("friends")
        .select("friend_id")
        .eq("user_id", session.user.id);
      if (error) console.error("Discover friends fetch error:", error);
      if (cancelled) return;

      setFriendIds((friends || []).map((friend) => friend.friend_id));
      await presenceManager.connect(session.user.id);
      unsubscribePresence = presenceManager.subscribe((users) => {
        if (!cancelled) setOnlineUserIds(users.map((user) => user.id));
      });
    }

    loadFriendPresence();
    return () => {
      cancelled = true;
      unsubscribePresence?.();
    };
  }, []);

  const onlineFriendCount = friendIds.filter((id) => onlineUserIds.includes(id)).length;

  return (
    <main className="min-h-screen theme-bg-gradient pb-28 text-white">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <BackButton />

        <div className="mt-4 flex items-center gap-3">
          <Compass className="text-purple-400" size={28} />
          <h1 className="text-3xl font-black">Discover</h1>
        </div>
        <p className="mt-1 text-sm text-gray-400">Explore Whisper and manage your connections.</p>

        <h2 className="mt-10 mb-5 text-xs font-bold uppercase tracking-widest text-gray-300">
          Explore
        </h2>
        <section className="discover-icon-grid grid grid-cols-3 gap-x-3 gap-y-7">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon;
            const isFriendsLink = link.href.startsWith("/friends");
            return (
              <Link
                key={link.href}
                href={link.href}
                className="group flex min-w-0 flex-col items-center text-center [perspective:700px]"
              >
                <div className={`discover-icon-tile relative flex h-16 w-16 items-center justify-center rounded-[22px] border border-white/15 bg-gradient-to-br from-white/15 to-white/[0.03] text-cyan-200 shadow-[0_14px_28px_rgba(0,0,0,0.28),inset_0_1px_1px_rgba(255,255,255,0.25)] transition duration-300 [transform-style:preserve-3d] group-hover:-translate-y-2 group-hover:rotate-[6deg] group-hover:scale-110 group-hover:text-white group-active:scale-95 ${isFriendsLink ? "discover-friends-tile" : ""}`}>
                  <span className="absolute inset-1 rounded-[18px] border border-cyan-300/10" />
                  {isFriendsLink ? (
                    <>
                      <WavingAnimeAvatar />
                      {onlineFriendCount > 0 && (
                        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#100d18] bg-emerald-400 px-1 text-[9px] font-black text-[#062019] shadow-[0_0_12px_rgba(52,211,153,0.8)]">
                          {onlineFriendCount}
                        </span>
                      )}
                    </>
                  ) : (
                    <Icon size={27} strokeWidth={1.8} className="relative drop-shadow-[0_3px_3px_rgba(0,0,0,0.45)]" />
                  )}
                </div>
                <p className="mt-3 line-clamp-2 text-xs font-semibold leading-tight text-gray-200 transition group-hover:text-cyan-200">{link.label}</p>
                {isFriendsLink && onlineFriendCount > 0 && (
                  <p className="mt-1 text-[10px] font-bold text-emerald-400">{onlineFriendCount} active now</p>
                )}
                <p className="sr-only">{link.desc}</p>
              </Link>
            );
          })}
        </section>
      </div>

      <BottomNavigation />
    </main>
  );
}