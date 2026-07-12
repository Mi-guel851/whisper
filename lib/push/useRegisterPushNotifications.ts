"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/lib/supabase/client";

export function useRegisterPushNotifications(userId: string | null) {
  useEffect(() => {
    console.log("[push] effect ran. userId:", userId, "isNative:", Capacitor.isNativePlatform(), "platform:", Capacitor.getPlatform());

    if (!userId) {
      console.log("[push] stopping: no userId");
      return;
    }
    if (!Capacitor.isNativePlatform()) {
      console.log("[push] stopping: not native platform");
      return;
    }

    async function setup() {
      console.log("[push] requesting permissions...");
      const permission = await PushNotifications.requestPermissions();
      console.log("[push] permission result:", permission.receive);
      if (permission.receive !== "granted") return;

      await PushNotifications.register();
      console.log("[push] register() called");

      PushNotifications.addListener("registration", async (token) => {
        console.log("[push] got token:", token.value);
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