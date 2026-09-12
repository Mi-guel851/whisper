import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { FeedCard } from "@/components/feed/FeedCard";
import { GradientText } from "@/components/GradientText";
import { IconButton } from "@/components/GradientButton";
import { InlineLoader } from "@/components/Screen";
import { fetchFeedPage, toggleLike } from "@/lib/feed";
import type { FeedQuery, FeedSort } from "@/lib/feed";
import type { FeedPost } from "@/lib/types";
import { fetchUnreadCount } from "@/lib/notifications";
import { useSession } from "@/lib/session";
import { COLORS } from "@/lib/theme";
import { vibrate } from "@/lib/haptics";
import { useToast } from "@/lib/toast";

const FEED_PAGE_SIZE = 10;

/**
 * Feed.
 *
 * Lists whisper cards (GlassCard), pull-to-refresh, FAB for creating, top bar
 * with Whisper logo and notification bell.
 */
export default function FeedScreen() {
  const { userId } = useSession();
  const { showToast } = useToast();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [likeCountMap, setLikeCountMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [mode, setMode] = useState<"rpc" | "fallback" | null>(null);
  const [unreadNotifs, setUnreadNotifs] = useState(0);

  const query: FeedQuery = { sort: "new" as FeedSort, topic: null, search: "" };

  const loadFirstPage = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const response = await fetchFeedPage(query, 0, FEED_PAGE_SIZE);
      if (response.mode === "rpc") {
        setMode("rpc");
        setPosts(response.rows);
        setHasMore(response.hasMore);
        setOffset(FEED_PAGE_SIZE);
      } else {
        setMode("fallback");
        setPosts(response.rows.slice(0, FEED_PAGE_SIZE));
        setHasMore(false);
      }
      seedLikes(response.rows);
    } catch (err: any) {
      showToast(err?.message || "Couldn't load the feed.", { variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [userId, showToast]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || mode !== "rpc") return;
    setLoadingMore(true);
    try {
      const response = await fetchFeedPage(query, offset, FEED_PAGE_SIZE);
      if (response.mode === "rpc") {
        setPosts((prev) => {
          const existing = new Set(prev.map((p) => p.id));
          const fresh = response.rows.filter((r) => !existing.has(r.id));
          return [...prev, ...fresh];
        });
        setHasMore(response.hasMore);
        setOffset((o) => o + FEED_PAGE_SIZE);
        seedLikes(response.rows);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, mode, offset]);

  const seedLikes = (rows: FeedPost[]) => {
    setLikedMap((prev) => {
      const next = { ...prev };
      for (const row of rows) if (typeof row.viewer_liked === "boolean") next[row.id] = row.viewer_liked;
      return next;
    });
    setLikeCountMap((prev) => {
      const next = { ...prev };
      for (const row of rows) next[row.id] = row.like_count ?? 0;
      return next;
    });
  };

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  useEffect(() => {
    if (!userId) return;
    fetchUnreadCount(userId).then(setUnreadNotifs).catch(() => {});
  }, [userId]);

  const onRefresh = async () => {
    setRefreshing(true);
    vibrate("tap");
    await loadFirstPage();
    setRefreshing(false);
  };

  const handleToggleLike = async (postId: string) => {
    if (!userId) return;
    const wasLiked = Boolean(likedMap[postId]);
    const currentCount = likeCountMap[postId] ?? 0;

    // Optimistic update
    setLikedMap((prev) => ({ ...prev, [postId]: !wasLiked }));
    setLikeCountMap((prev) => ({
      ...prev,
      [postId]: Math.max(0, currentCount + (wasLiked ? -1 : 1)),
    }));
    vibrate("select");

    try {
      await toggleLike(postId, userId, wasLiked);
    } catch (err: any) {
      showToast(err?.message || "Couldn't toggle like.", { variant: "error" });
      // Revert
      setLikedMap((prev) => ({ ...prev, [postId]: wasLiked }));
      setLikeCountMap((prev) => ({ ...prev, [postId]: currentCount }));
    }
  };

  const openWhisper = (post: FeedPost) => {
    router.push({ pathname: "/whisper-detail", params: { postId: post.id } });
  };

  const renderItem = ({ item }: { item: FeedPost }) => (
    <Animated.View entering={FadeIn.duration(260)}>
      <FeedCard
        post={item}
        myId={userId ?? ""}
        liked={Boolean(likedMap[item.id])}
        likeCount={likeCountMap[item.id] ?? item.like_count ?? 0}
        replyCount={item.reply_count ?? 0}
        imageState="locked"
        onToggleLike={() => handleToggleLike(item.id)}
        onOpenThread={() => openWhisper(item)}
        onOpenThreadScreen={() => openWhisper(item)}
        onOpenMenu={() => {}}
        onTip={() => router.push("/coins")}
        saved={false}
      />
    </Animated.View>
  );

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <GradientText style={styles.logo}>WHISPER</GradientText>
        <View style={styles.topActions}>
          <IconButton
            icon="notifications-outline"
            onPress={() => router.push("/(tabs)/notifications")}
            badge={unreadNotifs}
          />
        </View>
      </View>

      {loading && posts.length === 0 ? (
        <View style={styles.loadingWrap}>
          <InlineLoader label="Loading whispers..." />
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.cyan} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <InlineLoader label="Loading more..." /> : null}
          ListEmptyComponent={
            !loading ? (
              <View style={styles.empty}>
                <Ionicons name="chatbubble-ellipses-outline" size={48} color={COLORS.subtle} />
                <Text style={styles.emptyTitle}>The feed is quiet</Text>
                <Text style={styles.emptyBody}>Be the first to say something.</Text>
              </View>
            ) : null
          }
        />
      )}

      {/* Floating action button */}
      <Pressable onPress={() => router.push("/create-whisper")} style={styles.fabWrap}>
        <LinearGradient
          colors={["#22d3ee", "#a855f7"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fab}
        >
          <Ionicons name="add" size={28} color="#0a0814" />
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  logo: { fontSize: 22, letterSpacing: 2 },
  topActions: { flexDirection: "row", gap: 10 },
  listContent: { paddingHorizontal: 16, paddingBottom: 120, paddingTop: 8 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 10 },
  emptyTitle: { color: COLORS.text, fontSize: 18, fontWeight: "800", marginTop: 12 },
  emptyBody: { color: COLORS.muted, fontSize: 14 },
  fabWrap: { position: "absolute", right: 20, bottom: 100 },
  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#22d3ee",
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});
