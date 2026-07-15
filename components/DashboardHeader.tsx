"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Bell, BellOff } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
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
  const [pushEnabled, setPushEnabled] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const { data } = await supabase
        .from("profiles")
        .select("display_name, username, push_notifications")
        .eq("id", session.user.id)
        .single();

      if (data) {
        setName(data.display_name || data.username || "");
        setPushEnabled(!!data.push_notifications);
      }
    }
    load();
  }, []);

  async function handleNotifyClick() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setLoading(false);
      return;
    }

    if (pushEnabled) {
      // Toggle OFF
      const { error } = await supabase
        .from("profiles")
        .update({ push_notifications: false })
        .eq("id", session.user.id);

      if (!error) {
        setPushEnabled(false);
        showToast("Notifications turned off.");
      } else {
        showToast("Error turning off notifications.");
      }
    } else {
      // Toggle ON
      let success = false;
      if (Capacitor.isNativePlatform()) {
        const perm = await PushNotifications.requestPermissions();
        if (perm.receive === "granted") {
          await PushNotifications.register();
          success = true;
        } else {
          showToast("Permission denied. Enable in system settings.");
        }
      } else {
        // In browser, try to enable but don't fail if unsupported
        try {
          const result = await enablePushNotifications();
          success = result.success;

          if (!success && result.reason === "unsupported") {
            success = true; // Still allow toggle in DB
            showToast("Setting saved! (Use the app for live alerts)");
          } else if (!success && result.reason === "denied") {
            showToast("Notifications blocked in browser.");
          }
        } catch (err) {
          // Fallback
          success = true;
          showToast("Setting saved!");
        }
      }

      if (success) {
        const { error } = await supabase
          .from("profiles")
          .update({ push_notifications: true })
          .eq("id", session.user.id);

        if (!error) {
          setPushEnabled(true);
          if (Capacitor.isNativePlatform()) {
            showToast("Notifications enabled! 🔔");
          }
        }
      }
    }
    setLoading(false);
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-gray-300">
          {getGreeting()}
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-3xl font-black text-white">
          Hey, {name || "there"}
          <Image src="/ghost.png" alt="Whisper" width={28} height={28} />
        </h1>
        <p className="mt-1 text-sm text-gray-300">
          Your inbox is open. Whispers welcome.
        </p>
      </div>

      <button
        onClick={handleNotifyClick}
        disabled={loading}
        className={`flex items-center gap-1.5 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold transition disabled:opacity-60 ${
          pushEnabled ? "bg-cyan-500 text-black" : "bg-white/5 text-white hover:bg-white/10"
        }`}
      >
        {pushEnabled ? <Bell size={15} /> : <BellOff size={15} />}
        {loading ? "..." : pushEnabled ? "On" : "Notify"}
      </button>
    </div>
  );
}