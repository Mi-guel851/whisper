"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { MessageSquare, Eye } from "lucide-react";
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
};

const EMPTY: Stats = {
  totalMessages: 0,
  messagesThisWeek: 0,
  totalViews: 0,
  viewsToday: 0,
};

export default function StatsRow() {
  const [stats, setStats] = useState<Stats>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const reduced = useSafeReducedMotion();

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
    ]);

    if (!alive.current) return;

    setStats({
      totalMessages: totalMsgCount || 0,
      messagesThisWeek: weekMsgCount || 0,
      totalViews: totalViewCount || 0,
      viewsToday: todayViewCount || 0,
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
      className="grid grid-cols-2 gap-4"
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
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  delta: number;
  deltaLabel: string;
  loading: boolean;
  reduced: boolean | null;
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
              <AnimatedCounter value={value} />
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
