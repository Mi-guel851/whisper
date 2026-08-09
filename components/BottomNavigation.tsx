"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  subscribeNavBadges,
  getNavBadges,
  getNavBadgesServerSnapshot,
} from "@/lib/nav/navBadges";
import { House, Compass, MessageCircle, User, Gem, type LucideIcon } from "lucide-react";

/**
 * The bottom tab bar.
 *
 * Ten pages each render their own copy of this rather than sharing one from a
 * layout, so it unmounts and remounts on every tab switch. It therefore holds
 * no state of its own: the badge counts, the realtime subscriptions and the
 * presence handshake all live in `lib/nav/navBadges`, which outlives any single
 * mount. Remounting this component now costs a render and nothing else — no
 * queries, no channel joins, and no badges blanking to zero on the way in.
 */

/* Static shape, hoisted out of render. Only the badge numbers change. */
type BadgeKey = "feed" | "chats" | "whispers";

type NavItem = {
  href: string;
  /** `null` renders the ghost image instead of a stroke icon. */
  icon: LucideIcon | null;
  label: string;
  presenceDot: boolean;
  badge: BadgeKey | null;
};

const ITEMS: NavItem[] = [
  { href: "/dashboard", icon: House, label: "Home", presenceDot: false, badge: null },
  { href: "/discover", icon: Compass, label: "Discover", presenceDot: true, badge: "feed" },
  { href: "/inbox", icon: MessageCircle, label: "Inbox", presenceDot: false, badge: "chats" },
  { href: "/notifications", icon: null, label: "Whispers", presenceDot: false, badge: "whispers" },
  { href: "/profile", icon: User, label: "Profile", presenceDot: false, badge: null },
  { href: "/premium", icon: Gem, label: "Coins", presenceDot: false, badge: null },
];
export default function BottomNavigation() {
  const pathname = usePathname();
  const badges = useSyncExternalStore(
    subscribeNavBadges,
    getNavBadges,
    getNavBadgesServerSnapshot
  );

  /* Resolved once per badge change rather than per item per render. */
  const counts = useMemo(
    () => ({ feed: badges.feed, chats: badges.chats, whispers: badges.whispers }),
    [badges.feed, badges.chats, badges.whispers]
  );

  return (
    <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-50 px-3 pb-3 sm:px-4 sm:pb-4">
      <nav
        aria-label="Primary navigation"
        className="glass-control app-nav pointer-events-auto mx-auto max-w-xl rounded-[2rem] px-2.5 py-2 sm:px-3"
      >
        <div className="grid grid-cols-6 items-center gap-1">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const badge = item.badge ? counts[item.badge] : 0;
            const active =
              pathname.startsWith(item.href) ||
              (item.href === "/discover" &&
                (pathname.startsWith("/friends") || pathname.startsWith("/active")));

            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                className="group relative flex min-w-0 flex-col items-center gap-1 rounded-2xl px-1.5 py-1.5 text-[10px] font-bold transition duration-300 ease-out hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-95"
              >
                <div
                  className={`relative flex h-10 w-10 items-center justify-center rounded-2xl transition-all duration-300 ease-out ${
                    active ? "scale-105 shadow-lg" : "group-hover:bg-white/10"
                  }`}
                  style={{
                    background: active
                      ? "linear-gradient(135deg, var(--theme-accent-from), var(--theme-accent-to))"
                      : "transparent",
                    color: active ? "var(--theme-accent-contrast)" : "var(--theme-nav-inactive)",
                    boxShadow: active
                      ? "0 10px 26px color-mix(in srgb, var(--theme-accent-from) 32%, transparent)"
                      : undefined,
                  }}
                >
                  {Icon ? (
                    <Icon size={20} strokeWidth={2.3} className="transition-colors duration-300" />
                  ) : (
                    <Image
                      src="/ghost.png"
                      alt="Whispers"
                      width={20}
                      height={20}
                      className={`transition duration-300 ${active ? "drop-shadow" : "opacity-70 grayscale"}`}
                    />
                  )}

                  {item.presenceDot && badges.friendOnline && (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 bg-green-400"
                      style={{ borderColor: "var(--theme-nav-solid)" }}
                    />
                  )}

                  {badge > 0 && (
                    <span className="absolute -top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white shadow-lg shadow-rose-500/30">
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </div>

                <span
                  className="truncate transition-colors duration-300"
                  style={{ color: active ? "var(--theme-nav-active-text)" : "var(--theme-nav-inactive)" }}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
