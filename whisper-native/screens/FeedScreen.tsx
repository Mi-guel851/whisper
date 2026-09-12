import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FeedCard, TopicChip } from "@/components/feed/FeedCard";
import { CoinBadge } from "@/components/CoinBadge";
import { IconButton } from "@/components/GradientButton";
import { LinearGradient } from "expo-linear-gradient";
import { SearchField } from "@/components/Input";
import { Logo } from "@/components/Logo";
import { EmptyState, InlineLoader, Screen, SkeletonRow } from "@/components/Screen";
import { Sheet, SheetRow } from "@/components/Sheet";
import { CoinTipSheet } from "@/components/CoinTipSheet";
import { TAB_BAR_SPACE } from "@/navigation/MainTabs";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { MainStackParamList, TabParamList } from "@/navigation/types";
import { refreshBadges, useBadges, watchBadges } from "@/lib/badges";
import { fetchWallet } from "@/lib/coins";
import type { FeedImageState } from "@/lib/feedState";
import { optimisticLike, optimisticVote } from "@/lib/feedState";
import {
  FEED_PAGE_SIZE,
  FEED_SORTS,
  FEED_TOPICS,
  apiBase,
  blockAuthor,
  claimFeedPhoto,
  fetchFeedPage,
  reportPost,
  sliceFallback,
  toggleLike as toggleLikeRow,
  type FeedSort,
} from "@/lib/feed";
import type { FeedPost } from "@/lib/types";
import { vibrate } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { COLORS, GLASS, GRADIENT_COLORS, RADIUS, glow } from "@/lib/theme";
import { supabase } from "@/lib/supabase";

/**
 * The feed.
 *
 * The public feed is the front door of the product — the same surface as the
 * website's `/public-feed`, with the same four sorts, the same topic filter, the
 * same search, and the same behaviour on every control:
 *
 *   pulldown      reload page 0 of the current view
 *   scroll end    the next page (the RPC ranks and paginates server-side)
 *   tap a card    open the thread
 *   the reply icon opens the thread *and* its composer, in place
 *   the heart     optimistic like, reconciled on refresh
 *   the tip chip  the coin transfer sheet
 *
 * ONE THING DIFFERS FROM THE WEB, AND IT IS DELIBERATE
 *
 * Replies are not rendered inline under every root post the way the site's
 * recursive `FeedPostCard` renders them. On a phone that turns one scroll
 * gesture into a recursion of unknown depth inside a virtualised list, and the
 * thread screen already shows the whole conversation with its own composer. The
 * reply *count* is live in both places, and tapping it lands on the same data.
 */
export function FeedScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  /* Two hooks, one object: a tab screen's navigation can reach both its own
     tabs and its parent stack (React Navigation bubbles an unknown route up),
     and typing each call for the destination it performs keeps both honest. */
  const tabNavigation = useNavigation<BottomTabNavigationProp<TabParamList>>();
  const insets = useSafeAreaInsets();
  const { userId, session } = useSession();
  const { showToast } = useToast();

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [sort, setSort] = useState<FeedSort>("for_you");
  const [topic, setTopic] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [imageStates, setImageStates] = useState<Record<string, FeedImageState>>({});
  const [imageUris, setImageUris] = useState<Record<string, string>>({});
  const [pollCounts, setPollCounts] = useState<Record<string, number[]>>({});
  const [pollChoices, setPollChoices] = useState<Record<string, number>>({});
  const [pollPending, setPollPending] = useState<Record<string, boolean>>({});

  const [menuPost, setMenuPost] = useState<FeedPost | null>(null);
  const [tipPost, setTipPost] = useState<FeedPost | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  /* The bell's badge is the whisper inbox plus the alert history — the two
     lists the Notifications tab holds, which is exactly what the tab bar shows
     on that tab. */
  const badges = useBadges();
  const notifications = badges.unreadWhispers + badges.unreadAlerts;

  /* The table-read fallback returns its whole window at once, so the extra
     pages come from a local slice of the same response rather than from a
     second round trip. */
  const windowRef = useRef<FeedPost[]>([]);

  /* -----------------------------------------------------------------------
     Loading
     -------------------------------------------------------------------- */

  const query = useMemo(() => ({ sort, topic, search: search.trim() }), [sort, topic, search]);

  /* A ref of what is on screen, so the merge below can be computed *before*
     any state is written. Doing this inside a `setPosts` updater would mean
     calling five other setters from within one, and an updater has to be pure —
     React is allowed to run it twice. */
  const postsRef = useRef<FeedPost[]>([]);

  const applyRows = useCallback(
    (rows: FeedPost[], reset: boolean) => {
      const base = reset ? [] : postsRef.current;
      const seen = new Set(base.map((post) => post.id));
      const fresh = rows.filter((row) => !seen.has(row.id));

      if (fresh.length === 0 && !reset) return;

      const next = [...base, ...fresh];
      postsRef.current = next;
      setPosts(next);

      if (fresh.length === 0) return;

      setLiked((value) => {
        const merged = { ...value };
        for (const row of fresh) merged[row.id] = Boolean(row.viewer_liked);
        return merged;
      });
      setLikeCounts((value) => {
        const merged = { ...value };
        for (const row of fresh) merged[row.id] = Number(row.like_count ?? 0);
        return merged;
      });
      setReplyCounts((value) => {
        const merged = { ...value };
        for (const row of fresh) merged[row.id] = Number(row.reply_count ?? 0);
        return merged;
      });
      setImageStates((value) => {
        const merged = { ...value };
        for (const row of fresh) {
          if (row.has_image && !merged[row.id]) {
            merged[row.id] = row.author_id === userId || row.viewer_image_viewed ? "spent" : "locked";
          }
        }
        return merged;
      });
      setPollChoices((value) => {
        const merged = { ...value };
        for (const row of fresh) if (typeof row.viewer_vote === "number") merged[row.id] = row.viewer_vote;
        return merged;
      });
      setPollCounts((value) => {
        const merged = { ...value };
        for (const row of fresh) if (row.poll_counts) merged[row.id] = row.poll_counts;
        return merged;
      });
    },
    [userId]
  );

  const load = useCallback(
    async (options: { reset?: boolean } = {}) => {
      const reset = options.reset ?? true;
      const nextOffset = reset ? 0 : offset;

      try {
        const page = await fetchFeedPage(query, reset ? 0 : nextOffset, FEED_PAGE_SIZE);

        /* The feed's roots only. Replies are reachable from their parent, and
           showing them twice is the duplication the web app's `buildPostTree`
           exists to prevent. */
        const all = (page.mode === "rpc" ? page.rows : sliceFallback(page.rows, nextOffset)).filter(
          (row) => !row.parent_post_id
        );

        applyRows(all, reset);

        setOffset(nextOffset + FEED_PAGE_SIZE);
        setHasMore(
          page.mode === "rpc" ? page.rows.length === FEED_PAGE_SIZE : nextOffset + FEED_PAGE_SIZE < page.rows.length
        );

        if (page.mode === "fallback") windowRef.current = page.rows;
      } catch (error) {
        console.warn("[feed] load failed:", error);
        if (reset) setPosts([]);
        showToast("Couldn't load the feed. Pull down to try again.", { variant: "error" });
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [applyRows, offset, query, showToast]
  );

  /* First load, and every change of sort / topic / search. */
  useEffect(() => {
    setLoading(true);
    setHasMore(true);
    void load({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, topic]);

  /* Search is debounced rather than fired per keystroke: every distinct query
     string is a separate RPC call, and a phone keyboard emits one per letter. */
  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading) return;
      setLoading(true);
      void load({ reset: true });
    }, 420);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (userId) void refreshBadges(userId);
  }, [userId]);

  /* The badge store's subscriptions, started once per signed-in user. */
  useEffect(() => {
    if (!userId) return;
    return watchBadges(userId);
  }, [userId]);

  /* A new post from anyone — the author's own optimistic row arrives through
     the composer, this is what brings other people's. */
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`feed-live-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "public_feed_posts" },
        () => {
          if (sort === "new" || sort === "for_you") void load({ reset: true });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, sort]);

  /* Refresh on focus: the same screen is left and returned to constantly, and a
     stale like count from ten minutes ago is the most visible kind of stale. */
  useFocusEffect(
    useCallback(() => {
      if (userId) {
        void fetchWallet(userId).then((wallet) => setBalance(wallet?.balance ?? 0));
        void refreshBadges(userId);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId])
  );

  /* -----------------------------------------------------------------------
     Engagement
     -------------------------------------------------------------------- */

  const toggleLike = useCallback(
    async (post: FeedPost) => {
      if (!userId) return;

      const wasLiked = Boolean(liked[post.id]);
      const optimistic = optimisticLike(likeCounts[post.id] ?? 0, wasLiked);

      setLiked((value) => ({ ...value, [post.id]: optimistic.liked }));
      setLikeCounts((value) => ({ ...value, [post.id]: optimistic.count }));
      vibrate("select");

      try {
        await toggleLikeRow(post.id, userId, wasLiked);
      } catch {
        /* Undo in both places, or the button disagrees with the server until
           the next reload. */
        setLiked((value) => ({ ...value, [post.id]: wasLiked }));
        setLikeCounts((value) => ({ ...value, [post.id]: Math.max(0, optimistic.count - (wasLiked ? -1 : 1)) }));
        showToast("Couldn't save that like.", { variant: "error" });
      }
    },
    [likeCounts, liked, showToast, userId]
  );

  const vote = useCallback(
    async (post: FeedPost, optionIndex: number) => {
      if (!userId || pollPending[post.id]) return;

      const previous = pollChoices[post.id] ?? null;
      setPollPending((value) => ({ ...value, [post.id]: true }));
      setPollChoices((value) => ({ ...value, [post.id]: optionIndex }));
      setPollCounts((value) => ({
        ...value,
        [post.id]: optimisticVote(value[post.id] ?? post.poll_counts ?? [], previous, optionIndex),
      }));
      vibrate("select");

      const { error } = await supabase.rpc("vote_public_feed_poll", {
        p_post_id: post.id,
        p_option_index: optionIndex,
      });

      setPollPending((value) => ({ ...value, [post.id]: false }));

      if (error) {
        setPollChoices((value) => {
          const next = { ...value };
          if (previous === null) delete next[post.id];
          else next[post.id] = previous;
          return next;
        });
        showToast("Couldn't record that vote.", { variant: "error" });
      }
    },
    [pollChoices, pollPending, showToast, userId]
  );

  const openPhoto = useCallback(
    async (post: FeedPost) => {
      if (!session?.access_token) return;
      if (post.author_id === userId) {
        showToast("This is your own photo whisper.", { variant: "subtle" });
        return;
      }

      setImageStates((value) => ({ ...value, [post.id]: "loading" }));
      const result = await claimFeedPhoto(post.id, session.access_token);

      if ("error" in result) {
        setImageStates((value) => ({ ...value, [post.id]: "unavailable" }));
        showToast(result.error, { variant: "error" });
        return;
      }

      setImageUris((value) => ({ ...value, [post.id]: result.uri }));
      setImageStates((value) => ({ ...value, [post.id]: "spent" }));
    },
    [session?.access_token, showToast, userId]
  );

  /* -----------------------------------------------------------------------
     Menu actions
     -------------------------------------------------------------------- */

  const sharePost = async (post: FeedPost) => {
    const { Share } = await import("react-native");
    await Share.share({
      message: `${post.body}\n\n${apiBase()}/public-feed?post=${post.id}`,
    }).catch(() => {});
  };

  const copyLink = async (post: FeedPost) => {
    const { setStringAsync } = await import("expo-clipboard").catch(() => ({ setStringAsync: null }));
    const url = `${apiBase()}/public-feed?post=${post.id}`;
    if (setStringAsync) await setStringAsync(url);
    showToast("Link copied", { variant: "subtle" });
  };

  const report = async (post: FeedPost) => {
    if (!userId) return;
    try {
      await reportPost(post.id, userId, "Reported from the app");
      showToast("Thanks — we'll take a look.", { variant: "success" });
    } catch {
      showToast("Couldn't send that report.", { variant: "error" });
    }
  };

  const block = async (post: FeedPost) => {
    if (!userId) return;
    try {
      await blockAuthor(userId, post.author_id);
      setPosts((current) => current.filter((row) => row.author_id !== post.author_id));
      showToast("Blocked. You won't see their posts again.", { variant: "subtle" });
    } catch {
      showToast("Couldn't block that account.", { variant: "error" });
    }
  };

  const remove = async (post: FeedPost) => {
    const { error } = await supabase.from("public_feed_posts").delete().eq("id", post.id);
    if (error) {
      showToast(error.message, { variant: "error" });
      return;
    }
    setPosts((current) => current.filter((row) => row.id !== post.id));
    showToast("Deleted", { variant: "subtle" });
  };

  /* -----------------------------------------------------------------------
     Render
     -------------------------------------------------------------------- */

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <View style={styles.headerTop}>
        <Logo compact showTagline={false} />

        <View style={styles.headerActions}>
          <CoinBadge balance={balance} onPress={() => navigation.navigate("CoinStore")} />
          <IconButton
            icon="search-outline"
            size={40}
            onPress={() => setSearchOpen((open) => !open)}
            accessibilityLabel={searchOpen ? "Close search" : "Search"}
          />
          <IconButton
            icon="notifications-outline"
            size={40}
            badge={notifications}
            onPress={() => tabNavigation.navigate("Notifications")}
            accessibilityLabel="Alerts"
          />
        </View>
      </View>

      {searchOpen && (
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder="Search whispers"
          style={styles.search}
        />
      )}

      <View style={styles.sortRow}>
        {FEED_SORTS.map((entry) => {
          const active = entry.key === sort;
          return (
            <Pressable
              key={entry.key}
              onPress={() => {
                vibrate("tap");
                setSort(entry.key);
              }}
              style={[styles.sortPill, active && styles.sortPillActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.sortText, active && styles.sortTextActive]}>{entry.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <Screen padded={false} edges={["left", "right"]}>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <>
            {header}
            <FlatList
              data={[{ key: "all", label: "All", emoji: "✨" }, ...FEED_TOPICS.map((t) => ({ key: t.key, label: t.label, emoji: t.emoji }))]}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.key}
              contentContainerStyle={styles.topicRow}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    vibrate("tap");
                    setTopic(item.key === "all" ? null : item.key);
                  }}
                >
                  <TopicChip emoji={item.emoji} label={item.label} active={(item.key === "all" && !topic) || item.key === topic} />
                </Pressable>
              )}
            />
          </>
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_BAR_SPACE + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={COLORS.cyan}
            colors={[COLORS.cyan, COLORS.purple]}
            progressBackgroundColor={COLORS.surface}
            onRefresh={() => {
              setRefreshing(true);
              setHasMore(true);
              void load({ reset: true });
              if (userId) void refreshBadges(userId);
            }}
          />
        }
        renderItem={({ item }) => (
          <FeedCard
            post={item}
            myId={userId ?? ""}
            liked={Boolean(liked[item.id])}
            likeCount={likeCounts[item.id] ?? 0}
            replyCount={replyCounts[item.id] ?? 0}
            imageState={imageStates[item.id] ?? "locked"}
            openImageUri={imageUris[item.id] ?? null}
            pollCounts={pollCounts[item.id]}
            pollChoice={pollChoices[item.id] ?? null}
            pollPending={Boolean(pollPending[item.id])}
            onToggleLike={() => void toggleLike(item)}
            onVote={(index) => void vote(item, index)}
            onOpenGallery={() => void openPhoto(item)}
            onOpenThread={() => navigation.navigate("SingleWhisper", { postId: item.id })}
            onOpenMenu={() => setMenuPost(item)}
            onTip={() => setTipPost(item)}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <View>
              <SkeletonRow height={148} />
              <SkeletonRow height={168} />
              <SkeletonRow height={132} />
            </View>
          ) : (
            <EmptyState
              icon="planet-outline"
              title="Nothing here yet"
              body={
                topic
                  ? "No whispers in this topic. Try another, or post the first one."
                  : "The feed is quiet right now. Post the first whisper and get it started."
              }
              actionLabel="Write a whisper"
              onAction={() => navigation.navigate("CreateWhisper")}
            />
          )
        }
        ListFooterComponent={
          loadingMore ? <InlineLoader label="Loading more" /> : hasMore ? <View style={{ height: 12 }} /> : null
        }
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (loadingMore || !hasMore || loading || posts.length === 0) return;
          setLoadingMore(true);
          void load({ reset: false });
        }}
        removeClippedSubviews
      />

      {/* The floating compose button — the app's primary action, in the thumb's
          corner, on the gradient. One pressable, not a pressable inside a
          pressable: nested touchables both fire, which navigates twice. */}
      <Pressable
        onPress={() => {
          vibrate("select");
          navigation.navigate("CreateWhisper");
        }}
        style={[styles.fab, { bottom: TAB_BAR_SPACE + 6 }]}
        accessibilityRole="button"
        accessibilityLabel="Create a whisper"
      >
        <LinearGradient
          colors={GRADIENT_COLORS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.fabGradient, glow(COLORS.cyan, 22, 0.45)]}
        >
          <Ionicons name="add" size={30} color="#0a0814" />
        </LinearGradient>
      </Pressable>

      {/* The overflow sheet, rendered once at screen level rather than per card:
          forty mounted portals to serve one open sheet is how a list gets slow. */}
      <Sheet visible={Boolean(menuPost)} onClose={() => setMenuPost(null)} title="Post options">
        {menuPost && (
          <View style={{ paddingBottom: 10 }}>
            <SheetRow icon="link-outline" label="Copy link" onPress={() => void copyLink(menuPost).then(() => setMenuPost(null))} />
            <SheetRow icon="share-social-outline" label="Share" onPress={() => void sharePost(menuPost).then(() => setMenuPost(null))} />
            <SheetRow
              icon="flag-outline"
              label="Report"
              detail="Send this to the moderation queue"
              onPress={() => void report(menuPost).then(() => setMenuPost(null))}
            />
            <SheetRow
              icon="ban-outline"
              label="Block author"
              detail="You won't see their posts again"
              onPress={() => void block(menuPost).then(() => setMenuPost(null))}
            />
            {menuPost.author_id === userId && (
              <SheetRow
                icon="trash-outline"
                label="Delete"
                danger
                detail="This cannot be undone"
                onPress={() => void remove(menuPost).then(() => setMenuPost(null))}
              />
            )}
          </View>
        )}
      </Sheet>

      <CoinTipSheet
        visible={Boolean(tipPost)}
        onClose={() => setTipPost(null)}
        balance={balance}
        onDone={(newBalance) => {
          if (typeof newBalance === "number") setBalance(newBalance);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingBottom: 4 },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  search: { marginTop: 12 },
  sortRow: { flexDirection: "row", gap: 8, marginTop: 14, paddingHorizontal: 16 },
  sortPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: GLASS.border,
  },
  sortPillActive: { backgroundColor: "rgba(34,211,238,0.16)", borderColor: COLORS.cyan },
  sortText: { color: COLORS.muted, fontSize: 12.5, fontWeight: "700" },
  sortTextActive: { color: COLORS.text },
  topicRow: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  fab: { position: "absolute", right: 18 },
  fabGradient: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center" },
});
