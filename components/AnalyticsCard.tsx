"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import SectionLoadingBar from "./SectionLoadingBar";

export default function AnalyticsCard() {
  const [stats, setStats] = useState({ messages: 0 });
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

      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("recipient_id", session.user.id);

      setStats({ messages: count || 0 });
      setLoading(false);
    }

    load();
  }, []);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
      <SectionLoadingBar loading={loading} />

      <h2 className="text-xl font-bold text-white">Your Analytics</h2>
      <div className="mt-4 text-gray-300">Total Messages Received:</div>
      <div className="mt-2 text-4xl font-black text-cyan-400">{stats.messages}</div>
    </div>
  );
}