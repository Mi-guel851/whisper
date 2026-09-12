import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { MISSING_FUNCTION_CODES } from "./coins";
import { supabase } from "./supabase";
import { COLORS } from "@/lib/theme";

/**
 * Push notifications (FCM on Android, APNs on iOS).
 *
 * THE TOKEN GOES THROUGH AN RPC, NOT AN UPSERT
 *
 * `public.device_tokens` is keyed on the token itself, because one physical
 * device holds one FCM token and the row has to be able to change hands when a
 * second account signs in on the same phone. A client-side upsert would need an
 * RLS update policy permissive enough to rewrite a row it does not own, and the
 * only honest version of that policy lets any caller reassign any token they can
 * name. `register_device_token` assigns to `auth.uid()` and ignores anything the
 * caller might prefer, so the same job needs no such policy.
 *
 * The direct upsert is kept as a fallback for exactly one case — a deployment
 * where the migration has not been applied yet — and it is detected on the
 * function-missing code rather than on any failure, so a genuine error still
 * surfaces instead of being retried into a second, quieter failure.
 *
 * WHAT THE PUSHES CARRY
 *
 * Every server push includes a `route` (the destination the web client would
 * navigate to) plus the ids for its type. `notificationTarget` in
 * `lib/notifications.ts` turns those into a screen; `handleNotificationResponse`
 * below is the tap handler, and it is also the cold-start path.
 */

/** Foreground presentation: show the banner rather than swallowing the push. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export type PushRouteHint = {
  conversationId?: string;
  postId?: string;
  type?: string;
  route?: string;
  /** Call pushes carry the caller's identity for the ring overlay. */
  callerId?: string;
  callId?: string;
  callerName?: string | null;
  callerAvatar?: string | null;
};

/**
 * Registers this device for push, if the user has not turned pushes off.
 *
 * Returns the token that was sent to the server, or null when nothing was
 * registered — permission denied, a simulator, or the profile switch off. All
 * three are normal, so a null is not logged as an error.
 */
/**
 * Every notification subscription this module has registered.
 *
 * `expo-notifications` removes listeners one handle at a time, so they are
 * collected here — sign-out has to be able to detach all of them without
 * knowing which code path created them.
 */
const activeSubscriptions: { remove: () => void }[] = [];

export async function registerForPushNotifications(userId: string): Promise<string | null> {
  if (!Device.isDevice) {
    /* A simulator cannot receive an FCM/APNs token. Silent, because this is
       what every developer sees on their first run. */
    return null;
  }

  /* The user's own switch wins. NULL means on (`is distinct from false` in the
     triggers), and a profile row that has not loaded yet must not be read as
     "off". */
  const { data: profile } = await supabase
    .from("profiles")
    .select("push_notifications")
    .eq("id", userId)
    .maybeSingle();

  if ((profile as { push_notifications?: boolean | null } | null)?.push_notifications === false) {
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Whisper",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: COLORS.cyan,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;

  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }

  if (status !== "granted") return null;

  /* `getDevicePushTokenAsync` returns the raw FCM/APNs token the server's
     senders expect. `getExpoPushTokenAsync` would return an Expo relay token,
     which the Edge Functions cannot use — they post straight to FCM. */
  const token = await Notifications.getDevicePushTokenAsync();
  const value = token.data;

  if (typeof value !== "string" || !value) return null;

  await saveDeviceToken(value, Platform.OS === "ios" ? "ios" : "android");
  return value;
}

/** Stores the token, preferring the definer RPC over a direct upsert. */
export async function saveDeviceToken(fcmToken: string, platform: "ios" | "android"): Promise<void> {
  const { error } = await supabase.rpc("register_device_token", {
    p_fcm_token: fcmToken,
    p_platform: platform,
  });

  if (!error) return;

  if (!MISSING_FUNCTION_CODES.has(error.code ?? "")) {
    console.warn("[push] token registration failed:", error.message);
    return;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return;

  const { error: upsertError } = await supabase
    .from("device_tokens")
    .upsert({ user_id: userId, fcm_token: fcmToken, platform }, { onConflict: "fcm_token" });

  if (upsertError) {
    console.warn("[push] token registration failed on both paths:", upsertError.message);
  }
}

/** The payload a push carries, as the notification data blob. */
export function routeHintFromNotification(notification: Notifications.Notification): PushRouteHint {
  const data = (notification.request.content.data ?? {}) as Record<string, unknown>;

  return {
    conversationId: typeof data.conversationId === "string"
      ? data.conversationId
      : typeof data.conversation_id === "string"
        ? data.conversation_id
        : undefined,
    postId: typeof data.postId === "string"
      ? data.postId
      : typeof data.post_id === "string"
        ? data.post_id
        : undefined,
    type: typeof data.type === "string" ? data.type : undefined,
    route: typeof data.route === "string" ? data.route : undefined,
    callerId:
      typeof data.callerId === "string"
        ? data.callerId
        : typeof data.caller_id === "string"
          ? data.caller_id
          : undefined,
    callId:
      typeof data.callId === "string" ? data.callId : typeof data.call_id === "string" ? data.call_id : undefined,
    callerName:
      typeof data.callerName === "string"
        ? data.callerName
        : typeof data.caller_name === "string"
          ? data.caller_name
          : null,
    callerAvatar:
      typeof data.callerAvatar === "string"
        ? data.callerAvatar
        : typeof data.caller_avatar === "string"
          ? data.caller_avatar
          : null,
  };
}

/**
 * The tap handler, wired once at the root.
 *
 * Returns an unsubscribe function. `getLastNotificationResponseAsync` covers the
 * cold start: a tap that launched the app has already happened by the time this
 * runs, so the listener alone would miss it and the user would land on the feed
 * having just tapped an alert about a chat.
 */
export function handleNotificationResponse(
  handler: (hint: PushRouteHint) => void
): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    handler(routeHintFromNotification(response.notification));
  });

  activeSubscriptions.push(subscription);

  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) handler(routeHintFromNotification(response.notification));
  });

  return () => subscription.remove();
}

/** Clears the app icon badge. Called when the notifications screen is opened. */
export async function clearBadge(): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    /* Unsupported on some Android launchers; not worth surfacing. */
  }
}

/** Removes every listener this module could have registered. */
export function detachNotifications(): void {
  /* `expo-notifications` has no "remove everything" call — each subscription is
     removed through its own handle — so they are kept here as they are made.
     Clearing the badge is part of detaching: a signed-out app icon showing a
     count for an account nobody is in is a bug the user can see. */
  for (const subscription of activeSubscriptions) {
    try {
      subscription.remove();
    } catch {
      /* A subscription the OS already dropped is not worth reporting. */
    }
  }
  activeSubscriptions.length = 0;
  void clearBadge();
}

/** The app's version, for the Settings screen's About row. */
export function appVersion(): string {
  return Constants.expoConfig?.version ?? "1.0.0";
}
