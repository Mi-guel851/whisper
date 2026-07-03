"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function NotificationCard() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    async function loadNotifications() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const { data } = await supabase
        .from("messages")
        .select("id")
        .eq("recipient_id", session.user.id)
        .eq("is_read", false);

      setCount(data?.length || 0);
    }

    loadNotifications();
  }, []);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/10 backdrop-blur-xl p-6">

      <div className="flex items-center justify-between">

        <div>
          <h2 className="text-2xl font-bold text-white">
            Notifications
          </h2>

          <p className="text-gray-400">
            Unread anonymous messages
          </p>
        </div>

        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-3xl font-black text-white">
          {count}
        </div>

      </div>

    </div>
  );
}