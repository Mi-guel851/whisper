import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { GradientButton } from "@/components/GradientButton";
import { SearchField } from "@/components/Input";
import { EmptyState, LoadingScreen, Screen } from "@/components/Screen";
import {
  acceptRequest,
  cancelRequest,
  declineRequest,
  fetchDiscoverPage,
  fetchFriendRows,
  fetchProfileByUsername,
  fetchRelatedUserIds,
  fetchRequestRows,
  openPendingThread,
  removeFriend,
  sendFriendRequest,
  startChatWithFriend,
  type FriendProfile,
  type FriendRequestRow,
  type FriendRow,
  type RelatedUserIds,
} from "@/lib/friends";
import { vibrate } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { CARD_SHADOW, COLORS, GLASS, RADIUS, TAB_BAR_SPACE, useStyles } from "@/lib/theme";

const PAGE_SIZE = 12;

type Tab = "friends" | "requests" | "discover";

type RequestEntry = { kind: "in" | "out"; row: FriendRequestRow };

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "friends", label: "Friends", icon: "people-outline" },
  { key: "requests", label: "Requests", icon: "mail-outline" },
  { key: "discover", label: "Discover", icon: "compass-outline" },
];

/**
 * Friends — the native port of the web app's `/friends` page.
 *
 * Three tabs, the same trio the web page's segmented control offers, each one
 * a view over the same two tables:
 *
 *   Friends   the accepted roster, newest friendship first, with the two
 *             actions that matter: Message (find-or-create the 1:1
 *             conversation) and Unfriend (both rows, not one).
 *   Requests  incoming (accept / decline) and outgoing (cancel / open the
 *             pending thread) — every write in the web page's sequence,
 *             including the `source: "request"` friendship rows.
 *   Discover  the id-range scan over `profiles` minus everyone you already
 *             know — friends, pending, and blocked alike.
 *
 * Live updates ride the same two realtime channels the web page subscribes
 * to: `friend_requests` (any event) and `friends` (my user_id), each rebound
 * to a full refresh, so an acceptance made on the website reorders this
 * screen without a pull-to-refresh.
 */
export default function Friends() {
  const styles = useStyles(makeStyles);
  const params = useLocalSearchParams<{ tab?: string }>();
  const { userId } = useSession();
  const { showToast } = useToast();

  const [tab, setTab] = useState<Tab>(
    params.tab === "discover" || params.tab === "requests" ? (params.tab as Tab) : "friends"
  );

  const [loading, setLoading] = useState(true);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestRow[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestRow[]>([]);
  const [people, setPeople] = useState<FriendProfile[]>([]);
  const [discoverPage, setDiscoverPage] = useState(0);
  const [hasMorePeople, setHasMorePeople] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [related, setRelated] = useState<RelatedUserIds | null>(null);
  const [handle, setHandle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadPeople = useCallback(
    async (page: number, current: RelatedUserIds | null) => {
      if (!userId || !current) return;
      setDiscoverLoading(true);
      try {
        const result = await fetchDiscoverPage(userId, page, PAGE_SIZE, current);
        setPeople(result.people);
        setHasMorePeople(result.hasMore);
        setDiscoverPage(page);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not discover people.", { variant: "error" });
      } finally {
        setDiscoverLoading(false);
      }
    },
    [showToast, userId]
  );

  const refreshAll = useCallback(async () => {
    if (!userId) return;
    try {
      const [friendRows, requests, relatedIds] = await Promise.all([
        fetchFriendRows(userId),
        fetchRequestRows(userId),
        fetchRelatedUserIds(userId),
      ]);
      setFriends(friendRows);
      setIncoming(requests.incoming);
      setOutgoing(requests.outgoing);
      setRelated(relatedIds);
      await loadPeople(discoverPage, relatedIds);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not load friends.", { variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [discoverPage, loadPeople, showToast, userId]);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void refreshAll();

      /* Listener first, then the refresh lands whenever data arrives — the
         same ordering the web page uses for its channels. */
      const requestChannel = supabase
        .channel(`friend-requests-${userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "friend_requests" }, () => {
          void refreshAll();
        })
        .subscribe();

      const friendsChannel = supabase
        .channel(`friends-${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "friends", filter: `user_id=eq.${userId}` },
          () => {
            void refreshAll();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(requestChannel);
        supabase.removeChannel(friendsChannel);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId])
  );

  const addFriend = useCallback(
    async (profileId: string) => {
      if (!userId) return;
      setBusyId(profileId);
      try {
        const result = await sendFriendRequest(userId, profileId);
        if (result.error) showToast(result.error, { variant: result.duplicate ? "subtle" : "error" });
        else showToast("Friend request sent.", { variant: "success" });
        await refreshAll();
      } finally {
        setBusyId(null);
      }
    },
    [refreshAll, showToast, userId]
  );

  const accept = useCallback(
    async (requestId: string) => {
      if (!userId) return;
      vibrate();
      setBusyId(requestId);
      try {
        const result = await acceptRequest(userId, requestId);
        if (result.error) showToast(result.error, { variant: result.gone ? "subtle" : "error" });
        else showToast("Friend added.", { variant: "success" });
        await refreshAll();
      } finally {
        setBusyId(null);
      }
    },
    [refreshAll, showToast, userId]
  );

  const decline = useCallback(
    async (requestId: string) => {
      if (!userId) return;
      setBusyId(requestId);
      try {
        const result = await declineRequest(userId, requestId);
        if (result.error) showToast(result.error, { variant: "error" });
        else showToast("Request declined.", { variant: "subtle" });
        await refreshAll();
      } finally {
        setBusyId(null);
      }
    },
    [refreshAll, showToast, userId]
  );

  const cancel = useCallback(
    async (requestId: string) => {
      if (!userId) return;
      setBusyId(requestId);
      try {
        const result = await cancelRequest(userId, requestId);
        if (result.error) showToast(result.error, { variant: "error" });
        else showToast("Request cancelled.", { variant: "subtle" });
        await refreshAll();
      } finally {
        setBusyId(null);
      }
    },
    [refreshAll, showToast, userId]
  );

  const unfriend = useCallback(
    async (friendId: string) => {
      if (!userId) return;
      setBusyId(friendId);
      try {
        const result = await removeFriend(userId, friendId);
        if (result.error) showToast(result.error, { variant: "error" });
        else showToast("Removed.", { variant: "subtle" });
        await refreshAll();
      } finally {
        setBusyId(null);
      }
    },
    [refreshAll, showToast, userId]
  );

  const message = useCallback(
    async (friendId: string) => {
      if (!userId) return;
      setBusyId(friendId);
      try {
        const result = await startChatWithFriend(userId, friendId);
        if (!result.ok || !result.conversationId) {
          if (result.error) showToast(result.error, { variant: "error" });
          return;
        }
        router.push({ pathname: "/conversation", params: { conversationId: result.conversationId } });
      } finally {
        setBusyId(null);
      }
    },
    [showToast, userId]
  );

  const openThread = useCallback(
    async (profileId: string) => {
      setBusyId(profileId);
      try {
        const result = await openPendingThread(profileId);
        if (!result.ok || !result.conversationId) {
          showToast(result.error || "Couldn't open the pending thread.", {
            variant: result.unsupported ? "subtle" : "error",
          });
          return;
        }
        router.push({ pathname: "/conversation", params: { conversationId: result.conversationId } });
      } finally {
        setBusyId(null);
      }
    },
    [showToast]
  );

  const addByHandle = useCallback(async () => {
    const profile = await fetchProfileByUsername(handle);
    if (!profile) {
      showToast("No user with that username.", { variant: "warning" });
      return;
    }
    if (profile.id === userId) {
      showToast("That's you.", { variant: "subtle" });
      return;
    }
    setHandle("");
    await addFriend(profile.id);
  }, [addFriend, handle, showToast, userId]);

  if (!userId) {
    return (
      <Screen>
        <EmptyState icon="person-circle-outline" title="Sign in" body="Sign in to see your friends." />
      </Screen>
    );
  }

  if (loading) return <LoadingScreen label="Finding people" />;

  const requestCount = incoming.length;

  return (
    <Screen edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Discover People</Text>
        <Text style={styles.subtitle}>Meet registered Whisper users anonymously.</Text>
      </View>

      <View style={styles.tabs}>
        {TABS.map(({ key, label, icon }) => {
          const on = tab === key;
          return (
            <Pressable
              key={key}
              onPress={() => {
                vibrate();
                setTab(key);
              }}
              style={[styles.tab, on && styles.tabOn]}
            >
              <Ionicons name={icon} size={15} color={on ? COLORS.text : COLORS.subtle} />
              <Text style={[styles.tabLabel, on && styles.tabLabelOn]}>{label}</Text>
              {key === "requests" && requestCount > 0 ? (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{requestCount}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {tab === "friends" ? (
        <FlatList
          data={friends}
          keyExtractor={(row) => row.id}
          contentContainerStyle={[styles.list, { paddingBottom: TAB_BAR_SPACE + 24 }]}
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title="No friends yet"
              body="Find people on the Discover tab — or share your Whisper link and let them find you."
            />
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.personRow}>
                <Avatar authorId={item.friend_id} size={44} imageUrl={item.friend?.avatar_url} />
                <View style={styles.personText}>
                  <Text style={styles.personName} numberOfLines={1}>
                    {item.friend?.display_name?.trim() || item.friend?.username || "Anonymous user"}
                  </Text>
                  <Text style={styles.personSub} numberOfLines={1}>
                    {item.friend?.username ? `@${item.friend.username}` : "Friends on Whisper"}
                  </Text>
                </View>
              </View>
              <View style={styles.actions}>
                <GradientButton
                  label={busyId === item.friend_id ? "…" : "Message"}
                  icon="chatbubble-ellipses-outline"
                  size="sm"
                  onPress={() => void message(item.friend_id)}
                  style={styles.actionBtn}
                />
                <GradientButton
                  label="Unfriend"
                  variant="glass"
                  size="sm"
                  onPress={() => void unfriend(item.friend_id)}
                  style={styles.actionBtn}
                />
              </View>
            </View>
          )}
        />
      ) : null}

      {tab === "requests" ? (
        <FlatList<RequestEntry>
          data={[...incoming.map((r) => ({ kind: "in" as const, row: r })), ...outgoing.map((r) => ({ kind: "out" as const, row: r }))]}
          keyExtractor={(entry) => entry.row.id}
          contentContainerStyle={[styles.list, { paddingBottom: TAB_BAR_SPACE + 24 }]}
          ListEmptyComponent={
            <EmptyState
              icon="mail-outline"
              title="No requests"
              body="Friend requests you receive — and ones you send — will show up here."
            />
          }
          renderItem={({ item }) => {
            const them = item.kind === "in" ? item.row.sender : item.row.receiver;
            const name = them?.display_name?.trim() || them?.username || "Anonymous user";
            const busy = busyId === item.row.id;
            return (
              <View style={styles.card}>
                <View style={styles.personRow}>
                  <Avatar
                    authorId={item.kind === "in" ? item.row.sender_id : item.row.receiver_id}
                    size={44}
                    imageUrl={them?.avatar_url}
                  />
                  <View style={styles.personText}>
                    <Text style={styles.personName} numberOfLines={1}>
                      {name}
                    </Text>
                    <Text style={styles.personSub} numberOfLines={1}>
                      {item.kind === "in" ? "Wants to be your friend" : "Waiting for a reply"}
                    </Text>
                  </View>
                </View>
                <View style={styles.actions}>
                  {item.kind === "in" ? (
                    <>
                      <GradientButton
                        label={busy ? "…" : "Accept"}
                        icon="checkmark"
                        size="sm"
                        onPress={() => void accept(item.row.id)}
                        style={styles.actionBtn}
                      />
                      <GradientButton
                        label="Decline"
                        variant="glass"
                        size="sm"
                        onPress={() => void decline(item.row.id)}
                        style={styles.actionBtn}
                      />
                    </>
                  ) : (
                    <>
                      <GradientButton
                        label="Open chat"
                        icon="chatbubble-outline"
                        size="sm"
                        onPress={() => void openThread(item.kind === "out" ? item.row.receiver_id : item.row.sender_id)}
                        style={styles.actionBtn}
                      />
                      <GradientButton
                        label="Cancel"
                        variant="glass"
                        size="sm"
                        onPress={() => void cancel(item.row.id)}
                        style={styles.actionBtn}
                      />
                    </>
                  )}
                </View>
              </View>
            );
          }}
        />
      ) : null}

      {tab === "discover" ? (
        <FlatList
          data={people}
          keyExtractor={(row) => row.id}
          contentContainerStyle={[styles.list, { paddingBottom: TAB_BAR_SPACE + 24 }]}
          ListHeaderComponent={
            <View style={styles.addRow}>
              <SearchField
                value={handle}
                onChangeText={setHandle}
                placeholder="Add by @username"
              />
              <GradientButton
                label="Add"
                icon="person-add-outline"
                size="sm"
                disabled={!handle.trim()}
                onPress={() => void addByHandle()}
                style={styles.addBtn}
              />
            </View>
          }
          ListEmptyComponent={
            discoverLoading ? (
              <View style={styles.discoverLoading}>
                <ActivityIndicator color={COLORS.cyan} />
              </View>
            ) : (
              <EmptyState
                icon="compass-outline"
                title="Nobody new here yet"
                body="You've seen everyone this scan can reach. Check back as more people join."
              />
            )
          }
          ListFooterComponent={
            hasMorePeople ? (
              <GradientButton
                label="Show more"
                variant="glass"
                loading={discoverLoading}
                onPress={() => {
                  if (related) void loadPeople(discoverPage + 1, related);
                }}
                style={styles.moreBtn}
              />
            ) : null
          }
          renderItem={({ item }) => {
            return (
              <View style={styles.card}>
                <View style={styles.personRow}>
                  <Avatar authorId={item.id} size={44} imageUrl={item.avatar_url} />
                  <View style={styles.personText}>
                    <Text style={styles.personName} numberOfLines={1}>
                      {item.display_name?.trim() || item.username || "Anonymous user"}
                    </Text>
                    <Text style={styles.personSub} numberOfLines={1}>
                      {item.username ? `@${item.username}` : item.bio || "On Whisper"}
                    </Text>
                  </View>
                </View>
                <View style={styles.actions}>
                  <GradientButton
                    label="Add friend"
                    icon="person-add-outline"
                    size="sm"
                    onPress={() => void addFriend(item.id)}
                    style={styles.actionBtn}
                  />
                  <GradientButton
                    label="Profile"
                    variant="glass"
                    size="sm"
                    onPress={() =>
                      item.username
                        ? router.push({ pathname: "/u", params: { username: item.username } })
                        : undefined
                    }
                    style={styles.actionBtn}
                  />
                </View>
              </View>
            );
          }}
        />
      ) : null}
    </Screen>
  );
}

const makeStyles = () => StyleSheet.create({
  header: { gap: 3, marginBottom: 14 },
  title: { color: COLORS.text, fontSize: 22, fontWeight: "900" },
  subtitle: { color: COLORS.muted, fontSize: 13, fontWeight: "600" },

  tabs: {
    flexDirection: "row",
    gap: 6,
    padding: 4,
    borderRadius: RADIUS.md,
    backgroundColor: "rgba(23,18,42,0.55)",
    borderWidth: 1,
    borderColor: GLASS.border,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: RADIUS.sm,
  },
  tabOn: { backgroundColor: "rgba(34,211,238,0.14)", borderWidth: 1, borderColor: "rgba(34,211,238,0.3)" },
  tabLabel: { color: COLORS.subtle, fontSize: 12.5, fontWeight: "800" },
  tabLabelOn: { color: COLORS.text },
  tabBadge: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.cyan,
  },
  tabBadgeText: { color: COLORS.contrast, fontSize: 9.5, fontWeight: "900" },

  list: { gap: 10 },
  card: {
    padding: 12,
    gap: 10,
    borderRadius: RADIUS.lg,
    backgroundColor: GLASS.background,
    borderWidth: 1,
    borderColor: GLASS.border,
    ...CARD_SHADOW,
  },
  personRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  personText: { flex: 1, gap: 1 },
  personName: { color: COLORS.text, fontSize: 14.5, fontWeight: "800" },
  personSub: { color: COLORS.muted, fontSize: 12, fontWeight: "600" },

  actions: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1 },

  addRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  addBtn: {},
  moreBtn: { marginTop: 6 },
  discoverLoading: { padding: 30, alignItems: "center" },
});
