import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { ConfirmSheet, Sheet, SheetRow } from "@/components/Sheet";
import { EmptyState, Screen, SkeletonRow } from "@/components/Screen";
import { WhisperCard } from "@/components/WhisperCard";
import { refreshBadges } from "@/lib/badges";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationTarget,
  notificationVisual,
} from "@/lib/notifications";
import { safeErrorMessage } from "@/lib/errors";
import { timeAgo } from "@/lib/format";
import { vibrate } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { COLORS, GLASS, GRADIENT_COLORS, RADIUS, TAB_BAR_SPACE, useStyles } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import type { NotificationRow, Whisper, WhisperHint } from "@/lib/types";
import {
  deleteWhispers,
  fetchHintUnlocks,
  fetchHints,
  markAllWhispersRead,
  markWhisperRead,
  unlockHint,
} from "@/lib/whispers";

type Tab = "whispers" | "alerts";

/**
 * Notifications — both of them.
 *
 * THE WEB APP HAS TWO THINGS ON THIS ROUTE AND THEY ARE NOT THE SAME THING
 *
 *   /notifications        the whisper inbox: every anonymous message anybody
 *                         sent you (`public.messages`, filtered on
 *                         `recipient_id`), with the paid sender hint.
 *   NotificationActivityList  the durable alert history (`public.notifications`):
 *                         friend requests, replies, coin transfers, missed
 *                         calls. Pushes are only the delivery of these rows.
 *
 * The brief asks for one notifications screen, so this is both, under a
 * two-position switch. They share a screen because they answer the same
 * question — "what happened while I was away" — and splitting them across two
 * tabs would put a badge on each of two lists holding half the answer.
 *
 * The switch is a sliding gradient indicator, the same control as the auth
 * screen's, so the vocabulary is consistent: a two-position pill is a filter,
 * not a navigation.
 *
 * The whisper inbox is live: an insert on `messages` for this recipient appends
 * the row without a refetch, which is what makes an anonymous message arrive
 * while the screen is open rather than after the next pull.
 */
export default function Notifications() {
  const styles = useStyles(makeStyles);
  const { userId, session } = useSession();
  const { showToast } = useToast();

  const [tab, setTab] = useState<Tab>("whispers");
  const [whispers, setWhispers] = useState<Whisper[]>([]);
  const [alerts, setAlerts] = useState<NotificationRow[]>([]);
  const [hintUnlocks, setHintUnlocks] = useState<Set<string>>(new Set());
  const [hints, setHints] = useState<WhisperHint[]>([]);
  const [expandedHint, setExpandedHint] = useState<string | null>(null);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Whisper | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [menuWhisper, setMenuWhisper] = useState<Whisper | null>(null);

  const indicator = useSharedValue(0);

  useEffect(() => {
    indicator.value = withTiming(tab === "whispers" ? 0 : 1, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [indicator, tab]);

  const indicatorStyle = useAnimatedStyle(() => ({ transform: [{ translateX: indicator.value * 100 }] }));

  /* -----------------------------------------------------------------------
     Load
     -------------------------------------------------------------------- */

  const load = useCallback(async () => {
    if (!userId) return;

    const { data, error } = await supabase
      .from("messages")
      .select("id,message,image_url,created_at,is_read")
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      /* A failed fetch must never read as "no whispers": the empty state is
         only true when the query succeeds and returns zero rows. */
      setLoadError(safeErrorMessage(error, "Couldn't load your whispers."));
    } else {
      setLoadError(null);
      setWhispers((data as Whisper[]) ?? []);
    }

    const [unlocks, alertRows] = await Promise.all([fetchHintUnlocks(userId), fetchNotifications(userId)]);

    setHintUnlocks(new Set(unlocks));
    setAlerts(alertRows);

    /* The hints for messages already paid for, fetched lazily by id: the
       sender_* columns are unreadable from the client (202609070001 revokes
       them on `messages`), and `whisper_hints_for` answers only rows with an
       unlock receipt. */
    if (unlocks.length > 0) {
      const rows = await fetchHints(unlocks);
      setHints(rows);
    }

    setLoading(false);
    setRefreshing(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* The badges behind this screen are this screen's rows; when it opens they
     are about to be seen, so the refresh belongs to focus as well. */
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void refreshBadges(userId);
    }, [userId])
  );

  /* Live arrivals. One channel per screen instance, torn down on unmount — a
     subscription that outlives its screen is a leak with a battery cost. */
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`whispers-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${userId}` },
        (payload) => {
          const incoming = payload.new as Whisper;
          setWhispers((current) => (current.some((row) => row.id === incoming.id) ? current : [incoming, ...current]));
          vibrate("tap");
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => void fetchNotifications(userId).then(setAlerts)
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  /* -----------------------------------------------------------------------
     Actions
     -------------------------------------------------------------------- */

  const openWhisper = useCallback(
    async (whisper: Whisper) => {
      if (whisper.is_read) return;
      setWhispers((current) =>
        current.map((row) => (row.id === whisper.id ? { ...row, is_read: true } : row))
      );
      await markWhisperRead(whisper.id);
      if (userId) void refreshBadges(userId);
    },
    [userId]
  );

  const toggleHint = useCallback(
    async (whisper: Whisper) => {
      const unlocked = hintUnlocks.has(whisper.id);

      if (unlocked) {
        setExpandedHint((current) => (current === whisper.id ? null : whisper.id));

        /* Paid but the data is not in hand (the screen loaded before the hint
           fetch, or a legacy unlock). Re-reading is free, so fetch rather than
           showing an empty reveal. */
        if (!hints.some((hint) => hint.message_id === whisper.id)) {
          const rows = await fetchHints([whisper.id]);
          setHints((current) => [...current.filter((row) => row.message_id !== whisper.id), ...rows]);
        }
        return;
      }

      setUnlockingId(whisper.id);
      try {
        await unlockHint(whisper.id);
      } catch (cause) {
        setUnlockingId(null);
        showToast(safeErrorMessage(cause, "Couldn't unlock that hint."), { variant: "error" });
        return;
      }
      setUnlockingId(null);

      vibrate("success");
      setHintUnlocks((current) => new Set(current).add(whisper.id));
      showToast("Hint unlocked", { variant: "subtle" });

      const rows = await fetchHints([whisper.id]);
      setHints((current) => [...current.filter((row) => row.message_id !== whisper.id), ...rows]);
      setExpandedHint(whisper.id);
    },
    [hintUnlocks, hints, showToast]
  );

  const removeWhisper = async () => {
    if (!deleteTarget) return;
    setDeleting(true);

    const result = session?.access_token
      ? await deleteWhispers([deleteTarget.id], session.access_token)
      : { ok: false, error: "You need to be signed in." };
    setDeleting(false);

    if (!result.ok) {
      showToast(result.error ?? "Couldn't delete that whisper.", { variant: "error" });
      setDeleteTarget(null);
      return;
    }

    setWhispers((current) => current.filter((row) => row.id !== deleteTarget.id));
    setDeleteTarget(null);
    if (userId) void refreshBadges(userId);
    showToast("Whisper deleted", { variant: "subtle" });
  };

  const openAlert = useCallback(
    async (row: NotificationRow) => {
      if (!row.is_read) {
        setAlerts((current) => current.map((item) => (item.id === row.id ? { ...item, is_read: true } : item)));
        await markNotificationRead(row.id);
        if (userId) void refreshBadges(userId);
      }

      const target = notificationTarget(row);

      switch (target.kind) {
        case "chat":
          router.push({ pathname: "/conversation", params: { conversationId: target.conversationId } });
          break;
        case "feed":
          if (target.postId) {
            router.push({ pathname: "/whisper-detail", params: { postId: target.postId } });
          } else {
            setTab("whispers");
          }
          break;
        case "coins":
          router.push("/coins");
          break;
        case "whispers":
          setTab("whispers");
          break;
        case "friends":
        case "none":
        default:
          /* Routes this app has no screen for stay put rather than navigating
             somewhere arbitrary. The row is still marked read. */
          break;
      }
    },
    [userId]
  );

  const readAll = async () => {
    if (!userId) return;
    vibrate("tap");

    await Promise.all([
      markAllNotificationsRead(userId),
      markAllWhispersRead(whispers.filter((row) => !row.is_read).map((row) => row.id)),
    ]);
    setAlerts((current) => current.map((row) => ({ ...row, is_read: true })));
    setWhispers((current) => current.map((row) => ({ ...row, is_read: true })));
    if (userId) void refreshBadges(userId);
    showToast("All marked as read", { variant: "subtle" });
  };

  /* -----------------------------------------------------------------------
     Render
     -------------------------------------------------------------------- */

  const unreadWhispers = useMemo(() => whispers.filter((row) => !row.is_read).length, [whispers]);
  const unreadAlerts = useMemo(() => alerts.filter((row) => !row.is_read).length, [alerts]);
  const unread = tab === "whispers" ? unreadWhispers : unreadAlerts;

  return (
    <Screen padded={false} edges={["left", "right"]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.title}>Notifications</Text>
            <Text style={styles.subtitle}>
              {unread > 0 ? `${unread} unread` : "You're all caught up"}
              {tab === "whispers" ? " · only you can see these" : ""}
            </Text>
          </View>

          {unread > 0 && (
            <Pressable onPress={() => void readAll()} style={styles.readAll} accessibilityLabel="Mark all read">
              <Ionicons name="checkmark-done-outline" size={15} color={COLORS.cyan} />
              <Text style={styles.readAllText}>Read all</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.switch}>
          <Animated.View style={[styles.switchIndicator, indicatorStyle]}>
            <LinearGradient
              colors={GRADIENT_COLORS}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          {(["whispers", "alerts"] as Tab[]).map((value) => (
            <Pressable
              key={value}
              style={styles.switchButton}
              onPress={() => {
                vibrate("tap");
                setTab(value);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === value }}
            >
              <Text style={[styles.switchText, tab === value && styles.switchTextActive]}>
                {value === "whispers" ? "Whispers" : "Alerts"}
                {value === "whispers" && unreadWhispers > 0 ? ` · ${unreadWhispers}` : ""}
                {value === "alerts" && unreadAlerts > 0 ? ` · ${unreadAlerts}` : ""}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {tab === "whispers" ? (
        <FlatList
          data={whispers}
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
            <WhisperCard
              whisper={item}
              hint={hints.find((hint) => hint.message_id === item.id)}
              unlocked={hintUnlocks.has(item.id)}
              expanded={expandedHint === item.id}
              unlocking={unlockingId === item.id}
              onPress={() => void openWhisper(item)}
              onToggleHint={() => void toggleHint(item)}
              onDelete={() => setDeleteTarget(item)}
              onReply={() => setMenuWhisper(item)}
            />
          )}
          ListEmptyComponent={
            loading ? (
              <View>
                <SkeletonRow height={120} />
                <SkeletonRow height={96} />
                <SkeletonRow height={140} />
              </View>
            ) : loadError ? (
              <EmptyState
                icon="cloud-offline-outline"
                title="Couldn't load your whispers"
                body={loadError}
                actionLabel="Try again"
                onAction={() => {
                  setLoading(true);
                  void load();
                }}
              />
            ) : (
              <EmptyState
                icon="mail-unread-outline"
                title="No whispers yet"
                body="Share your link and anonymous messages will land here."
                actionLabel="See your link"
                onAction={() => router.push("/(tabs)/profile")}
              />
            )
          }
        />
      ) : (
        <FlatList
          data={alerts}
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
          renderItem={({ item }) => <AlertRow row={item} onPress={() => void openAlert(item)} />}
          ListEmptyComponent={
            loading ? (
              <View>
                <SkeletonRow height={74} />
                <SkeletonRow height={74} />
                <SkeletonRow height={74} />
              </View>
            ) : (
              <EmptyState
                icon="notifications-off-outline"
                title="No alerts yet"
                body="Replies, friend requests and coin transfers will show up here."
              />
            )
          }
        />
      )}

      <ConfirmSheet
        visible={Boolean(deleteTarget)}
        title="Delete this whisper?"
        message="It disappears from your inbox for good."
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={() => void removeWhisper()}
        onCancel={() => setDeleteTarget(null)}
      />

      <Sheet
        visible={Boolean(menuWhisper)}
        onClose={() => setMenuWhisper(null)}
        title="What do you want to do?"
      >
        {menuWhisper && (
          <View style={{ paddingBottom: 10 }}>
            <SheetRow
              icon="link-outline"
              label="Open my link"
              detail="Where whispers are sent to you"
              onPress={() => {
                setMenuWhisper(null);
                router.push("/(tabs)/profile");
              }}
            />
            <SheetRow
              icon="trash-outline"
              label="Delete whisper"
              danger
              onPress={() => {
                setDeleteTarget(menuWhisper);
                setMenuWhisper(null);
              }}
            />
          </View>
        )}
      </Sheet>
    </Screen>
  );
}

/** One row of the durable alert history. */
function AlertRow({ row, onPress }: { row: NotificationRow; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const visual = notificationVisual(row.type);

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={row.title}>
      <BlurView intensity={GLASS.blurIntensity} tint={GLASS.tint} style={[styles.alert, !row.is_read && styles.alertUnread]}>
        <View style={styles.alertInner}>
          <View style={[styles.alertIcon, { backgroundColor: `${visual.accent}22` }]}>
            <Ionicons name={visual.icon as never} size={17} color={visual.accent} />
          </View>

          <View style={styles.alertText}>
            <Text style={styles.alertTitle} numberOfLines={1}>
              {row.title}
            </Text>
            {row.body ? (
              <Text style={styles.alertBody} numberOfLines={2}>
                {row.body}
              </Text>
            ) : null}
            <Text style={styles.alertWhen}>{timeAgo(row.created_at)}</Text>
          </View>

          {!row.is_read && <View style={styles.alertDot} />}
        </View>
      </BlurView>
    </Pressable>
  );
}

const makeStyles = () => StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  headerTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  title: { color: COLORS.text, fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
  subtitle: { color: COLORS.muted, fontSize: 12.5, fontWeight: "600", marginTop: 3 },
  readAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(34,211,238,0.12)",
  },
  readAllText: { color: COLORS.cyan, fontSize: 12, fontWeight: "800" },

  switch: {
    flexDirection: "row",
    height: 42,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 3,
    marginTop: 14,
    position: "relative",
    borderWidth: 1,
    borderColor: GLASS.border,
  },
  switchIndicator: {
    position: "absolute",
    top: 3,
    left: 3,
    bottom: 3,
    width: "50%",
    borderRadius: RADIUS.pill,
    overflow: "hidden",
  },
  switchButton: { flex: 1, alignItems: "center", justifyContent: "center" },
  switchText: { color: COLORS.muted, fontSize: 13, fontWeight: "700" },
  switchTextActive: { color: COLORS.contrast, fontWeight: "900" },

  list: { paddingHorizontal: 16, paddingBottom: TAB_BAR_SPACE + 24 },

  alert: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.5)",
    marginBottom: 10,
    overflow: "hidden",
  },
  alertUnread: { borderColor: "rgba(34,211,238,0.32)" },
  alertInner: { flexDirection: "row", alignItems: "center", gap: 12, padding: 13 },
  alertIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  alertText: { flex: 1 },
  alertTitle: { color: COLORS.text, fontSize: 14, fontWeight: "800" },
  alertBody: { color: COLORS.muted, fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  alertWhen: { color: COLORS.subtle, fontSize: 11, fontWeight: "600", marginTop: 4 },
  alertDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.cyan },
});
