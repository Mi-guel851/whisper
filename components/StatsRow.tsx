"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { MessageSquare, Eye, BarChart3 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import EdgeLitCard from "./EdgeLitCard";
import AnimatedCounter from "./AnimatedCounter";
import { Skeleton } from "./Skeleton";
import { staggerContainer, staggerItem, tween } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

const REFRESH_MS = 4_000;

type Stats = {
  totalMessages: number;
  messagesThisWeek: number;
  totalViews: number;
  viewsToday: number;
  /** Impressions across every public-feed post this user has written. */
  postViews: number;
  /** Posts currently alive in the 24h feed window. */
  livePosts: number;
};

const EMPTY: Stats = {
  totalMessages: 0,
  messagesThisWeek: 0,
  totalViews: 0,
  viewsToday: 0,
  postViews: 0,
  livePosts: 0,
};

export default function StatsRow() {
  const [stats, setStats] = useState<Stats>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const reduced = useSafeReducedMotion();

  /**
   * Absolute view_count per one of the author's posts, seeded from the initial
   * read and kept current by the realtime subscription below. The dashboard's
   * "Post Views" total is just the sum of this map, so it reads from the exact
   * same `view_count` column the public feed shows — the two surfaces cannot
   * disagree, and both update live.
   */
  const postViewsById = useRef<Map<string, number>>(new Map());

  // Guards against a slow poll resolving after unmount.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async (uid: string) => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      { count: totalMsgCount },
      { count: weekMsgCount },
      { count: totalViewCount },
      { count: todayViewCount },
      feedPosts,
    ] = await Promise.all([
      supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("recipient_id", uid),
      supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("recipient_id", uid)
        .gte("created_at", weekAgo.toISOString()),
      supabase
        .from("profile_views")
        .select("*", { count: "exact", head: true })
        .eq("profile_id", uid),
      supabase
        .from("profile_views")
        .select("*", { count: "exact", head: true })
        .eq("profile_id", uid)
        .gte("created_at", todayStart.toISOString()),
      /*
       * Feed impressions, summed client-side from the user's own rows.
       *
       * `view_count` is already denormalised onto the post by a trigger (see
       * 202608030001_public_feed_metrics.sql), so this reads a column rather than
       * counting a join table — the aggregate is the cheap part.
       *
       * Not `head: true` with a count, because the wanted number is a *sum* of a
       * column and PostgREST has no aggregate for that without a view. The row
       * count here is bounded by how many posts one person has written inside a
       * 24-hour window, so selecting the column is genuinely cheaper than adding
       * a database object for it.
       *
       * The feed expires posts after 24h, and this is deliberately *not* filtered
       * on `expires_at`: total impressions earned is a lifetime figure, and having
       * it reset to zero every night is the opposite of a stat.
       */
      supabase
        .from("public_feed_posts")
        .select("view_count,expires_at")
        .eq("author_id", uid),
    ]);

    if (!alive.current) return;

    /* A missing table or column resolves with `data: null` and an error rather
       than throwing, so both degrade to zero instead of blanking the tiles. */
    const rows = (feedPosts.data ?? []) as { id: string; view_count: number | null; expires_at: string }[];
    const now = Date.now();

    // Seed the per-post absolute view counts for realtime updates.
    const byId = postViewsById.current;
    byId.clear();
    for (const row of rows) byId.set(row.id, row.view_count ?? 0);

    setStats({
      totalMessages: totalMsgCount || 0,
      messagesThisWeek: weekMsgCount || 0,
      totalViews: totalViewCount || 0,
      viewsToday: todayViewCount || 0,
      postViews: rows.reduce((sum, row) => sum + (row.view_count ?? 0), 0),
      livePosts: rows.filter((row) => new Date(row.expires_at).getTime() > now).length,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setLoading(false);
        return;
      }
      setUserId(session.user.id);
      await load(session.user.id);
    }
    init();
  }, [load]);

  /* Realtime "Post Views": subscribe to every view_count UPDATE on this
     author's public-feed posts. The public feed already broadcasts these (the
     posts table is in the realtime publication), so the dashboard total ticks
     up the instant any reader views a post — no page refresh, and the slow
     poll below stays as a reconciliation safety net for a dropped socket. */
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`stats-views-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "public_feed_posts",
          filter: `author_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { id?: string; view_count?: number | null };
          if (!row.id || typeof row.view_count !== "number") return;
          const prev = postViewsById.current.get(row.id);
          // The server is authoritative; ignore any older value.
          if (prev === undefined || row.view_count > prev) {
            postViewsById.current.set(row.id, row.view_count);
            let total = 0;
            for (const v of postViewsById.current.values()) total += v;
            setStats((current) => ({ ...current, postViews: total }));
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    // Polling a hidden tab burns quota and battery for numbers nobody can
    // see. Resume — and refresh once immediately — when it comes back.
    let timer: ReturnType<typeof setInterval> | null = null;

    function start() {
      if (timer || !userId) return;
      timer = setInterval(() => load(userId), REFRESH_MS);
    }
    function stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    }
    function onVisibility() {
      if (document.hidden) {
        stop();
      } else {
        if (userId) load(userId);
        start();
      }
    }

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId, load]);

  return (
    <motion.div
      className="stats-row-grid"
      variants={staggerContainer(0.07)}
      initial="hidden"
      animate="visible"
    >
      <StatTile
        icon={<MessageSquare size={13} />}
        label="Whispers"
        value={stats.totalMessages}
        delta={stats.messagesThisWeek}
        deltaLabel="this week"
        loading={loading}
        reduced={reduced}
      />
      <StatTile
        icon={<Eye size={13} />}
        label="Link Views"
        value={stats.totalViews}
        delta={stats.viewsToday}
        deltaLabel="today"
        loading={loading}
        reduced={reduced}
      />
      {/* Feed impressions. The delta is "live now" rather than a time window,
          because a post only exists for 24 hours — how many are currently earning
          views is the actionable number, and a "+N today" next to a lifetime total
          would be two different clocks in one tile. */}
      <StatTile
        icon={<BarChart3 size={13} />}
        label="Post Views"
        value={stats.postViews}
        abbreviate
        delta={stats.livePosts}
        deltaLabel={stats.livePosts === 1 ? "post live now" : "posts live now"}
        loading={loading}
        reduced={reduced}
      />
    </motion.div>
  );
}

function StatTile({
  icon,
  label,
  value,
  delta,
  deltaLabel,
  loading,
  reduced,
  abbreviate = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  delta: number;
  deltaLabel: string;
  loading: boolean;
  reduced: boolean | null;
  abbreviate?: boolean;
}) {
  return (
    <motion.div variants={staggerItem}>
      <EdgeLitCard
        radius="3xl"
        intensity={0.4}
        speed={14}
        className="h-full"
        innerClassName="h-full p-5"
      >
        <div className="flex items-center gap-1.5 eyebrow">
          {icon}
          {label}
        </div>

        {loading ? (
          <>
            <Skeleton className="mt-3" height="2.1rem" width="55%" rounded="md" />
            <Skeleton className="mt-2" height="0.7rem" width="70%" rounded="sm" />
          </>
        ) : (
          <>
              <div className="stat-value mt-2 text-white">
                <AnimatedCounter value={value} abbreviate={abbreviate} />
              </div>
            <motion.div
              // Keyed on the delta so a change re-fires the fade — the only
              // signal that the live numbers moved.
              key={delta}
              initial={reduced ? false : { opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={tween.base}
              className="mt-1.5 text-xs font-semibold"
              style={{ color: "var(--theme-accent-purple)" }}
            >
              +{delta.toLocaleString()} {deltaLabel}
            </motion.div>
          </>
        )}
      </EdgeLitCard>
    </motion.div>
  );
}
