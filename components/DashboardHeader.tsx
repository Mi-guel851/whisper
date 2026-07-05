"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Bell } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { enablePushNotifications } from "@/lib/push";
import { useToast } from "@/components/ToastProvider";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardHeader() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const { data } = await supabase
        .from("profiles")
        .select("display_name, username")
        .eq("id", session.user.id)
        .single();

      if (data) {
        setName(data.display_name || data.username || "");
      }
    }
    load();
  }, []);

  async function handleNotifyClick() {
    console.log("[header] Notify button clicked");
    setLoading(true);
    const result = await enablePushNotifications();
    console.log("[header] result:", result);
    setLoading(false);

    if (result.success) {
      showToast("Push notifications enabled! 🔔");
    } else if (result.reason === "denied") {
      showToast("Notifications blocked. Enable them in your browser settings.");
    } else if (result.reason === "unsupported") {
      showToast("Push notifications aren't supported on this browser.");
    } else {
      showToast(`Couldn't enable notifications (${result.reason}).`);
    }
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-gray-500">
          {getGreeting()}
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-3xl font-black text-white">
          Hey, {name || "there"}
          <Image src="/ghost.png" alt="Whisper" width={28} height={28} />
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          Your inbox is open. Whispers welcome.
        </p>
      </div>

      <button
        onClick={handleNotifyClick}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
      >
        <Bell size={15} />
        {loading ? "Enabling..." : "Notify"}
      </button>
    </div>
  );
}