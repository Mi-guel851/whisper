"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useSyncExternalStore } from "react";
import { MessageCircle, Moon, Search, Sun } from "lucide-react";

import Logo from "@/components/Logo";
import NotificationBell from "@/components/NotificationBell";
import { generatedAvatarUrl } from "@/lib/generatedAvatar";
import {
  getNavBadges,
  getNavBadgesServerSnapshot,
  subscribeNavBadges,
} from "@/lib/nav/navBadges";
import { useTheme } from "@/components/ThemeProvider";
import type { DashboardProfile } from "./types";

function TopbarAction({
  href,
  label,
  count,
  children,
}: {
  href: string;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="dashboard-top-action" aria-label={label}>
      {children}
      {count > 0 && <span>{count > 9 ? "9+" : count}</span>}
    </Link>
  );
}

export default function DashboardTopbar({ profile }: { profile: DashboardProfile }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const { resolvedTheme, toggleTheme } = useTheme();
  const badges = useSyncExternalStore(
    subscribeNavBadges,
    getNavBadges,
    getNavBadgesServerSnapshot
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    router.push(value ? `/public-feed?search=${encodeURIComponent(value)}` : "/public-feed");
  }

  return (
    <header className="dashboard-topbar">
      <Link href="/dashboard" className="dashboard-mobile-brand" aria-label="Whisper home">
        <Logo compact showTagline={false} />
      </Link>

      <form id="dashboard-search" className={`dashboard-global-search ${searchOpen ? "is-open" : ""}`} role="search" onSubmit={submit}>
        <Search size={17} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search whispers, topics…"
          aria-label="Search public whispers"
        />
        <kbd>Enter</kbd>
      </form>

      <div className="dashboard-top-actions">
        <button type="button" className="dashboard-top-action dashboard-search-toggle" aria-label="Toggle search" aria-expanded={searchOpen} aria-controls="dashboard-search" onClick={() => setSearchOpen((value) => !value)}>
          <Search size={18} />
        </button>
        <button type="button" className="dashboard-top-action dashboard-theme-toggle" onClick={toggleTheme} aria-label={`Use ${resolvedTheme === "dark" ? "light" : "dark"} theme`}>
          {resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <TopbarAction href="/inbox" label="Open messages" count={badges.chats}>
          <MessageCircle size={18} />
        </TopbarAction>
        {/* The bell is a switchboard, not a link: an inline dropdown (a bottom
            sheet on mobile) with the master push toggle, the five category
            toggles, and a "View all notifications" foot that keeps the old
            destination one tap away. */}
        <NotificationBell />
        <Link href="/profile" className="dashboard-top-profile" aria-label="Open your profile">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={profile.avatar_url || generatedAvatarUrl(profile.id)} alt="" />
        </Link>
      </div>
    </header>
  );
}
