import { supabase } from "@/lib/supabase/client";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function enablePushNotifications() {
  console.log("[push] enablePushNotifications called");

  try {
    if (typeof window === "undefined") return { success: false, reason: "no-window" };

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      console.log("[push] unsupported browser");
      return { success: false, reason: "unsupported" };
    }

    console.log("[push] requesting permission...");
    const permission = await Notification.requestPermission();
    console.log("[push] permission result:", permission);

    if (permission !== "granted") {
      return { success: false, reason: "denied" };
    }

    console.log("[push] registering service worker...");
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    console.log("[push] service worker ready");

    const existing = await registration.pushManager.getSubscription();

    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
      console.error("[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing!");
      return { success: false, reason: "missing-vapid-key" };
    }

    const subscription =
      existing ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        ),
      }));

    console.log("[push] subscription obtained:", subscription.endpoint);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) return { success: false, reason: "no-session" };

    const json = subscription.toJSON();

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: session.user.id,
        endpoint: json.endpoint!,
        p256dh: json.keys!.p256dh,
        auth: json.keys!.auth,
      },
      { onConflict: "endpoint" }
    );

    if (error) {
      console.error("[push] supabase upsert error:", error.message);
      return { success: false, reason: error.message };
    }

    console.log("[push] success!");
    return { success: true };
  } catch (err) {
    console.error("[push] threw an exception:", err);
    return { success: false, reason: "exception" };
  }
}