"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Eye } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import SectionLoadingBar from "./SectionLoadingBar";
import GlassPanel from "./GlassPanel";

export default function StatsRow() {
  const [totalMessages, setTotalMessages] = useState(0);
  const [messagesThisWeek, setMessagesThisWeek] = useState(0);
  const [totalViews, setTotalViews] = useState(0);
  const [viewsToday, setViewsToday] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setLoading(false);
        return;
      }

      const uid = session.user.id;

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

      setTotalMessages(totalMsgCount || 0);
      setMessagesThisWeek(weekMsgCount || 0);
      setTotalViews(totalViewCount || 0);
      setViewsToday(todayViewCount || 0);
      setLoading(false);
    }

    load();
  }, []);

  return (
    <div className="grid grid-cols-2 gap-4">
      <GlassPanel className="rounded-3xl p-5">
        <SectionLoadingBar loading={loading} />
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-500">
          <MessageSquare size={13} />
          Whispers
        </div>
        <div className="mt-2 text-4xl font-black text-white">{totalMessages}</div>
        <div className="mt-1 text-xs font-semibold text-cyan-400">
          +{messagesThisWeek} this week
        </div>
      </GlassPanel>

      <GlassPanel className="rounded-3xl p-5">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-500">
          <Eye size={13} />
          Link Views
        </div>
        <div className="mt-2 text-4xl font-black text-white">{totalViews}</div>
        <div className="mt-1 text-xs font-semibold text-purple-400">
          +{viewsToday} today
        </div>
      </GlassPanel>
    </div>
  );
}