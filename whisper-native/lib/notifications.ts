import { supabase } from "./supabase";
import type { NotificationRow } from "./types";
import { COLORS } from "@/lib/theme";

/**
 * The notification history — `public.notifications`.
 *
 * This table is the durable half of the notification architecture: every push a
 * user receives is also a row here, written by a database trigger, so closing
 * the banner does not close the record. The client READS it and marks rows
 * read; it never inserts. Rows can only be produced by the server, which is
 * what makes an alert here trustworthy — nobody can forge one or edit one.
 *
 * `public_feed_notifications` is a second, feed-specific table, used for the
 * fan-out when a friend posts. Nothing in this screen reads it; the feed's own
 * realtime channel is what surfaces those, and the two would otherwise show the
 * same event twice.
 */

const COLUMNS = "id,type,title,body,metadata,is_read,created_at";

export async function fetchNotifications(userId: string, limit = 60): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []) as NotificationRow[];
}

/** Just the count, for the bell's badge. */
export async function fetchUnreadCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);

  if (error) {
    console.warn("[notifications] unread count failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

/** Marks one alert read — the only write this list makes. */
export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id);
  if (error) console.warn("[notifications] mark read failed:", error.message);
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false);

  if (error) console.warn("[notifications] mark all read failed:", error.message);
}

export async function deleteNotification(id: string): Promise<void> {
  const { error } = await supabase.from("notifications").delete().eq("id", id);
  if (error) console.warn("[notifications] delete failed:", error.message);
}

/**
 * Where an alert should take the reader.
 *
 * The server writes a `route` into `metadata` for every push
 * (`deliver_notification_push` does this so the push tap and the in-app row
 * agree), and this is the same allowlist the web client applies before
 * navigating. A handler that follows an arbitrary string out of a database row
 * is an open redirect wearing a notification — and on a phone it would be worse
 * than on the web, because the intent it launches is out of our control.
 */
export type NotificationTarget =
  | { kind: "chat"; conversationId: string }
  | { kind: "whispers" }
  | { kind: "feed"; postId: string | null }
  | { kind: "friends" }
  | { kind: "coins" }
  | { kind: "none" };

export function notificationTarget(row: NotificationRow): NotificationTarget {
  const metadata = row.metadata ?? {};
  const conversationId = metadata.conversationId ?? metadata.conversation_id;
  const postId = metadata.post_id ?? null;

  const route = typeof metadata.route === "string" ? metadata.route : null;
  if (route) {
    const parsed = targetFromRoute(route);
    if (parsed) return parsed;
  }

  switch (row.type) {
    case "message":
      /* A Missed-call alert also lands as `type = 'message'`, with the title
         the inbox filter looks for. Both go to the same thread. */
      return conversationId ? { kind: "chat", conversationId } : { kind: "whispers" };
    case "whisper":
      return { kind: "whispers" };
    case "public_feed":
    case "reply":
      return { kind: "feed", postId };
    case "friend_request":
      return { kind: "friends" };
    case "coins":
    case "coin_transfer":
      return { kind: "coins" };
    case "call":
      return conversationId ? { kind: "chat", conversationId } : { kind: "none" };
    default:
      return conversationId ? { kind: "chat", conversationId } : { kind: "none" };
  }
}

/** The route allowlist, mirroring the web client's `SAFE_ROUTE`. */
function targetFromRoute(route: string): NotificationTarget | null {
  const chat = /^\/chat\/([A-Za-z0-9-]+)/.exec(route);
  if (chat) return { kind: "chat", conversationId: chat[1] };

  if (route.startsWith("/inbox")) return { kind: "none" };
  if (route.startsWith("/notifications")) return { kind: "whispers" };
  if (route.startsWith("/friends")) return { kind: "friends" };
  if (route.startsWith("/premium")) return { kind: "coins" };

  const feed = /^\/public-feed/.exec(route);
  if (feed) {
    const postId = /[?&]post=([A-Za-z0-9-]+)/.exec(route);
    return { kind: "feed", postId: postId ? postId[1] : null };
  }

  return null;
}

/** Icon + accent per alert type, so a list of them is scannable at a glance. */
export function notificationVisual(type: string): {
  icon: string;
  accent: string;
} {
  switch (type) {
    case "whisper":
      return { icon: "chatbubble-ellipses-outline", accent: COLORS.cyan };
    case "message":
      return { icon: "mail-unread-outline", accent: COLORS.cyan };
    case "public_feed":
    case "reply":
      return { icon: "sparkles-outline", accent: COLORS.purple };
    case "friend_request":
      return { icon: "person-add-outline", accent: COLORS.purple };
    case "coin_transfer":
    case "coins":
      return { icon: "logo-bitcoin", accent: COLORS.warning };
    case "call":
      return { icon: "call-outline", accent: COLORS.success };
    default:
      return { icon: "notifications-outline", accent: COLORS.cyan };
  }
}
