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
          /* Every push type deep-links to its own surface. `notify-on-notification`
             stringifies the trigger's whole metadata into `data`, so the
             destination is already in the payload — this just has to read it:
             `route` is what the triggers set explicitly (feed, calls, whispers),
             and the per-type fallbacks below cover anything that predates it.
               message        → /chat/{conversation_id} (the thread itself)
               whisper        → /notifications (the whisper inbox)
               feed           → /public-feed?post={postId} (highlighted)
               friend_request → /friends
               coins          → /premium (the wallet lives there)
               call           → /chat/{conversation_id} + the ring overlay,
                                triggered immediately via the pending-call stash
             This listener is also the iOS tap path: the Capacitor plugin owns
             the native notification center delegate, so a tap on either
             platform lands here rather than in AppDelegate — see the "Push
             notification deep links" note in ios/App/App/AppDelegate.swift. */
          const data = (action.notification.data ?? {}) as Record<string, string>;
          const conversationId = data.conversationId || data.conversation_id;
          const postId = data.postId || data.post_id;
          const type = data.type || "";

          /* `route` is server-provided, but a tap handler that navigates to an
             arbitrary string is an open redirect wearing a push notification —
             so it is allowlisted to the app's own surfaces before use. */
          const SAFE_ROUTE =
            /^\/(chat\/[A-Za-z0-9-]+|inbox|friends|notifications|premium|public-feed|dashboard)(\?[A-Za-z0-9_\-=&%.]*)?$/;
          const routed = typeof data.route === "string" && SAFE_ROUTE.test(data.route) ? data.route : null;

          let destination: string | null = routed;
          if (!destination) {
            switch (type) {
              case "message":
                destination = conversationId ? `/chat/${conversationId}` : "/inbox";
                break;
              case "whisper":
                destination = "/notifications";
                break;
              case "feed":
              case "reply":
              case "public_feed":
                destination = postId ? `/public-feed?post=${postId}` : "/public-feed";
                break;
              case "friend_request":
                destination = "/friends";
                break;
              case "coins":
              case "coin_transfer":
                destination = "/premium";
                break;
              case "call":
                destination = conversationId ? `/chat/${conversationId}` : "/inbox";
                break;
              default:
                destination = conversationId ? `/chat/${conversationId}` : null;
                break;
            }
          }

          /* A call tap rings immediately. The stash survives the full-document
             load below (same tab, sessionStorage), so a cold-started app opens
             the overlay on mount; the event covers the warm case, where the
             app is already open and the overlay should appear without waiting
             for the realtime socket to resubscribe. Both are read by
             components/calls/GlobalCallListener. */
          if (type === "call" && conversationId) {
            const pending = {
              conversationId,
              callerId: data.caller_id || data.callerId || null,
              callId: data.callId || data.call_id || null,
              at: Date.now(),
            };
            try {
              sessionStorage.setItem("whisper:pending-call", JSON.stringify(pending));
            } catch {
              /* Private mode — the event below still covers the warm case. */
            }
            window.dispatchEvent(
              new CustomEvent("whisper:incoming-call", { detail: pending })
            );
          }

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