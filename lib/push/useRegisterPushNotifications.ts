"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/lib/supabase/client";

/**
 * Registering a device for push.
 *
 * WHERE THE TOKEN GOES, AND WHY THROUGH AN RPC
 *
 * `public.device_tokens`, keyed on the token itself — one physical device holds
 * one FCM token, so the token is the natural key and the row has to be able to
 * change hands when a second account signs in on the same phone.
 *
 * That last part is why this calls `register_device_token` instead of upserting
 * directly. A client-side upsert needs an RLS update policy permissive enough to
 * rewrite a row it does not own, and the only honest version of that policy lets
 * any caller reassign any token they can name. The definer function assigns to
 * `auth.uid()` and ignores anything the caller might prefer, so the same job
 * needs no such policy — see 202608230001_device_tokens.sql.
 *
 * The direct upsert is kept as a fallback for exactly one case: a deployment
 * where the migration has not been applied yet. Detected on the function-missing
 * code rather than on any failure, so a genuine error still surfaces instead of
 * being retried into a second, quieter failure.
 */
const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

async function saveToken(fcmToken: string, platform: "ios" | "android") {
  const { error } = await supabase.rpc("register_device_token", {
    p_fcm_token: fcmToken,
    p_platform: platform,
  });

  if (!error) return;

  if (!MISSING_FUNCTION.has(error.code ?? "")) {
    console.error("[push] token registration failed:", error.message);
    return;
  }

  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id;
  if (!uid) return;

  const { error: upsertError } = await supabase
    .from("device_tokens")
    .upsert({ user_id: uid, fcm_token: fcmToken, platform }, { onConflict: "fcm_token" });

  if (upsertError) {
    console.error(
      "[push] token registration failed on both paths — apply supabase/migrations/202608230001_device_tokens.sql:",
      upsertError.message
    );
  }
}

export function useRegisterPushNotifications(userId: string | null) {
  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform()) return;

    let profileSubscription: ReturnType<typeof supabase.channel> | null = null;

    async function setup() {
      const { data: profile } = await supabase
        .from("profiles")
        .select("push_notifications")
        .eq("id", userId)
        .single();

      // 👇 Register if push_notifications is true OR null/undefined (default to on)
      if (profile?.push_notifications !== false) {
        register();
      }

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
            if (payload.new.push_notifications !== false) {
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
        const platform = Capacitor.getPlatform() === "ios" ? "ios" : "android";
        await saveToken(token.value, platform);
      });

      PushNotifications.addListener("registrationError", (err) => {
        console.error("[push] registration error:", err.error);
      });

      PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (action) => {
          /* Only chat was handled here, so tapping a friend request or a feed
             post from the tray landed the user wherever they already were —
             which reads as a notification that does nothing.
             `notify-on-notification` stringifies the trigger's whole metadata
             into `data`, so the destination is already in the payload; this just
             has to read it. `route` is what the feed trigger sets explicitly,
             and the per-type fallbacks cover the triggers that predate it. */
          const data = (action.notification.data ?? {}) as Record<string, string>;
          const conversationId = data.conversationId || data.conversation_id;

          const destination =
            data.route ||
            (conversationId
              ? `/chat/${conversationId}`
              : data.type === "friend_request"
                ? "/friends"
                : data.type === "feed"
                  ? "/public-feed"
                  : data.type === "whisper" || data.type === "message"
                    ? "/inbox"
                    : null);

          /* A full document load rather than a router push: the handler can fire
             while the WebView is being resumed from a cold start, before React
             has a router to push onto. */
          if (destination) window.location.href = destination;
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