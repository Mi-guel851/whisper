import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { GlassCard } from "@/components/GlassCard";
import { GradientText } from "@/components/GradientText";
import { fetchNotifications, markNotificationRead, notificationVisual } from "@/lib/notifications";
import { useSession } from "@/lib/session";
import { COLORS, RADIUS } from "@/lib/theme";
import type { NotificationRow } from "@/lib/types";
import { shortDate } from "@/lib/format";

/**
 * Notifications.
 *
 * Lists notifications from Supabase `notifications` table as glass cards. Tapping
 * marks the row read. Empty state when nothing there.
 */
export default function NotificationsScreen() {
  const { userId } = useSession();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const rows = await fetchNotifications(userId);
      setItems(rows);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleTap = async (item: NotificationRow) => {
    if (!item.is_read) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)));
      await markNotificationRead(item.id);
    }
    // Navigate based on type
    const target = notificationRouter(item);
    if (target) router.push(target as any);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <GradientText style={styles.title}>Activity</GradientText>
        <Text style={styles.subtitle}>Your notifications</Text>
      </View>

      {loading && items.length === 0 ? (
        <Text style={styles.loadingText}>Loading...</Text>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="notifications-off-outline" size={52} color={COLORS.subtle} />
          <Text style={styles.emptyTitle}>No notifications yet</Text>
          <Text style={styles.emptyBody}>You'll see activity here.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeIn.delay(index * 40).duration(260)}>
              <Pressable onPress={() => handleTap(item)}>
                <GlassCard
                  radius={RADIUS.xl}
                  strong={!item.is_read}
                  style={[styles.card, !item.is_read && styles.unreadCard]}
                >
                  <View style={styles.cardRow}>
                    <View
                      style={[
                        styles.iconWrap,
                        { backgroundColor: `${notificationVisual(item.type).accent}22` },
                      ]}
                    >
                      <Ionicons
                        name={notificationVisual(item.type).icon as any}
                        size={20}
                        color={notificationVisual(item.type).accent}
                      />
                    </View>
                    <View style={styles.cardBody}>
                      <Text style={[styles.cardTitle, !item.is_read && { color: COLORS.text }]}>
                        {item.title}
                      </Text>
                      {item.body ? (
                        <Text style={styles.cardBodyText} numberOfLines={2}>
                          {item.body}
                        </Text>
                      ) : null}
                      <Text style={styles.cardDate}>{shortDate(item.created_at)}</Text>
                    </View>
                    {!item.is_read && <View style={styles.dot} />}
                  </View>
                </GlassCard>
              </Pressable>
            </Animated.View>
          )}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 100 }}
        />
      )}
    </View>
  );
}

function notificationRouter(item: NotificationRow): string | null {
  const meta = item.metadata ?? {};
  const cid = meta.conversation_id ?? meta.conversationId;
  if (cid) return `/conversation?conversationId=${cid}`;
  if (item.type === "coin_transfer" || item.type === "coins") return "/coins";
  if (item.type === "public_feed" || item.type === "reply") {
    const postId = meta.post_id;
    if (postId) return `/whisper-detail?postId=${postId}`;
  }
  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 8 },
  title: { fontSize: 28, letterSpacing: 1 },
  subtitle: { color: COLORS.muted, fontSize: 14, marginTop: 2 },
  loadingText: { color: COLORS.muted, textAlign: "center", marginTop: 40 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 10 },
  emptyTitle: { color: COLORS.text, fontSize: 18, fontWeight: "800", marginTop: 12 },
  emptyBody: { color: COLORS.muted, fontSize: 14 },
  card: { opacity: 1 },
  unreadCard: { borderColor: "rgba(34,211,238,0.35)" },
  cardRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { color: COLORS.text, fontSize: 14.5, fontWeight: "800" },
  cardBodyText: { color: COLORS.muted, fontSize: 13, lineHeight: 18 },
  cardDate: { color: COLORS.subtle, fontSize: 11, fontWeight: "600", marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.cyan, marginTop: 6 },
});
