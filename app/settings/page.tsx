"use client";

import Link from "next/link";
import GlassPanel from "@/components/GlassPanel";
import BackButton from "@/components/BackButton";
import LogoutButton from "@/components/LogoutButton";
import HapticsSettingRow from "@/components/HapticsSettingRow";
import {
  Bell,
  ChevronRight,
  Newspaper,
  Coins,
  History,
  type LucideIcon,
} from "lucide-react";

/* Saved Messages, Pinned Messages, Blocklist and Blocked Keywords used to sit in
   this list. Every one of them opened a screen whose only content was "This
   feature is coming soon", so the menu was advertising four features that did not
   exist — and a settings list is exactly where someone goes looking when they
   believe a feature is there. Removed along with their routes. Pinning a message
   *inside* a chat is unaffected; that has always worked and lives in the chat
   itself. */
const MORE_LINKS = [
  { href: "/public-feed", label: "Public Feed", icon: Newspaper },
  { href: "/premium", label: "Coin Store", icon: Coins },
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
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-purple-300">
          <Icon size={17} />
        </span>
        {/* `text-white`, not `text-white/90`. Tailwind's opacity modifier compiles
            to its own class (`.text-white\/90`), and the theme compatibility
            bridge in globals.css only rewrites the bare `.text-white` — so every
            `/N` variant stayed literal white and this whole list was invisible on
            the light theme's white panel. Same reason the chevron below carries
            its fade as `opacity` rather than as `text-white/30`. */}
        <span className="text-sm font-medium text-white">{label}</span>
      </span>
      <ChevronRight
        size={16}
        className="flex-none theme-text-subtle opacity-70 transition-opacity group-hover:opacity-100"
      />
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

        <h1 className="page-title mb-8">Settings</h1>

        <GlassPanel strong className="rounded-3xl p-5 mb-4 divide-y divide-white/[0.06]">
          <h2 className="text-xs font-bold uppercase tracking-wider theme-text-subtle mb-1 px-1">
            Preferences
          </h2>
          <div className="flex items-center justify-between gap-3 py-3.5 px-1">
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-purple-300">
                <Bell size={17} />
              </span>
              <span className="text-sm font-medium text-white">Push Notifications</span>
            </span>
            <Link href="/notifications" className="text-xs font-semibold text-purple-300">
              Manage
            </Link>
          </div>
          {/* Given a home here rather than buried in a debug screen because the
              switch is a real preference, and because the Test button beside it
              is the only way to tell "Whisper didn't fire" from "Android is set
              not to buzz" — two failures that feel identical. */}
          <HapticsSettingRow />
        </GlassPanel>

        {/* `divide-white/[0.06]` rather than `divide-white/5`: only the first of
            those is in the theme bridge, so the second drew a literally-white
            hairline that vanished on the light panel. */}
        <GlassPanel strong className="rounded-3xl p-5 mb-4 divide-y divide-white/[0.06]">
          <h2 className="text-xs font-bold uppercase tracking-wider theme-text-subtle mb-1 px-1">
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