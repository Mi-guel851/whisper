"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Bell } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/lib/supabase/client";
import { enablePushNotifications } from "@/lib/push";
import { useToast } from "@/components/ToastProvider";
import Button from "./Button";
import StreakChip from "./StreakChip";

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

            // Manually update the DB since we're exiting early
            await supabase
              .from("profiles")
              .update({ push_notifications: true })
              .eq("id", session.user.id);
            setPushEnabled(true);
            setLoading(false);
            return;
          } else if (!success && result.reason === "denied") {
            showToast("Notifications blocked in browser.");
          }
        } catch {
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
    <div className="flex items-center justify-between gap-3">
      {/* min-w-0 is what lets the truncate below engage: a flex child defaults to
          min-content width, so without it a long display name would push the
          controls off the right edge instead of clipping itself. */}
      <div className="min-w-0 flex-1">
        <p className="eyebrow text-gray-300">{getGreeting()}</p>
        <h1 className="page-title mt-1 flex items-center gap-2 text-white">
          <span className="truncate">Hey, {name || "there"}</span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-purple-600 shadow-sm">
            <Image src="/ghost.png" alt="Whisper" width={18} height={18} />
          </span>
        </h1>
        <p className="page-subtitle mt-1">
          Your inbox is open. Whispers welcome.
        </p>
      </div>

      {/* Was a hand-rolled pill hardcoding `bg-white/5 text-white` — invisible
          on a light canvas. `Button` carries the theme-aware variants, the
          press spring, and the ripple, so the toggle presses like every other
          control instead of being the one dead target on the screen. */}
      <div className="flex shrink-0 items-center gap-2">
        {/* The streak reads as status, so it lives in the chrome rather than as
            another card in an already-dense dashboard column. It renders nothing
            while the first read is in flight, so this group is one control wide
            until the streak answers. */}
        <StreakChip />
        {/* The NotificationBell that used to sit here is gone deliberately. Two
            bells side by side — one a link to the activity feed, one a
            permissions toggle — meant the more important of the two (the toggle,
            which is the only thing that makes alerts arrive at all) was
            competing with a link for the same glance. The activity feed is still
            one tap away from RecentMessages' "See all" on this same screen, so
            nothing became unreachable. */}
        <Button
          variant={pushEnabled ? "primary" : "secondary"}
          size="sm"
          className="shrink-0 rounded-full"
          onClick={handleNotifyClick}
          loading={loading}
          aria-pressed={pushEnabled}
          icon={<Bell size={15} fill={pushEnabled ? "currentColor" : "none"} />}
        >
          {pushEnabled ? "On" : "Notify"}
        </Button>
      </div>
    </div>
  );
}