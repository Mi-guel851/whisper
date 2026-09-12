import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FeedCard, TopicChip } from "@/components/feed/FeedCard";
import { CoinBadge } from "@/components/CoinBadge";
import { IconButton } from "@/components/GradientButton";
import { SearchField } from "@/components/Input";
import { Logo } from "@/components/Logo";
import { EmptyState, InlineLoader, Screen, SkeletonRow } from "@/components/Screen";
import { Sheet, SheetRow } from "@/components/Sheet";
import { WhispersAi } from "@/components/WhispersAi";
import { FabButton } from "@/components/FabButton";
import { CoinTipSheet } from "@/components/CoinTipSheet";
import { refreshBadges, useBadges, watchBadges } from "@/lib/badges";
import { fetchWallet } from "@/lib/coins";
import { useFeedEngagement } from "@/lib/useFeedEngagement";
import {
  FEED_PAGE_SIZE,
  FEED_SORTS,
  FEED_TOPICS,
  apiBase,
  blockAuthor,
  createFeedPost,
  fetchFeedPage,
  fetchSpotlight,
  fetchThread,
  reportPost,
  sliceFallback,
  type FeedSort,
} from "@/lib/feed";
import { dailyQuestionFor } from "@/lib/games";
import type { FeedPost } from "@/lib/types";
import { vibrate } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { CARD_SHADOW, COLORS, GLASS, GRADIENT_COLORS, GRADIENT_END, GRADIENT_START, RADIUS, TAB_BAR_SPACE, glow, useStyles } from "@/lib/theme";
import { supabase } from "@/lib/supabase";

/**
 * The Daily Whisper spotlight — the question of the day, plus the post the
 * day's engagement lifted highest.
 *
 * WHY THIS CARD EXISTS AT ALL
 *
 * The web feed leads with the same pair (`DailyQuestionCard` +
 * `WhisperOfTheDay`), for the same reason: a feed of other people's whispers
 * has a cold first second. A question addressed to the reader gives the scroll
 * a first thing to react to, and the spotlight proves that reacting is worth
 * it — yesterday's answers are right there.
 *
 * The question itself is a pure function of the date, computed on mount — it
 * costs no request and cannot be stale. The spotlight is one RPC; when there
 * is nothing to crown yet (an empty morning) the card is the question alone,
 * which is still a complete feature rather than a half-rendered one.
 */
function DailySpotlightCard({
  question,
  spotlight,
}: {
  question: string;
  spotlight: FeedPost | null;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.spotlight}>
      <View style={[styles.spotlightInner, glow(COLORS.purple, 22, 0.16)]}>
        <View style={styles.spotlightHead}>
          <LinearGradient
            colors={GRADIENT_COLORS}
            start={GRADIENT_START}
            end={GRADIENT_END}
            style={styles.spotlightMark}
          >
            <Ionicons name="sparkles" size={13} color={COLORS.background} />
          </LinearGradient>
          <Text style={styles.spotlightEyebrow}>Daily Whisper</Text>
          <Text style={styles.spotlightDate}>
            {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}
          </Text>
        </View>

        <Text style={styles.spotlightQuestion}>{question}</Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            vibrate("tap");
            router.push("/create-whisper");
          }}
          style={styles.spotlightCta}
        >
          <Text style={styles.spotlightCtaText}>Whisper it</Text>
          <Ionicons name="arrow-forward" size={13} color={COLORS.background} />
        </Pressable>

        {spotlight ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              vibrate("tap");
              router.push({ pathname: "/whisper-detail", params: { postId: spotlight.id } });
            }}
            style={styles.dayPost}
          >
            <View style={styles.dayPostHead}>
              <Text style={styles.dayPostLabel}>Whisper of the day</Text>
              <Ionicons name="chevron-forward" size={13} color={COLORS.subtle} />
            </View>
            <Text style={styles.dayPostBody} numberOfLines={2}>
              {spotlight.body}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

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
export default function Feed() {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { userId, session } = useSession();
  const { showToast } = useToast();

  const [posts, setPosts] = useState<FeedPost[]>([]);

  /* The initial-load entrance: the first page staggers in (55ms steps, the

     web's stagger default); pages loaded after it appear without delay, the

     way a scroll-fill must not replay the choreography. */

  const [firstPaint, setFirstPaint] = useState(true);
  const [sort, setSort] = useState<FeedSort>("for_you");
  const [topic, setTopic] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  /* Likes, polls, photo claims and saves all live in one hook, shared with the
     saved-posts screen — same card, same answers. */
  const {
    liked,
    likeCounts,
    replyCounts,
    imageStates,
    imageUris,
    pollCounts,
    pollChoices,
    pollPending,
    savedIds,
    savesAvailable,
    seed,
    markSaved,
    noteReply,
    toggleLike,
    vote,
    openPhoto,
    toggleSaved,
  } = useFeedEngagement(userId);

  const [menuPost, setMenuPost] = useState<FeedPost | null>(null);
  /* Threads are opened one at a time and cached once fetched — the site starts
     every thread closed and pulls the replies on the first tap, which is what
     keeps a page of whispers one request instead of twenty. */
  const [threads, setThreads] = useState<Record<string, FeedPost[]>>({});
  const [loadingThread, setLoadingThread] = useState<Record<string, boolean>>({});
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [tipPost, setTipPost] = useState<FeedPost | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  /* The Daily Whisper. The question is a pure function of the date — same
     question for everyone, same day, no request — and the spotlight post is
     the one the day's engagement lifted highest (null before anyone has
     engaged, or on a server without the RPC). Both sit at the very top of the
     feed, the way the web's FeedClient places them. */
  const [spotlight, setSpotlight] = useState<FeedPost | null>(null);
  const dailyQuestion = useMemo(() => dailyQuestionFor(new Date()), []);

  /* The bell's badge is the whisper inbox plus the alert history — the two
     lists the Notifications tab holds, which is exactly what the tab bar shows
     on that tab. */
  const badges = useBadges();
  const notifications = badges.unreadWhispers + badges.unreadAlerts;

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

      /* The server's counts for the viewer, applied in one place. */
      seed(fresh, userId ?? "");
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
        /* The first page has painted; later pages mount without the stagger. */
        if (reset) setFirstPaint(false);

        setOffset(nextOffset + FEED_PAGE_SIZE);
        setHasMore(
          page.mode === "rpc" ? page.rows.length === FEED_PAGE_SIZE : nextOffset + FEED_PAGE_SIZE < page.rows.length
        );

        void markSaved(all);
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
    [applyRows, markSaved, offset, query, showToast]
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

  /* The spotlight loads with the feed and again whenever the pull-to-refresh
     runs — it is "of the day", but a refresh that didn't refresh it would be
     one more thing to explain. */
  useEffect(() => {
    let alive = true;
    void fetchSpotlight().then((post) => {
      if (alive) setSpotlight(post);
    });
    return () => {
      alive = false;
    };
  }, []);

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

  /* Liking, voting, claiming a photo and saving are the hook's — see
     `useFeedEngagement`. The card's callbacks below name them directly. */

  /* -----------------------------------------------------------------------
     Threads
     -------------------------------------------------------------------- */

  const openThread = useCallback(
    async (post: FeedPost) => {
      /* Already open: the tap closes it. */
      if (threads[post.id]) {
        setThreads((value) => {
          const next = { ...value };
          delete next[post.id];
          return next;
        });
        setReplyTo((value) => (value === post.id ? null : value));
        setReplyDraft("");
        return;
      }

      setLoadingThread((value) => ({ ...value, [post.id]: true }));
      vibrate("tap");

      const rows = await fetchThread(post.id);

      /* The RPC returns the root as well; the card is already on screen. */
      const replies = rows
        .filter((row) => row.id !== post.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));

      setLoadingThread((value) => ({ ...value, [post.id]: false }));
      setThreads((value) => ({ ...value, [post.id]: replies }));
      seed(replies, userId ?? "");
    },
    [seed, threads, userId]
  );

  const sendReply = useCallback(
    async (parent: FeedPost) => {
      const body = replyDraft.trim();
      const token = session?.access_token;

      if (!body || !token || replyBusy) return;

      setReplyBusy(true);
      const result = await createFeedPost({ body, parentPostId: parent.id }, token);
      setReplyBusy(false);

      if ("error" in result) {
        showToast(result.error, { variant: "error" });
        return;
      }

      setThreads((value) => ({
        ...value,
        [parent.id]: [...(value[parent.id] ?? []), result.post],
      }));
      seed([result.post], userId ?? "");
      noteReply(parent.id);
      setReplyDraft("");
      setReplyTo(null);
      vibrate("success");
      showToast("Reply sent", { variant: "success" });
    },
    [noteReply, replyBusy, replyDraft, seed, session?.access_token, showToast, userId]
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
          <CoinBadge balance={balance} onPress={() => router.push("/coins")} />
          <IconButton
            icon="search-outline"
            size={40}
            onPress={() => setSearchOpen((open) => !open)}
            accessibilityLabel={searchOpen ? "Close search" : "Search"}
          />
          <IconButton
            icon="bookmark-outline"
            size={40}
            onPress={() => router.push("/saved")}
            accessibilityLabel="Saved posts"
          />
          <IconButton
            icon="notifications-outline"
            size={40}
            badge={notifications}
            onPress={() => router.push("/(tabs)/notifications")}
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
            <DailySpotlightCard question={dailyQuestion} spotlight={spotlight} />
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
              void fetchSpotlight().then((post) => setSpotlight(post));
              if (userId) void refreshBadges(userId);
            }}
          />
        }
        renderItem={({ item, index }) => (
          <View>
          <FeedCard
            enteringIndex={firstPaint ? index : undefined}
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
            onOpenThread={() => void openThread(item)}
            onOpenMenu={() => setMenuPost(item)}
            saved={savesAvailable ? Boolean(savedIds[item.id]) : null}
            onToggleSave={() => void toggleSaved(item)}
            onTip={() => setTipPost(item)}
            threadOpen={Boolean(threads[item.id])}
            onOpenThreadScreen={() =>
              router.push({ pathname: "/whisper-detail", params: { postId: item.id } })
            }
          />

          {/* The thread, indented the way the site indents it — only one level,
              because every reply avatar is the same size and a deeper staircase
              is what makes a thread unreadable on a phone. */}
          {loadingThread[item.id] && (
            <View style={styles.threadLoading}>
              <ActivityIndicator color={COLORS.cyan} size="small" />
            </View>
          )}

          {(threads[item.id] ?? []).map((reply) => (
            <View key={reply.id} style={styles.threadReply}>
              <FeedCard
                post={reply}
                myId={userId ?? ""}
                liked={Boolean(liked[reply.id])}
                likeCount={likeCounts[reply.id] ?? 0}
                replyCount={replyCounts[reply.id] ?? 0}
                imageState={imageStates[reply.id] ?? "locked"}
                openImageUri={imageUris[reply.id] ?? null}
                pollCounts={pollCounts[reply.id]}
                pollChoice={pollChoices[reply.id] ?? null}
                pollPending={Boolean(pollPending[reply.id])}
                onToggleLike={() => void toggleLike(reply)}
                onVote={(index) => void vote(reply, index)}
                onOpenGallery={() => void openPhoto(reply)}
                onOpenThread={() =>
                  router.push({ pathname: "/whisper-detail", params: { postId: reply.id } })
                }
                onOpenMenu={() => setMenuPost(reply)}
                saved={savesAvailable ? Boolean(savedIds[reply.id]) : null}
                onToggleSave={() => void toggleSaved(reply)}
                onTip={() => setTipPost(reply)}
              />
            </View>
          ))}

          {threads[item.id] && (
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
            <View style={styles.replyBox}>
              <TextInput
                value={replyTo === item.id ? replyDraft : ""}
                onFocus={() => setReplyTo(item.id)}
                onChangeText={(value) => {
                  setReplyTo(item.id);
                  setReplyDraft(value.slice(0, 500));
                }}
                placeholder="Reply anonymously…"
                placeholderTextColor={COLORS.subtle}
                keyboardAppearance={GLASS.tint === "light" ? "light" : "dark"}
                multiline
                style={styles.replyInput}
              />

              <Pressable
                onPress={() => void sendReply(item)}
                disabled={replyTo !== item.id || !replyDraft.trim() || replyBusy}
                style={[
                  styles.replySend,
                  (replyTo !== item.id || !replyDraft.trim() || replyBusy) && styles.replySendOff,
                ]}
                accessibilityLabel="Send reply"
              >
                <LinearGradient
                  colors={GRADIENT_COLORS}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.replySendGradient}
                >
                  {replyBusy ? (
                    <ActivityIndicator color={COLORS.text} size="small" />
                  ) : (
                    <Ionicons name="arrow-up" size={17} color={COLORS.text} />
                  )}
                </LinearGradient>
              </Pressable>
            </View>
            </KeyboardAvoidingView>
          )}
          </View>
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
              onAction={() => router.push("/create-whisper")}
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
          pressable: nested touchables both fire, which navigates twice.
          Entrance and press are the web FAB's own specs: {opacity:0, scale:.6}
          arriving on the snappy spring, .92 under the finger. */}
      <FabButton accessibilityLabel="Create a whisper" onPress={() => router.push("/create-whisper")} style={[styles.fab, { bottom: TAB_BAR_SPACE + 6 }]}>
        <LinearGradient
          colors={GRADIENT_COLORS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.fabGradient, glow(COLORS.cyan, 22, 0.45)]}
        >
          <Ionicons name="add" size={30} color={COLORS.contrast} />
        </LinearGradient>
      </FabButton>

      {/* The overflow sheet, rendered once at screen level rather than per card:
          forty mounted portals to serve one open sheet is how a list gets slow. */}
      <Sheet visible={Boolean(menuPost)} onClose={() => setMenuPost(null)} title="Post options">
        {menuPost && (
          <View style={{ paddingBottom: 10 }}>
            <SheetRow icon="link-outline" label="Copy link" onPress={() => void copyLink(menuPost).then(() => setMenuPost(null))} />
            <SheetRow icon="share-social-outline" label="Share" onPress={() => void sharePost(menuPost).then(() => setMenuPost(null))} />
            {savesAvailable && (
              <SheetRow
                icon={savedIds[menuPost.id] ? "bookmark" : "bookmark-outline"}
                label={savedIds[menuPost.id] ? "Remove from saved" : "Save this whisper"}
                detail="Private — the author is never told"
                onPress={() => {
                  const target = menuPost;
                  setMenuPost(null);
                  void toggleSaved(target);
                }}
              />
            )}
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

      {/* The assistant parks above the compose button — the site's drawer and
          FAB comments both reserve that corner for it. */}
      <WhispersAi bottomOffset={TAB_BAR_SPACE + 6 + 58 + 14} />

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

const makeStyles = () => StyleSheet.create({
  spotlight: { marginTop: 14, marginBottom: 6 },
  spotlightInner: {
    padding: 16,
    gap: 10,
    borderRadius: RADIUS.xl,
    backgroundColor: GLASS.background,
    borderWidth: 1,
    borderColor: "rgba(168,85,247,0.32)",
    ...CARD_SHADOW,
  },
  spotlightHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  spotlightMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  spotlightEyebrow: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.3,
    textTransform: "uppercase",
  },
  spotlightDate: { marginLeft: "auto", color: COLORS.subtle, fontSize: 10.5, fontWeight: "700" },
  spotlightQuestion: {
    color: COLORS.text,
    fontSize: 16.5,
    fontWeight: "800",
    lineHeight: 23,
  },
  spotlightCta: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(34,211,238,0.14)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.32)",
  },
  spotlightCtaText: { color: COLORS.cyan, fontSize: 12.5, fontWeight: "900" },
  dayPost: {
    marginTop: 2,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)",
    gap: 4,
  },
  dayPostHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dayPostLabel: {
    color: COLORS.purple,
    fontSize: 10.5,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  dayPostBody: { color: COLORS.muted, fontSize: 13, lineHeight: 18, fontStyle: "italic" },
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
  threadLoading: { paddingVertical: 14, alignItems: "center" },
  threadReply: { paddingLeft: 14 },
  replyBox: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    marginTop: 8,
    marginBottom: 16,
    paddingLeft: 14,
  },
  replyInput: {
    flex: 1,
    maxHeight: 96,
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 19,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: GLASS.background,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  replySend: { borderRadius: 20, overflow: "hidden" },
  replySendOff: { opacity: 0.45 },
  replySendGradient: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  fab: { position: "absolute", right: 18 },
  fabGradient: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center" },
});
