"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
  Bell,
  Compass,
  Flame,
  Gem,
  Home,
  LogOut,
  MessageCircle,
  MessageSquareText,
  Rocket,
  Settings,
  Sparkles,
  User,
} from "lucide-react";

import Logo from "@/components/Logo";
import { supabase } from "@/lib/supabase/client";
import {
  getNavBadges,
  getNavBadgesServerSnapshot,
  subscribeNavBadges,
} from "@/lib/nav/navBadges";
import { generatedAvatarUrl } from "@/lib/generatedAvatar";
import type { DashboardProfile } from "./types";

type NavRow = {
  href: string;
  label: string;
  icon: typeof Home;
  badge?: "chats" | "whispers" | "feed";
};

const DISCOVERY: NavRow[] = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/public-feed?sort=for_you", label: "For You", icon: Sparkles },
  { href: "/public-feed?sort=trending", label: "Trending", icon: Flame },
  { href: "/public-feed?sort=new", label: "New", icon: Rocket },
  { href: "/public-feed?sort=discussed", label: "Discussed", icon: MessageSquareText },
];

const ACCOUNT: NavRow[] = [
  { href: "/inbox", label: "Messages", icon: MessageCircle, badge: "chats" },
  { href: "/notifications", label: "Notifications", icon: Bell, badge: "whispers" },
  { href: "/discover", label: "Explore", icon: Compass, badge: "feed" },
  { href: "/profile", label: "Profile", icon: User },
  { href: "/settings", label: "Settings", icon: Settings },
];

function SidebarLink({ item, active = false, count = 0 }: { item: NavRow; active?: boolean; count?: number }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      prefetch
      aria-current={active ? "page" : undefined}
      className={`dashboard-side-link ${active ? "is-active" : ""}`}
    >
      <Icon size={18} strokeWidth={active ? 2.4 : 2} />
      <span>{item.label}</span>
      {count > 0 && (
        <span className="dashboard-side-badge" aria-label={`${count} unread`}>
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}

export default function DashboardSidebar({ profile }: { profile: DashboardProfile }) {
  const router = useRouter();
  const badges = useSyncExternalStore(
    subscribeNavBadges,
    getNavBadges,
    getNavBadgesServerSnapshot
  );

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  const avatar = profile.avatar_url || generatedAvatarUrl(profile.id);

  return (
    <aside className="dashboard-sidebar" aria-label="Dashboard navigation">
      <Link href="/dashboard" className="dashboard-sidebar-brand" aria-label="Whisper home">
        <Logo compact showTagline />
      </Link>

      <nav className="dashboard-side-nav" aria-label="Discover Whisper">
        {DISCOVERY.map((item) => (
          <SidebarLink key={item.label} item={item} active={item.href === "/dashboard"} />
        ))}
      </nav>

      <div className="dashboard-side-divider" />

      <nav className="dashboard-side-nav" aria-label="Your Whisper account">
        {ACCOUNT.map((item) => (
          <SidebarLink
            key={item.label}
            item={item}
            count={item.badge ? badges[item.badge] : 0}
          />
        ))}
      </nav>

      <div className="dashboard-side-spacer" />

      <Link href="/premium" className="dashboard-premium-mini">
        <span className="dashboard-premium-mini-icon"><Gem size={18} /></span>
        <span className="min-w-0">
          <strong>Unlock more</strong>
          <small>Coins, media & premium tools</small>
        </span>
        <span aria-hidden>→</span>
      </Link>

      <div className="dashboard-side-profile">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatar} alt="" className="dashboard-side-avatar" />
        <Link href="/profile" className="min-w-0 flex-1">
          <strong className="block truncate">{profile.display_name || profile.username}</strong>
          <span className="block truncate">@{profile.username}</span>
        </Link>
        <button type="button" onClick={logout} className="dashboard-side-logout" aria-label="Log out">
          <LogOut size={17} />
        </button>
      </div>
    </aside>
  );
}
