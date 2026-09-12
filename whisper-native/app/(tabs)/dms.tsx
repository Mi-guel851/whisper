import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { SearchField } from "@/components/Input";
import { EmptyState, Screen, SkeletonRow } from "@/components/Screen";
import { refreshBadges } from "@/lib/badges";
import { UNLOCK_CHAT_COST } from "@/lib/coins";
import { fetchConversations, fetchPreviews, fetchUnreadCounts, otherParticipant } from "@/lib/dms";
import { chatListTime } from "@/lib/format";
import { vibrate } from "@/lib/haptics";
import { useAnonName } from "@/lib/identity";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { COLORS, GLASS, GRADIENT_COLORS, RADIUS, TAB_BAR_SPACE } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import type { ConversationRow, DirectMessage } from "@/lib/types";

/**
 * The inbox.
 *
 * The web app's `/inbox`: conversations, most recent first, with each row's
 * latest message and an unread count.
 *
 * THE THREE QUERIES, IN ORDER, AND WHY
 *
 *   1. `inbox_conversations()` — one call that returns the conversation, the
 *      other participant, the preview and the unread count together (202609110001).
 *   2. `inbox_message_previews(uuid[])` — when the RPC is absent, the previews
 *      for the conversation ids, over a 600-row window.
 *   3. `unread_message_counts(uuid[])` — the per-conversation unread numbers.
 *
 * Each has a table fallback inside `lib/dms.ts`, so a database that predates the
 * migrations degrades to more requests rather than an empty screen — which, on
 * a phone, is indistinguishable from a broken app.
 *
 * LOCKED CONVERSATIONS
 *
 * A conversation with someone who is not a friend costs 40 coins to open, and
 * the lock is enforced by the database, not by this list. The row shows the
 * price instead of the preview so the tap is an informed one — discovering a
 * paywall after tapping is the thing that makes people stop tapping.
 */
export default function Dms() {
  const { userId } = useSession();
  const { showToast } = useToast();

  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [previews, setPreviews] = useState<Record<string, DirectMessage>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;

    try {
      const conversations = await fetchConversations(userId);
      setRows(conversations);

      const ids = conversations.map((row) => row.id);
      const [previewMap, unreadMap] = await Promise.all([
        fetchPreviews(ids),
        fetchUnreadCounts(ids, userId),
      ]);

      setPreviews(previewMap);
      setUnread(unreadMap);

      /* Which threads are behind the 40-coin gate. TWO queries for the whole
         list, not two per row: the unlocks this user holds, and their friend
         list. The inbox is a list — an N+1 here is forty round trips on a
         screen that opens constantly. */
      const [{ data: unlocks }, { data: friendships }] = await Promise.all([
        supabase.from("chat_unlocks").select("conversation_id").eq("user_id", userId),
        supabase.from("friends").select("friend_id").eq("user_id", userId),
      ]);

      const unlockedIds = new Set(
        (unlocks ?? []).map((row) => (row as { conversation_id: string }).conversation_id)
      );
      const friendIds = new Set((friendships ?? []).map((row) => (row as { friend_id: string }).friend_id));

      const gated = new Set<string>();
      for (const conversation of conversations) {
        const other = otherParticipant(conversation, userId);
        if (!other || unlockedIds.has(conversation.id) || friendIds.has(other)) continue;
        gated.add(conversation.id);
      }

      setLocked(gated);
    } catch (error) {
      console.warn("[inbox] load failed:", error);
      showToast("Couldn't load your conversations.", { variant: "error" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Refetch on focus: a message read in a thread has to clear its badge in the
     list behind it, and coming back to a stale unread count is the most common
     way an inbox loses trust. */
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void load();
      void refreshBadges(userId);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId])
  );

  /* New messages on any of my conversations reorder the list. The channel is
     filtered client-side by the conversation set, because PostgREST's realtime
     filter cannot express "in this array". */
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`inbox-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_messages" }, (payload) => {
        const incoming = payload.new as DirectMessage;
        setPreviews((current) => ({ ...current, [incoming.conversation_id]: incoming }));
        if (incoming.sender_id !== userId) {
          setUnread((current) => ({
            ...current,
            [incoming.conversation_id]: (current[incoming.conversation_id] ?? 0) + 1,
          }));
        }
        setRows((current) => {
          const match = current.find((row) => row.id === incoming.conversation_id);
          if (!match) return current;
          const rest = current.filter((row) => row.id !== incoming.conversation_id);
          return [{ ...match, last_message_at: incoming.created_at }, ...rest];
        });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const filtered = search.trim()
    ? rows.filter((row) => {
        const other = userId ? otherParticipant(row, userId) : null;
        const preview = previews[row.id];
        const haystack = `${other ?? ""} ${preview?.content ?? ""}`.toLowerCase();
        return haystack.includes(search.trim().toLowerCase());
      })
    : rows;

  return (
    <Screen padded={false} edges={["left", "right"]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.title}>Inbox</Text>
            <Text style={styles.subtitle}>
              {rows.length === 0
                ? "Conversations live here"
                : `${rows.length} ${rows.length === 1 ? "conversation" : "conversations"}`}
            </Text>
          </View>

          <Pressable
            onPress={() => router.push("/(tabs)/notifications")}
            style={styles.whispersButton}
            accessibilityLabel="Open your whisper inbox"
          >
            <Ionicons name="mail-unread-outline" size={15} color={COLORS.cyan} />
            <Text style={styles.whispersText}>Whispers</Text>
          </Pressable>
        </View>

        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder="Search conversations"
          style={styles.search}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={COLORS.cyan}
            colors={[COLORS.cyan, COLORS.purple]}
            progressBackgroundColor={COLORS.surface}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        renderItem={({ item }) => (
          <ConversationRowItem
            conversation={item}
            myId={userId ?? ""}
            preview={previews[item.id]}
            unreadCount={unread[item.id] ?? 0}
            locked={locked.has(item.id)}
            onPress={() => {
              vibrate("tap");
              const other = userId ? otherParticipant(item, userId) : null;
              router.push({
                pathname: "/conversation",
                params: { conversationId: item.id, ...(other ? { otherId: other } : {}) },
              });
            }}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <View>
              <SkeletonRow height={78} />
              <SkeletonRow height={78} />
              <SkeletonRow height={78} />
              <SkeletonRow height={78} />
            </View>
          ) : search.trim() ? (
            <EmptyState
              icon="search-outline"
              title="Nothing matches"
              body={`No conversation mentions “${search.trim()}”.`}
            />
          ) : (
            <EmptyState
              icon="chatbubbles-outline"
              title="No conversations yet"
              body="When someone replies to your whisper, or you start a chat from a profile, it shows up here."
            />
          )
        }
      />
    </Screen>
  );
}

function ConversationRowItem({
  conversation,
  myId,
  preview,
  unreadCount,
  locked,
  onPress,
}: {
  conversation: ConversationRow;
  myId: string;
  preview?: DirectMessage;
  unreadCount: number;
  locked: boolean;
  onPress: () => void;
}) {
  const other = otherParticipant(conversation, myId) ?? "";
  const name = useAnonName(other);

  const body = preview?.content?.trim()
    ? preview.content
    : preview?.audio_path
      ? "Voice note"
      : preview?.image_path
        ? "Photo"
        : preview?.media_kind === "sticker"
          ? "Sticker"
          : preview?.media_kind === "gif"
            ? "GIF"
            : "No messages yet";

  const mine = preview?.sender_id === myId;
  const when = conversation.last_message_at ?? conversation.latest_message_at ?? null;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Conversation with ${name}`}>
      <BlurView
        intensity={GLASS.blurIntensity}
        tint="dark"
        style={[styles.row, unreadCount > 0 && styles.rowUnread]}
      >
        <View style={styles.rowInner}>
          <Avatar authorId={other} size={50} />

          <View style={styles.rowText}>
            <View style={styles.rowTop}>
              <Text style={styles.rowName} numberOfLines={1}>
                {name}
              </Text>
              {when ? <Text style={styles.rowWhen}>{chatListTime(when)}</Text> : null}
            </View>

            {locked ? (
              <View style={styles.lockedRow}>
                <Ionicons name="lock-closed" size={12} color={COLORS.purple} />
                <Text style={styles.lockedText}>Locked · unlock for {UNLOCK_CHAT_COST} coins</Text>
              </View>
            ) : (
              <View style={styles.previewRow}>
                {mine ? <Text style={styles.minePrefix}>You: </Text> : null}
                <Text style={[styles.rowPreview, unreadCount > 0 && styles.rowPreviewUnread]} numberOfLines={1}>
                  {body}
                </Text>
              </View>
            )}
          </View>

          {unreadCount > 0 && (
            <LinearGradient
              colors={GRADIENT_COLORS}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.unreadPill}
            >
              <Text style={styles.unreadText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
            </LinearGradient>
          )}
        </View>
      </BlurView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  headerTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  title: { color: COLORS.text, fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
  subtitle: { color: COLORS.muted, fontSize: 12.5, fontWeight: "600", marginTop: 3 },
  whispersButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(34,211,238,0.12)",
  },
  whispersText: { color: COLORS.cyan, fontSize: 12, fontWeight: "800" },
  search: { marginTop: 14 },
  list: { paddingHorizontal: 16, paddingBottom: TAB_BAR_SPACE + 24 },

  row: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.5)",
    marginBottom: 10,
    overflow: "hidden",
  },
  rowUnread: { borderColor: "rgba(34,211,238,0.3)" },
  rowInner: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  rowText: { flex: 1, gap: 4 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowName: { color: COLORS.text, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  rowWhen: { color: COLORS.subtle, fontSize: 11, fontWeight: "700" },
  previewRow: { flexDirection: "row", alignItems: "center" },
  minePrefix: { color: COLORS.subtle, fontSize: 13 },
  rowPreview: { color: COLORS.muted, fontSize: 13.5, flexShrink: 1 },
  rowPreviewUnread: { color: COLORS.text, fontWeight: "600" },
  lockedRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  lockedText: { color: COLORS.purple, fontSize: 12.5, fontWeight: "700" },
  unreadPill: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadText: { color: "#0a0814", fontSize: 11, fontWeight: "900" },
});
