"use client";

import { useEffect, useState, useCallback } from "react";
import { TrendingUp } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  Tooltip,
} from "recharts";
import { supabase } from "@/lib/supabase/client";
import SectionLoadingBar from "./SectionLoadingBar";
import GlassPanel from "./GlassPanel";

type DayBucket = {
  date: string;
  label: string;
  messages: number;
  views: number;
  total: number;
};

function last7Days(): DayBucket[] {
  const days: DayBucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString("en-US", { weekday: "short" });
    days.push({ date, label, messages: 0, views: 0, total: 0 });
  }
  return days;
}

function calcTrend(buckets: DayBucket[]): number {
  const firstHalf = buckets.slice(0, 3).reduce((s, b) => s + b.total, 0);
  const secondHalf = buckets.slice(4).reduce((s, b) => s + b.total, 0);
  if (firstHalf === 0) return secondHalf > 0 ? 100 : 0;
  return Math.round(((secondHalf - firstHalf) / firstHalf) * 100);
}

export default function ActivityChart() {
  const [data, setData] = useState<DayBucket[]>(last7Days());
  const [trend, setTrend] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadData = useCallback(async (uid: string) => {
    const buckets = last7Days();
    const since = buckets[0].date;

    const [{ data: messages }, { data: views }] = await Promise.all([
      supabase
        .from("messages")
        .select("created_at")
        .eq("recipient_id", uid)
        .gte("created_at", since),
      supabase
        .from("profile_views")
        .select("created_at")
        .eq("profile_id", uid)
        .gte("created_at", since),
    ]);

    messages?.forEach((m) => {
      const day = m.created_at.slice(0, 10);
      const bucket = buckets.find((b) => b.date === day);
      if (bucket) bucket.messages += 1;
    });

    views?.forEach((v) => {
      const day = v.created_at.slice(0, 10);
      const bucket = buckets.find((b) => b.date === day);
      if (bucket) bucket.views += 1;
    });

    buckets.forEach((b) => (b.total = b.messages + b.views));

    setData(buckets);
    setTrend(calcTrend(buckets));
    setLastUpdated(new Date());
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
      loadData(session.user.id);
    }
    init();
  }, [loadData]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`activity-chart-${userId}-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `recipient_id=eq.${userId}`,
        },
        () => loadData(userId)
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "profile_views",
          filter: `profile_id=eq.${userId}`,
        },
        () => loadData(userId)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, loadData]);

  useEffect(() => {
    if (!userId) return;
    const refreshTimer = setInterval(() => loadData(userId), 4_000);
    return () => clearInterval(refreshTimer);
  }, [userId, loadData]);

  return (
    <GlassPanel className="rounded-3xl p-6">
      <SectionLoadingBar loading={loading} />

      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-gray-300">
            Last 7 Days
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h2 className="text-xl font-bold text-white">Engagement is climbing</h2>
            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live
            </span>
          </div>
          {lastUpdated && (
            <p className="mt-1 text-[10px] text-gray-500">
              Updated {lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </p>
          )}
        </div>

        {trend !== 0 && (
          <div
            className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-black ${
              trend > 0
                ? "bg-cyan-400/20 text-cyan-400"
                : "bg-red-400/15 text-red-300"
            }`}
          >
            <TrendingUp size={13} />
            {trend > 0 ? "+" : ""}
            {trend}%
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data} margin={{ top: 20, left: 0, right: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.5} />
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" hide />
          <Tooltip
            contentStyle={{
              background: "#1a1a1a",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "12px",
              color: "#fff",
            }}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke="#22d3ee"
            strokeWidth={3}
            fill="url(#totalGradient)"
            isAnimationActive
            animationDuration={1200}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </GlassPanel>
  );
}