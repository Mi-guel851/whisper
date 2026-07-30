"use client";

import Link from "next/link";
import GlassPanel from "@/components/GlassPanel";
import BackButton from "@/components/BackButton";
import LogoutButton from "@/components/LogoutButton";
import {
  Bell,
  ChevronRight,
  Newspaper,
  Bookmark,
  Pin,
  Coins,
  Ban,
  Filter,
  History,
  type LucideIcon,
} from "lucide-react";

const MORE_LINKS = [
  { href: "/public-feed", label: "Public Feed", icon: Newspaper },
  { href: "/saved-messages", label: "Saved Messages", icon: Bookmark },
  { href: "/pinned-messages", label: "Pinned Messages", icon: Pin },
  { href: "/premium", label: "Coin Store", icon: Coins },
  { href: "/blocklist", label: "Blocklist", icon: Ban },
  { href: "/blocked-keywords", label: "Blocked Keywords", icon: Filter },
  { href: "/activity-log", label: "Activity Log", icon: History },
  { href: "/analytics", label: "Analytics", icon: History },
];

function LinkRow({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 py-3.5 px-1 group"
    >
      <span className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-purple-300">
          <Icon size={17} />
        </span>
        <span className="text-sm font-medium text-white/90">{label}</span>
      </span>
      <ChevronRight size={16} className="text-white/30 group-hover:text-white/60 transition" />
    </Link>
  );
}

export default function SettingsPage() {
  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient text-white px-4 py-16 pb-28">
      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-purple-600/20 blur-[150px]" />
      <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-purple-600/20 blur-[180px]" />

      <div className="relative z-10 mx-auto max-w-xl">
        <BackButton />

        <h1 className="text-4xl font-black mb-8">Settings</h1>

        <GlassPanel strong className="rounded-3xl p-5 mb-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-white/40 mb-1 px-1">
            Preferences
          </h2>
          <div className="flex items-center justify-between gap-3 py-3.5 px-1">
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-purple-300">
                <Bell size={17} />
              </span>
              <span className="text-sm font-medium text-white/90">Push Notifications</span>
            </span>
            <Link href="/notifications" className="text-xs font-semibold text-purple-300">
              Manage
            </Link>
          </div>
        </GlassPanel>

        <GlassPanel strong className="rounded-3xl p-5 mb-4 divide-y divide-white/5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-white/40 mb-1 px-1">
            Your Content
          </h2>
          {MORE_LINKS.map((link) => (
            <LinkRow key={link.href} {...link} />
          ))}
        </GlassPanel>

        <LogoutButton />
      </div>
    </main>
  );
}