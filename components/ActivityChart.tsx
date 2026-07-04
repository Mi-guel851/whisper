"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/lib/supabase/client";

type DayBucket = {
  date: string;
  label: string;
  messages: number;
  views: number;
};

function last7Days(): DayBucket[] {
  const days: DayBucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString("en-US", { weekday: "short" });
    days.push({ date, label, messages: 0, views: 0 });
  }
  return days;
}

export default function ActivityChart() {
  const [data, setData] = useState<DayBucket[]>(last7Days());
  const [userId, setUserId] = useState<string | null>(null);

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

    setData(buckets);
  }, []);

  useEffect(() => {
    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      setUserId(session.user.id);
      loadData(session.user.id);
    }
    init();
  }, [loadData]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel("activity-chart")
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

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Activity — Last 7 Days</h2>
        <div className="flex gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-cyan-300">
            <span className="h-2 w-2 rounded-full bg-cyan-400" /> Messages
          </span>
          <span className="flex items-center gap-1.5 text-purple-300">
            <span className="h-2 w-2 rounded-full bg-purple-400" /> Views
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="msgGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="viewGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="label" stroke="#666" fontSize={12} />
          <YAxis stroke="#666" fontSize={12} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: "#120021",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "12px",
              color: "#fff",
            }}
          />
          <Area
            type="monotone"
            dataKey="messages"
            stroke="#22d3ee"
            strokeWidth={2}
            fill="url(#msgGradient)"
          />
          <Area
            type="monotone"
            dataKey="views"
            stroke="#a855f7"
            strokeWidth={2}
            fill="url(#viewGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}