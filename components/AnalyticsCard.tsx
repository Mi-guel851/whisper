"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function AnalyticsCard() {
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [favorites, setFavorites] = useState(0);

  useEffect(() => {
    async function loadAnalytics() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const { data } = await supabase
        .from("messages")
        .select("is_read,favorite")
        .eq("recipient_id", session.user.id);

      if (!data) return;

      setTotal(data.length);
      setUnread(data.filter((m) => !m.is_read).length);
      setFavorites(data.filter((m) => m.favorite).length);
    }

    loadAnalytics();
  }, []);

  return (
    <div className="grid grid-cols-3 gap-4">

      <div className="rounded-3xl bg-gradient-to-r from-cyan-500 to-blue-600 p-5 text-center">
        <h2 className="text-3xl font-black text-white">{total}</h2>
        <p className="text-white/80 mt-1">Messages</p>
      </div>

      <div className="rounded-3xl bg-gradient-to-r from-purple-500 to-pink-600 p-5 text-center">
        <h2 className="text-3xl font-black text-white">{unread}</h2>
        <p className="text-white/80 mt-1">Unread</p>
      </div>

      <div className="rounded-3xl bg-gradient-to-r from-orange-500 to-red-500 p-5 text-center">
        <h2 className="text-3xl font-black text-white">{favorites}</h2>
        <p className="text-white/80 mt-1">Favorites</p>
      </div>

    </div>
  );
}