import { useFocusEffect, router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { FeedCard } from "@/components/feed/FeedCard";
import { IconButton } from "@/components/GradientButton";
import { EmptyState, Screen, SkeletonRow } from "@/components/Screen";
import { Sheet, SheetRow } from "@/components/Sheet";
import { CoinTipSheet } from "@/components/CoinTipSheet";
import { COLORS, GRADIENT_COLORS, RADIUS, glow, useStyles } from "@/lib/theme";
import { fetchSavedPosts, type SavedPost } from "@/lib/feed";
import { fetchWallet } from "@/lib/coins";
import { vibrate } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { useFeedEngagement } from "@/lib/useFeedEngagement";
import type { FeedPost } from "@/lib/types";

const PAGE_SIZE = 30;

/**
 * Saved posts — the whispers you bookmarked, newest save first.
 *
 * A SAVE IS A POINTER, NOT A COPY
 *
 * The feed expires every post 24 hours after it is written, and a saved row
 * cascades away with its post — see `202608240002_saved_posts.sql`. The subtitle
 * says so up front, so a whisper that vanishes from this list reads as the design
 * rather than as data loss. A "Saved" tab that resurrected other people's deleted
 * confessions would break the one promise the product is built on.
 *
 * The rows are rendered with the feed's own card, so a saved post looks exactly
 * like the post that was saved — including its like button, its poll and its photo
 * claim. Only the menu differs: here the primary action is unsaving.
 */
export default function Saved() {
  const styles = useStyles(makeStyles);
  const { userId } = useSession();
  const { showToast } = useToast();

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
    toggleLike,
    vote,
    openPhoto,
    toggleSaved,
  } = useFeedEngagement(userId);

  const [rows, setRows] = useState<SavedPost[]>([]);
  /* A ref of what is on screen, so the merge is computed before any setter runs —
     an updater has to be pure, and `seed` writes eight other states. */
  const rowsRef = useRef<SavedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [menuPost, setMenuPost] = useState<FeedPost | null>(null);
  const [tipPost, setTipPost] = useState<FeedPost | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  const load = useCallback(
    async (options: { reset?: boolean; offset?: number } = {}) => {
      const reset = options.reset ?? true;
      const offset = reset ? 0 : options.offset ?? 0;

      try {
        const page = await fetchSavedPosts(offset, PAGE_SIZE);

        if (page.mode === "unavailable") {
          setUnavailable(true);
          setRows([]);
          setHasMore(false);
          return;
        }

        setUnavailable(false);

        const base = reset ? [] : rowsRef.current;
        const seen = new Set(base.map((row) => row.id));
        const next = [...base, ...page.rows.filter((row) => !seen.has(row.id))];
        rowsRef.current = next;
        setRows(next);

        /* The freshly arrived page seeds the engagement state: the server's
           counts for this viewer win over anything optimistic. */
        seed(page.rows, userId ?? "");
        setHasMore(page.hasMore);
      } catch (error) {
        console.warn("[saved] load failed:", error);
        if (reset) setRows([]);
        showToast("Couldn't load your saved whispers.", { variant: "error" });
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [seed, showToast, userId]
  );

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void load({ reset: true });
      void fetchWallet(userId).then((wallet) => setBalance(wallet?.balance ?? 0));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId])
  );

  /**
   * Unsave from the card.
   *
   * On this screen the list *is* the set of saves, so a post comes out of it
   * immediately — waiting for the row to disappear is what makes a control feel
   * broken. If the server disagrees (the save was already gone, or the request
   * failed) the row is put back rather than left missing.
   */
  const unsave = useCallback(
    async (post: FeedPost) => {
      const snapshot = rowsRef.current;
      const next = snapshot.filter((row) => row.id !== post.id);
      rowsRef.current = next;
      setRows(next);
      vibrate("select");

      const nowSaved = await toggleSaved(post);

      /* `true` means it is saved now — the row was already gone from the server
         and the tap put it back, so a list that had just dropped it would be
         wrong. `null` means the feature is missing from this database. */
      if (nowSaved !== false) {
        rowsRef.current = snapshot;
        setRows(snapshot);
        if (nowSaved === null) {
          showToast("Saved posts aren't available on this database.", { variant: "error" });
        }
      }
    },
    [showToast, toggleSaved]
  );

  const loadMore = () => {
    if (!hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    void load({ reset: false, offset: rowsRef.current.length });
  };

  return (
    <Screen padded={false} edges={["left", "right"]}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={COLORS.cyan}
            colors={[COLORS.cyan, COLORS.purple]}
            progressBackgroundColor={COLORS.surface}
            onRefresh={() => {
              setRefreshing(true);
              void load({ reset: true });
            }}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <IconButton
                icon="arrow-back"
                size={40}
                onPress={() => router.back()}
                accessibilityLabel="Back"
              />
              <View style={styles.headerText}>
                <Text style={styles.title}>Saved posts</Text>
                <Text style={styles.subtitle}>
                  Private to you. A saved whisper lives as long as the whisper does — the feed expires
                  posts 24 hours after they are written.
                </Text>
              </View>
            </View>
          </View>
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
            onOpenThread={() =>
              router.push({ pathname: "/whisper-detail", params: { postId: item.id } })
            }
            onOpenMenu={() => setMenuPost(item)}
            saved={savesAvailable ? Boolean(savedIds[item.id] ?? true) : null}
            onToggleSave={() => void unsave(item)}
            onTip={() => setTipPost(item)}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <View>
              <SkeletonRow height={148} />
              <SkeletonRow height={168} />
            </View>
          ) : unavailable ? (
            <EmptyState
              icon="cloud-offline-outline"
              title="Saved posts aren't set up here"
              body="This database doesn't have the saved-posts migration applied yet, so nothing can be saved. Everything else in the feed works."
            />
          ) : (
            <EmptyState
              icon="bookmark-outline"
              title="Nothing saved yet"
              body="Tap the bookmark on a whisper and it lands here — privately, for the rest of that whisper's 24 hours."
              actionLabel="Back to the feed"
              onAction={() => router.back()}
            />
          )
        }
        ListFooterComponent={
          hasMore && rows.length > 0 ? (
            <Pressable onPress={loadMore} style={styles.more} accessibilityLabel="Load more saves">
              {loadingMore ? (
                <Text style={styles.moreText}>Loading…</Text>
              ) : (
                <LinearGradient
                  colors={GRADIENT_COLORS}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.moreGradient, glow(COLORS.purple, 14, 0.35)]}
                >
                  <Text style={styles.moreLabel}>Load more</Text>
                </LinearGradient>
              )}
            </Pressable>
          ) : null
        }
      />

      {/* One overflow sheet at screen level. Unsave is the first row here
          because on this screen it is the action people came for. */}
      <Sheet visible={Boolean(menuPost)} onClose={() => setMenuPost(null)} title="Post options">
        {menuPost && (
          <View style={{ paddingBottom: 10 }}>
            <SheetRow
              icon="bookmark"
              label="Remove from saved"
              detail="It stays in the feed until it expires"
              onPress={() => {
                const target = menuPost;
                setMenuPost(null);
                void unsave(target);
              }}
            />
            <SheetRow
              icon="chatbubbles-outline"
              label="Open the thread"
              detail={`${menuPost.reply_count ?? 0} replies`}
              onPress={() => {
                const target = menuPost;
                setMenuPost(null);
                if (target) {
                  router.push({ pathname: "/whisper-detail", params: { postId: target.id } });
                }
              }}
            />
            <SheetRow
              icon="person-outline"
              label="See the author"
              onPress={() => {
                const target = menuPost;
                setMenuPost(null);
                if (target) router.push({ pathname: "/u", params: { userId: target.author_id } });
              }}
            />
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

const makeStyles = () => StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40, flexGrow: 1 },
  header: { paddingTop: 4, paddingBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headerText: { flex: 1, paddingTop: 2 },
  title: { color: COLORS.text, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  subtitle: { color: COLORS.muted, fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  more: { marginTop: 6, marginBottom: 8, borderRadius: RADIUS.pill, overflow: "hidden" },
  moreGradient: { paddingVertical: 13, alignItems: "center", borderRadius: RADIUS.pill },
  moreLabel: { color: COLORS.text, fontSize: 14, fontWeight: "700" },
  moreText: { color: COLORS.muted, fontSize: 13, textAlign: "center", paddingVertical: 13 },
});
