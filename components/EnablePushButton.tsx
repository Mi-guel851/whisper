"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { enablePushNotifications } from "@/lib/push";
import { useToast } from "@/components/ToastProvider";

export default function EnablePushButton() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const result = await enablePushNotifications();
    setLoading(false);

    if (result.success) {
      showToast("Push notifications enabled! 🔔");
    } else if (result.reason === "denied") {
      showToast("Notifications blocked. Enable them in your browser settings.");
    } else if (result.reason === "unsupported") {
      showToast("Push notifications aren't supported on this browser.");
    } else {
      showToast("Couldn't enable notifications. Try again.");
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="flex items-center gap-2 rounded-2xl bg-white/10 px-5 py-3 font-semibold text-white hover:bg-white/20 transition disabled:opacity-60"
    >
      <Bell size={18} />
      {loading ? "Enabling..." : "Enable Notifications"}
    </button>
  );
}