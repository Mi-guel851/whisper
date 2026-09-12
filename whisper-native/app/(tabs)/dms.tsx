import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { GlassCard } from "@/components/GlassCard";
import { GradientText } from "@/components/GradientText";
import { InlineLoader } from "@/components/Screen";
import { GlassRow } from "@/components/GlassCard";
import { fetchConversations, fetchPreviews, fetchUnreadCounts, otherParticipant } from "@/lib/dms";
import { chatListTime } from "@/lib/format";
import { fetchProfile } from "@/lib/profile";
import { useSession } from "@/lib/session";
import type { ConversationRow, DirectMessage } from "@/lib/types";
import { COLORS, RADIUS } from "@/lib/theme";
import { useAnonName } from "@/lib/identity";

/**
 * DMs list.
 *
 * Glass card per conversation, avatar, last message preview, timestamp. Tapping
 * opens /conversation.
 */
export default function DMsScreen() {
  const { userId } = useSession();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [previews, setPreviews] = useState<Record<string, DirectMessage>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const rows = await fetchConversations(userId);
      setConversations(rows);
      const ids = rows.map((c) => c.id);
      const pv = await fetchPreviews(ids);
      setPreviews(pv);
      const counts = await fetchUnreadCounts(ids, userId);
      setUnread(counts);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const openConversation = (id: string) => {
    router.push({ pathname: "/conversation", params: { conversationId: id } });
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <GradientText style={styles.title}>Chats</GradientText>
        <Text style={styles.subtitle}>Your anonymous conversations</Text>
      </View>

      {loading ? (
        <InlineLoader label="Loading chats..." />
      ) : conversations.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="chatbubbles-outline" size={52} color={COLORS.subtle} />
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptyBody}>Anyone who whispers you shows up here.</Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <ConversationRow
              conversation={item}
              myId={userId ?? ""}
              preview={previews[item.id]}
              unreadCount={unread[item.id] ?? 0}
              onPress={() => openConversation(item.id)}
            />
          )}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}
    </View>
  );
}

function ConversationRow({
  conversation,
  myId,
  preview,
  unreadCount,
  onPress,
}: {
  conversation: ConversationRow;
  myId: string;
  preview?: DirectMessage;
  unreadCount: number;
  onPress: () => void;
}) {
  const otherId = otherParticipant(conversation, myId);
  const name = useAnonName(otherId);
  const timestamp = preview?.created_at ?? conversation.last_message_at;
  const lastText = preview?.content ?? "Tap to open the conversation";
  const isMine = preview?.sender_id === myId;

  return (
    <Pressable onPress={onPress}>
      <GlassCard radius={RADIUS.xl} style={{ padding: 14 }}>
        <View style={styles.row}>
          <Avatar authorId={otherId} size={48} />
          <View style={styles.rowBody}>
            <View style={styles.rowTop}>
              <Text style={styles.rowName} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.rowTime}>{chatListTime(timestamp)}</Text>
            </View>
            <View style={styles.rowBottom}>
              <Text
                style={[styles.rowPreview, unreadCount > 0 && { color: COLORS.text, fontWeight: "700" }]}
                numberOfLines={1}
              >
                {isMine ? "You: " : ""}{lastText}
              </Text>
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 8 },
  title: { fontSize: 28, letterSpacing: 1 },
  subtitle: { color: COLORS.muted, fontSize: 14, marginTop: 2 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 10 },
  emptyTitle: { color: COLORS.text, fontSize: 18, fontWeight: "800", marginTop: 12 },
  emptyBody: { color: COLORS.muted, fontSize: 14, textAlign: "center" },
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowName: { color: COLORS.text, fontSize: 15, fontWeight: "800", flex: 1 },
  rowTime: { color: COLORS.subtle, fontSize: 11, fontWeight: "600" },
  rowBottom: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  rowPreview: { color: COLORS.muted, fontSize: 13, flex: 1 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.cyan,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: { color: "#0a0814", fontSize: 11, fontWeight: "900" },
});
