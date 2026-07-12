"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/lib/supabase/client";
export function useRegisterPushNotifications(userId: string | null) {
  useEffect(() => {
    if (!userId) return;
    if (!Capacitor.isNativePlatform()) return;

    async function setup() {
      const permission = await PushNotifications.requestPermissions();
      if (permission.receive !== "granted") return;

      await PushNotifications.register();

      PushNotifications.addListener("registration", async (token) => {
        const platform = Capacitor.getPlatform() === "ios" ? "ios" : "android";

        const { error } = await supabase.from("device_tokens").upsert(
          {
            user_id: userId,
            fcm_token: token.value,
            platform,
          },
          { onConflict: "fcm_token" }
        );

        if (error) {
          console.error("[push] failed to save device token:", error.message);
        }
      });

      PushNotifications.addListener("registrationError", (err) => {
        console.error("[push] registration error:", err.error);
      });

      PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (action) => {
          const conversationId = action.notification.data?.conversationId;
          if (conversationId) {
            window.location.href = `/chat/${conversationId}`;
          }
        }
      );
    }

    setup();

    return () => {
      PushNotifications.removeAllListeners();
    };
  }, [userId]);
}