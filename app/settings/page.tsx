"use client";

import Link from "next/link";
import GlassPanel from "@/components/GlassPanel";
import BackButton from "@/components/BackButton";
import LogoutButton from "@/components/LogoutButton";
import { useTheme } from "@/components/ThemeProvider";
import {
  Bell,
  Moon,
  Sun,
  ChevronRight,
  Newspaper,
  Bookmark,
  Pin,
  Coins,
  Ban,
  Filter,
  History,
  LifeBuoy,
  Lightbulb,
  ScrollText,
  Shield,
  FileText,
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

const SUPPORT_LINKS = [
  { href: "/feedback", label: "Feedback", icon: Lightbulb },
  { href: "/contact-support", label: "Contact Support", icon: LifeBuoy },
  { href: "/community-guidelines", label: "Community Guidelines", icon: ScrollText },
  { href: "/help-center", label: "Help Center", icon: Shield },
];

const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy Policy", icon: Shield },
  { href: "/terms", label: "Terms of Service", icon: FileText },
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
  const { resolvedTheme, toggleTheme } = useTheme();

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
          <div className="flex items-center justify-between gap-3 py-3.5 px-1 border-t border-white/5">
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-purple-300">
                {resolvedTheme === "dark" ? <Moon size={17} /> : <Sun size={17} />}
              </span>
              <span className="text-sm font-medium text-white/90">
                {resolvedTheme === "dark" ? "Dark Mode" : "Light Mode"}
              </span>
            </span>
            <button
              onClick={toggleTheme}
              className="relative h-6 w-11 rounded-full transition-colors"
              style={{
                background:
                  resolvedTheme === "dark" ? "var(--theme-accent-from)" : "rgba(255,255,255,0.15)",
              }}
              aria-label="Toggle theme"
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  resolvedTheme === "dark" ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
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

        <GlassPanel strong className="rounded-3xl p-5 mb-4 divide-y divide-white/5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-white/40 mb-1 px-1">
            Support
          </h2>
          {SUPPORT_LINKS.map((link) => (
            <LinkRow key={link.href} {...link} />
          ))}
        </GlassPanel>

        <GlassPanel strong className="rounded-3xl p-5 mb-4 divide-y divide-white/5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-white/40 mb-1 px-1">
            Legal
          </h2>
          {LEGAL_LINKS.map((link) => (
            <LinkRow key={link.href} {...link} />
          ))}
        </GlassPanel>

        <LogoutButton />
      </div>
    </main>
  );
}