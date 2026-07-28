"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { Capacitor } from "@capacitor/core";

export function FcmTokenSync() {
  useEffect(() => {
    async function syncToken() {
      if (!Capacitor.isNativePlatform()) return;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");

        const permission = await PushNotifications.requestPermissions();
        if (permission.receive !== "granted") return;

        await PushNotifications.register();

        PushNotifications.addListener("registration", async (token) => {
          console.log("FCM Token synced:", token.value);
          await supabase
            .from("profiles")
            .update({ fcm_token: token.value })
            .eq("id", session.user.id);
        });

      } catch (err) {
        console.error("FCM sync failed:", err);
      }
    }

    syncToken();
  }, []);

  return null;
}