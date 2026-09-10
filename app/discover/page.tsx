"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Users2,
  Gamepad2,
  MessageSquareDiff,
  Headphones,
  HelpCircle,
  Shield,
  Lock,
  FileText,
  ChevronRight,
} from "lucide-react";

import BottomNavigation from "@/components/BottomNavigation";
import EdgeLitCard from "@/components/EdgeLitCard";
import { supabase } from "@/lib/supabase/client";
import { getCachedSession } from "@/lib/supabase/session";
import { presenceManager } from "@/lib/realtime/presence";

type FeatureCard = {
  href: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  delay: string;
};

type UtilityCard = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  delay: string;
};

const FEATURE_CARDS: FeatureCard[] = [
  {
    href: "/friends?tab=friends",
    label: "Friends",
    desc: "Connect, chat and discover new people.",
    icon: Users2,
    delay: "0s",
  },
  {
    href: "/games",
    label: "Whisper Games",
    desc: "Play, have fun and win rewards.",
    icon: Gamepad2,
    delay: "-2.4s",
  },
];

const UTILITY_CARDS: UtilityCard[] = [
  { href: "/feedback", label: "Feedback", icon: MessageSquareDiff, delay: "-1.2s" },
  { href: "/contact-support", label: "Contact Support", icon: Headphones, delay: "-3.6s" },
  { href: "/help-center", label: "Help Center", icon: HelpCircle, delay: "-4.8s" },
  { href: "/community-guidelines", label: "Community Guidelines", icon: Shield, delay: "-6s" },
  { href: "/privacy", label: "Privacy Policy", icon: Lock, delay: "-7.2s" },
  { href: "/terms", label: "Terms of Service", icon: FileText, delay: "-8.4s" },
];

export default function DiscoverPage() {
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribePresence: (() => void) | undefined;

    async function load() {
      const session = await getCachedSession();
      if (!session || cancelled) return;

      const { data: friends } = await supabase
        .from("friends")
        .select("friend_id")
        .eq("user_id", session.user.id);

      if (!cancelled) {
        setFriendIds((friends || []).map((f) => f.friend_id));
      }

      unsubscribePresence = presenceManager.subscribe((users) => {
        if (!cancelled) setOnlineUserIds(users.map((u) => u.id));
      });
      void presenceManager.connect(session.user.id);
    }

    load();
    return () => {
      cancelled = true;
      unsubscribePresence?.();
    };
  }, []);

  const onlineFriendCount = useMemo(() => {
    const online = new Set(onlineUserIds);
    let count = 0;
    for (const id of friendIds) if (online.has(id)) count += 1;
    return count;
  }, [friendIds, onlineUserIds]);

  return (
    <main className="min-h-screen bg-[#050508] pb-28 text-white selection:bg-[#7C3AED]/30">
      {/* Subtle ambient glows behind content - keeps Whisper premium dark aesthetic */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 -left-32 h-[520px] w-[520px] rounded-full bg-[#7C3AED]/[0.18] blur-[110px]" />
        <div className="absolute -top-20 right-0 h-[420px] w-[420px] rounded-full bg-[#22d3ee]/[0.10] blur-[100px]" />
        <div className="absolute bottom-0 left-1/2 h-[600px] w-[700px] -translate-x-1/2 rounded-full bg-[#ec4899]/[0.08] blur-[120px]" />
      </div>

      <div className="mx-auto w-full max-w-[720px] px-5 py-8 sm:px-7 sm:py-10">
        {/* Header */}
        <div className="mb-8 sm:mb-10">
          <div className="flex items-center gap-3 sm:gap-4">
            <h1
              className="text-[40px] font-black leading-none tracking-[-0.04em] sm:text-[54px]"
              style={{
                fontFamily: "Georgia, 'Times New Roman', Times, serif",
                fontStyle: "italic",
                fontWeight: 900,
              }}
            >
              Discover
            </h1>
            <span className="inline-flex items-center rounded-full bg-[#7C3AED] px-3 py-1 text-[10px] font-black tracking-[0.14em] text-white shadow-[0_0_22px_rgba(124,58,237,0.55),inset_0_1px_0_rgba(255,255,255,0.25)] sm:px-3.5 sm:py-1.5 sm:text-[11px]">
              EXPLORE
            </span>
          </div>
          <p className="mt-3 text-[15px] font-medium leading-[1.5] tracking-[-0.01em] text-[#a1a1b5] sm:text-[16px]">
            Your world, expanded.
          </p>
        </div>

        {/* Feature Cards - stacked full width */}
        <section className="flex flex-col gap-4 sm:gap-5">
          {FEATURE_CARDS.map((card) => {
            const Icon = card.icon;
            const isFriends = card.label === "Friends";
            return (
              <Link key={card.href} href={card.href} className="group block no-press">
                <EdgeLitCard
                  intensity={0.92}
                  speed={9}
                  radius="2xl"
                  className="rounded-[22px] transition-transform duration-300 ease-out group-hover:-translate-y-[1px] group-active:translate-y-0 group-active:scale-[0.99]"
                  style={{ animationDelay: card.delay } as React.CSSProperties}
                  innerClassName="rounded-[21px] !bg-[#111114] sm:!bg-[#111114] flex items-center gap-4 p-[18px] sm:p-6"
                >
                  <div className="flex w-full items-center gap-4">
                    {/* Icon box */}
                    <div className="relative flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px] border border-white/[0.08] bg-[#191922] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_20px_rgba(0,0,0,0.4)] sm:h-[56px] sm:w-[56px] sm:rounded-[16px]">
                      <Icon size={24} strokeWidth={2} className="text-white" />
                      {isFriends && onlineFriendCount > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#111114] bg-emerald-400 px-1 text-[10px] font-black leading-none text-[#062019] shadow-[0_2px_10px_rgba(52,211,153,0.5)]">
                          {onlineFriendCount}
                        </span>
                      )}
                    </div>

                    {/* Text */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-[16px] font-bold leading-tight tracking-[-0.01em] text-white sm:text-[18px]">
                          {card.label}
                        </h2>
                        {isFriends && onlineFriendCount > 0 && (
                          <span className="hidden items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-400/20 sm:inline-flex">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                            {onlineFriendCount} online
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-[1.4] text-[#9a9ab0] sm:text-[14px]">
                        {card.desc}
                        {isFriends && onlineFriendCount > 0 && (
                          <span className="sm:hidden"> • {onlineFriendCount} active now</span>
                        )}
                      </p>
                    </div>

                    {/* Chevron */}
                    <div className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[#7a7a8e] ring-1 ring-white/[0.06] transition-all duration-300 group-hover:bg-white/[0.10] group-hover:text-white group-hover:ring-white/10 sm:h-9 sm:w-9">
                      <ChevronRight size={18} strokeWidth={2.5} />
                    </div>
                  </div>
                </EdgeLitCard>
              </Link>
            );
          })}
        </section>

        {/* Utility Grid - 2 columns */}
        <section className="mt-4 grid grid-cols-2 gap-3 sm:mt-5 sm:gap-4">
          {UTILITY_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <Link key={card.href} href={card.href} className="group block no-press">
                <EdgeLitCard
                  intensity={0.78}
                  speed={12}
                  radius="2xl"
                  className="h-full rounded-[18px] transition-transform duration-300 ease-out group-hover:-translate-y-[1px] group-active:translate-y-0 group-active:scale-[0.98]"
                  style={{ animationDelay: card.delay } as React.CSSProperties}
                  innerClassName="rounded-[17px] !bg-[#101014] flex h-full min-h-[88px] items-center gap-3 p-4 sm:min-h-[96px] sm:gap-3.5 sm:p-[18px]"
                >
                  <div className="flex w-full items-center gap-3">
                    {/* Icon box - smaller for utility */}
                    <div className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[12px] border border-white/[0.07] bg-[#18181f] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:h-[48px] sm:w-[48px] sm:rounded-[13px]">
                      <Icon size={20} strokeWidth={2} className="text-white/90" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <h3 className="line-clamp-2 text-[13px] font-bold leading-[1.25] tracking-[-0.01em] text-white sm:text-[14px]">
                        {card.label}
                      </h3>
                    </div>

                    <ChevronRight
                      size={16}
                      strokeWidth={2.5}
                      className="ml-auto shrink-0 text-[#5a5a6e] transition-all duration-300 group-hover:translate-x-[1px] group-hover:text-white/80"
                    />
                  </div>
                </EdgeLitCard>
              </Link>
            );
          })}
        </section>

        {/* Subtle footer hint - keeps page feeling finished */}
        <div className="mt-10 flex items-center justify-center gap-2 opacity-40">
          <div className="h-px w-8 bg-gradient-to-r from-transparent to-white/20" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">Whisper</span>
          <div className="h-px w-8 bg-gradient-to-l from-transparent to-white/20" />
        </div>
      </div>

      <BottomNavigation />
    </main>
  );
}
