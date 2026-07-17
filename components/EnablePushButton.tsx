"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/lib/supabase/client";
import { enablePushNotifications } from "@/lib/push";
import { useToast } from "@/components/ToastProvider";

export default function EnablePushButton() {
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  async function handleEnable() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setLoading(false);
      return;
    }

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
      const result = await enablePushNotifications();
      success = result.success;

      if (!success && result.reason === "unsupported") {
        success = true;
        showToast("Setting saved! (Use the app for live alerts)");
      } else if (!success && result.reason === "denied") {
        showToast("Notifications blocked in browser.");
      }
    }

    if (success) {
      const { error } = await supabase
        .from("profiles")
        .update({ push_notifications: true })
        .eq("id", session.user.id);

      if (!error) {
        showToast("Notifications enabled! 🔔");
      }
    }
    setLoading(false);
  }

  return (
    <button
      onClick={handleEnable}
      disabled={loading}
      className="flex items-center gap-2 rounded-xl bg-white/10 p-4 font-bold text-white hover:bg-white/20 transition disabled:opacity-50"
    >
      <Bell size={20} />
      {loading ? "Enabling..." : "Enable Push Notifications"}
    </button>
  );
}