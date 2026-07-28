"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/lib/supabase/client";

export function useRegisterPushNotifications(userId: string | null) {
  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform()) return;

    let profileSubscription: any;

    async function setup() {
      // Check initial status
      const { data: profile } = await supabase
        .from("profiles")
        .select("push_notifications")
        .eq("id", userId)
        .single();

      if (profile?.push_notifications) {
        register();
      }

      // Listen for changes to the push_notifications setting
      profileSubscription = supabase
        .channel(`profile-push-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${userId}`,
          },
          (payload) => {
            if (payload.new.push_notifications) {
              register();
            } else {
              PushNotifications.removeAllListeners();
            }
          }
        )
        .subscribe();
    }

    async function register() {
      console.log("[push] requesting permissions...");
      const permission = await PushNotifications.requestPermissions();
      if (permission.receive !== "granted") return;

      await PushNotifications.register();

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

        if (!error) {
           console.log("[push] Token saved successfully");
        } else {
           console.error("[push] Token save error:", error.message);
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
      if (profileSubscription) supabase.removeChannel(profileSubscription);
    };
  }, [userId]);
}