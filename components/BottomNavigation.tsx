"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { playNotificationSound } from "@/lib/sound";
import { presenceManager } from "@/lib/realtime/presence";
import { House, Compass, MessageCircle, User, Gem } from "lucide-react";

function uniqueChannelName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function BottomNavigation() {
  const pathname = usePathname();
  const [unreadWhispers, setUnreadWhispers] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);
  const [unreadFeed, setUnreadFeed] = useState(0);
  const [myId, setMyId] = useState<string | null>(null);
  const [anyFriendOnline, setAnyFriendOnline] = useState(false);

  const loadUnreadWhispers = useCallback(async (uid: string) => {
    const { count } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("recipient_id", uid)
      .eq("is_read", false);

    setUnreadWhispers(count || 0);
  }, []);

  const loadUnreadChats = useCallback(async (uid: string) => {
    const { data: convos } = await supabase
      .from("conversations")
      .select("user_a, user_b, user_a_last_read_at, user_b_last_read_at, last_message_at, last_message_sender_id")
      .or(`user_a.eq.${uid},user_b.eq.${uid}`);

    if (!convos) {
      setUnreadChats(0);
      return;
    }

    const unread = convos.filter((c) => {
      if (!c.last_message_at) return false;
      if (c.last_message_sender_id === uid) return false;
      const lastRead = c.user_a === uid ? c.user_a_last_read_at : c.user_b_last_read_at;
      if (!lastRead) return true;
      return new Date(c.last_message_at) > new Date(lastRead);
    });

    setUnreadChats(unread.length);
  }, []);

  const loadUnreadFeed = useCallback(async (uid: string) => {
    const { count } = await supabase
      .from("public_feed_notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .eq("is_read", false);
    setUnreadFeed(count || 0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session || cancelled) return;

      setMyId(session.user.id);
      await presenceManager.connect(session.user.id);
      await loadUnreadWhispers(session.user.id);
      await loadUnreadFeed(session.user.id);
      if (cancelled) return;

      channel = supabase
        .channel(uniqueChannelName(`bottomnav-unread-${session.user.id}`))
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `recipient_id=eq.${session.user.id}`,
          },
          () => {
            setUnreadWhispers((c) => c + 1);
            playNotificationSound();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "public_feed_notifications", filter: `user_id=eq.${session.user.id}` },
          () => loadUnreadFeed(session.user.id)
        )
        .subscribe();
    }

    init();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [loadUnreadFeed, loadUnreadWhispers]);

  // Friends green dot — reuses the shared presence singleton and only counts accepted friends.
  useEffect(() => {
    if (!myId) return;

    let friendIds = new Set<string>();
    let cancelled = false;

    async function loadFriends() {
      const { data } = await supabase
        .from("friends")
        .select("friend_id")
        .eq("user_id", myId);

      if (cancelled) return;
      friendIds = new Set((data || []).map((friend) => friend.friend_id as string));
      setAnyFriendOnline(presenceManager.getUsers().some((user) => friendIds.has(user.id)));
    }

    loadFriends();

    const unsubscribe = presenceManager.subscribe((users) => {
      setAnyFriendOnline(users.some((user) => friendIds.has(user.id)));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [myId]);

  // Inbox red dot — any conversation with unread replies
  useEffect(() => {
    if (!myId) return;

    let cancelled = false;

    async function run() {
      if (!cancelled) await loadUnreadChats(myId as string);
    }

    run();

    /* Two filtered handlers, not one unfiltered subscription.
     *
     * `conversations` with no filter means the server fans out every row change
     * in the table — every message anyone in the app sends — to every connected
     * client, and each one of those woke a full refetch here. On mobile that is
     * a socket that never goes quiet: constant radio wakeups, constant queries,
     * and battery drain proportional to total app traffic rather than to your
     * own conversations.
     *
     * Realtime filters are single-column, so an `or(user_a, user_b)` filter
     * isn't expressible — but two handlers on the same channel are, and the
     * union is exactly the rows this badge cares about. Both point at the same
     * `run`, so the behaviour is identical; only the volume changes. */
    const channel = supabase
      .channel(uniqueChannelName(`bottomnav-chat-unread-${myId}`))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `user_a=eq.${myId}` },
        () => run()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `user_b=eq.${myId}` },
        () => run()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [myId, loadUnreadChats]);

  // Safety net: realtime events can be missed (backgrounded tab, brief drop, etc).
  // Re-verify both counts whenever the tab regains focus so a stale badge never lingers.
  useEffect(() => {
    if (!myId) return;

    function refetchAll() {
      if (document.visibilityState !== "visible") return;
      loadUnreadWhispers(myId as string);
      loadUnreadChats(myId as string);
      loadUnreadFeed(myId as string);
    }

    document.addEventListener("visibilitychange", refetchAll);
    window.addEventListener("focus", refetchAll);

    return () => {
      document.removeEventListener("visibilitychange", refetchAll);
      window.removeEventListener("focus", refetchAll);
    };
  }, [myId, loadUnreadWhispers, loadUnreadChats, loadUnreadFeed]);


  /* Memoized so the six items keep their identity across the renders that don't
     concern them. This component re-renders on five separate pieces of state
     (three badges, presence, and the id), and a fresh array each time meant a
     fresh object per item — enough to defeat any memoization downstream and to
     re-run the map's work on a presence blip that changed one green dot. */
  const nav = useMemo(
    () => [
      { href: "/dashboard", icon: House, label: "Home", showPresenceDot: false, badge: undefined as number | undefined },
      { href: "/discover", icon: Compass, label: "Discover", showPresenceDot: true, badge: unreadFeed },
      { href: "/inbox", icon: MessageCircle, label: "Inbox", showPresenceDot: false, badge: unreadChats },
      { href: "/notifications", icon: null, label: "Whispers", showPresenceDot: false, badge: unreadWhispers },
      { href: "/profile", icon: User, label: "Profile", showPresenceDot: false, badge: undefined as number | undefined },
      { href: "/premium", icon: Gem, label: "Coins", showPresenceDot: false, badge: undefined as number | undefined },
    ],
    [unreadFeed, unreadChats, unreadWhispers]
  );

  return (
    <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-50 px-3 pb-3 sm:px-4 sm:pb-4">
      <nav
        aria-label="Primary navigation"
        /* `glass-control` supplies the blur and the specular gloss; `app-nav`
           adds only the nav-specific density on top.

           These used to be inline styles, which is why the bar looked flat: an
           inline `background` replaces the whole shorthand, so it overwrote the
           gloss layer the class contributes and left the film alone. Styling in
           CSS lets the two layer instead of one clobbering the other. */
        className="glass-control app-nav pointer-events-auto mx-auto max-w-xl rounded-[2rem] px-2.5 py-2 sm:px-3"
      >
        <div className="grid grid-cols-6 items-center gap-1">
        {nav.map((item) => {
          const Icon = item.icon;
          const active =
            pathname.startsWith(item.href) ||
            (item.href === "/discover" && (pathname.startsWith("/friends") || pathname.startsWith("/active")));

          return (
            <Link
              key={item.href}
              href={item.href}
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
                  boxShadow: active ? "0 10px 26px color-mix(in srgb, var(--theme-accent-from) 32%, transparent)" : undefined,
                }}
              >
                {Icon ? (
                  <Icon
                    size={20}
                    strokeWidth={2.3}
                    className="transition-colors duration-300"
                  />
                ) : (
                  <Image
                    src="/ghost.png"
                    alt="Whispers"
                    width={20}
                    height={20}
                    className={`transition duration-300 ${active ? "drop-shadow" : "opacity-70 grayscale"}`}
                  />
                )}

                {item.showPresenceDot && anyFriendOnline && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 bg-green-400" style={{ borderColor: "var(--theme-nav-solid)" }} />
                )}

                {item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute -top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white shadow-lg shadow-rose-500/30">
                    {item.badge > 9 ? "9+" : item.badge}
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