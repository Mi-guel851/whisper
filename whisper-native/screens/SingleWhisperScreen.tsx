import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CoinTipSheet } from "@/components/CoinTipSheet";
import { IconButton } from "@/components/GradientButton";
import { LoadingScreen, Screen } from "@/components/Screen";
import { Sheet, SheetRow } from "@/components/Sheet";
import { FeedCard } from "@/components/feed/FeedCard";
import type { MainStackParamList } from "@/navigation/types";
import { FEED_REPLY_COST, fetchWallet } from "@/lib/coins";
import {
  apiBase,
  blockAuthor,
  claimFeedPhoto,
  createFeedPost,
  fetchPost,
  fetchThread,
  reportPost,
  toggleLike,
} from "@/lib/feed";
import { optimisticLike, optimisticVote } from "@/lib/feedState";
import { formatCoins, timeAgo } from "@/lib/format";
import { vibrate } from "@/lib/haptics";
import { useAnonName } from "@/lib/identity";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { COLORS, GLASS, GRADIENT_COLORS, RADIUS } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import type { FeedPost } from "@/lib/types";

type Props = NativeStackScreenProps<MainStackParamList, "SingleWhisper">;

/**
 * One post and its thread.
 *
 * THE RECURSION QUESTION, AGAIN, AND WHY THIS SCREEN EXISTS
 *
 * The web app renders replies inline under their parent, four levels deep,
 * because a page can afford to. A `FlatList` cannot: nested virtualised lists
 * inside a virtualised list is the classic way to make a phone drop frames, and
 * a thread of unknown depth makes the item height unknowable in advance.
 *
 * So this screen shows the root post as a card, then its replies as a flat,
 * chronological list — each one still a card, each one able to open *its* own
 * thread. The structure is the same data; the presentation is the one a phone
 * can render. Replies to a reply are counted on the reply and reachable by
 * tapping it, which is how every large app solves this.
 *
 * THE COMPOSER
 *
 * At the bottom, always visible, and free: a reply costs nothing
 * (`FEED_REPLY_COST` is 0, and the database only charges for roots). The
 * composer posts through the same `/api/coins/feed-post` route as a new post,
 * with `parentPostId` set.
 */
export function SingleWhisperScreen({ navigation, route }: Props) {
  const { postId } = route.params;
  const rootNavigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const insets = useSafeAreaInsets();
  const { userId, session } = useSession();
  const { showToast } = useToast();

  const [root, setRoot] = useState<FeedPost | null>(null);
  const [replies, setReplies] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [claimedPhoto, setClaimedPhoto] = useState<Record<string, string>>({});
  const [imageState, setImageState] = useState<Record<string, "locked" | "loading" | "spent" | "unavailable">>({});
  const [balance, setBalance] = useState<number | null>(null);
  const [menuPost, setMenuPost] = useState<FeedPost | null>(null);
  const [tipping, setTipping] = useState(false);
  const [pollChoices, setPollChoices] = useState<Record<string, number>>({});
  const [pollCounts, setPollCounts] = useState<Record<string, number[]>>({});

  const rootAuthor = useAnonName(root?.author_id);

  const load = useCallback(async () => {
    const [post, thread] = await Promise.all([fetchPost(postId), fetchThread(postId)]);

    setRoot(post);
    setReplies(thread.filter((row) => row.parent_post_id === postId));

    const all = [post, ...thread].filter((row): row is FeedPost => Boolean(row));

    setLiked((current) => {
      const next = { ...current };
      for (const row of all) next[row.id] = Boolean(row.viewer_liked);
      return next;
    });
    setLikeCounts((current) => {
      const next = { ...current };
      for (const row of all) next[row.id] = Number(row.like_count ?? 0);
      return next;
    });
    setReplyCounts((current) => {
      const next = { ...current };
      for (const row of all) next[row.id] = Number(row.reply_count ?? 0);
      return next;
    });
    setImageState((current) => {
      const next = { ...current };
      for (const row of all) {
        if (row.has_image && !next[row.id]) {
          next[row.id] = row.author_id === userId || row.viewer_image_viewed ? "spent" : "locked";
        }
      }
      return next;
    });
    setPollChoices((current) => {
      const next = { ...current };
      for (const row of all) if (typeof row.viewer_vote === "number") next[row.id] = row.viewer_vote;
      return next;
    });
    setPollCounts((current) => {
      const next = { ...current };
      for (const row of all) if (row.poll_counts) next[row.id] = row.poll_counts;
      return next;
    });

    setLoading(false);
  }, [postId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    void fetchWallet(userId).then((wallet) => setBalance(wallet?.balance ?? 0));
  }, [userId]);

  const toggle = useCallback(
    async (post: FeedPost) => {
      if (!userId) return;

      const wasLiked = Boolean(liked[post.id]);
      const optimistic = optimisticLike(likeCounts[post.id] ?? 0, wasLiked);

      setLiked((current) => ({ ...current, [post.id]: optimistic.liked }));
      setLikeCounts((current) => ({ ...current, [post.id]: optimistic.count }));
      vibrate("select");

      try {
        await toggleLike(post.id, userId, wasLiked);
      } catch {
        setLiked((current) => ({ ...current, [post.id]: wasLiked }));
        setLikeCounts((current) => ({ ...current, [post.id]: Math.max(0, optimistic.count - 1) }));
        showToast("Couldn't save that like.", { variant: "error" });
      }
    },
    [likeCounts, liked, showToast, userId]
  );

  const vote = useCallback(
    async (post: FeedPost, index: number) => {
      if (!userId) return;

      const previous = pollChoices[post.id] ?? null;
      setPollChoices((current) => ({ ...current, [post.id]: index }));
      setPollCounts((current) => ({
        ...current,
        [post.id]: optimisticVote(current[post.id] ?? post.poll_counts ?? [], previous, index),
      }));

      const { error } = await supabase.rpc("vote_public_feed_poll", {
        p_post_id: post.id,
        p_option_index: index,
      });

      if (error) {
        setPollChoices((current) => {
          const next = { ...current };
          if (previous === null) delete next[post.id];
          else next[post.id] = previous;
          return next;
        });
        showToast("Couldn't record that vote.", { variant: "error" });
      }
    },
    [pollChoices, showToast, userId]
  );

  const openPhoto = useCallback(
    async (post: FeedPost) => {
      if (!session?.access_token) return;
      if (post.author_id === userId) return;

      setImageState((current) => ({ ...current, [post.id]: "loading" }));
      const result = await claimFeedPhoto(post.id, session.access_token);

      if ("error" in result) {
        setImageState((current) => ({ ...current, [post.id]: "unavailable" }));
        showToast(result.error, { variant: "error" });
        return;
      }

      setClaimedPhoto((current) => ({ ...current, [post.id]: result.uri }));
      setImageState((current) => ({ ...current, [post.id]: "spent" }));
    },
    [session?.access_token, showToast, userId]
  );

  const reply = useCallback(async () => {
    const body = draft.trim();
    if (!body || !userId || sending) return;

    if (!session?.access_token) {
      showToast("Your session expired. Sign in again.", { variant: "error" });
      return;
    }

    setSending(true);
    setDraft("");

    const result = await createFeedPost({ body, parentPostId: postId }, session.access_token);

    setSending(false);

    if ("error" in result) {
      setDraft(body);
      showToast(result.error, { variant: "error" });
      return;
    }

    vibrate("success");
    setReplies((current) => [...current, result.post]);
    setReplyCounts((current) => ({ ...current, [postId]: (current[postId] ?? 0) + 1 }));
    setRoot((current) => (current ? { ...current, reply_count: (current.reply_count ?? 0) + 1 } : current));
    showToast("Reply posted", { variant: "success" });
  }, [draft, postId, sending, session?.access_token, showToast, userId]);

  const header = useMemo(
    () => (
      <View>
        {root ? (
          <FeedCard
            post={root}
            myId={userId ?? ""}
            liked={Boolean(liked[root.id])}
            likeCount={likeCounts[root.id] ?? 0}
            replyCount={replyCounts[root.id] ?? 0}
            imageState={imageState[root.id] ?? "locked"}
            openImageUri={claimedPhoto[root.id] ?? null}
            pollCounts={pollCounts[root.id]}
            pollChoice={pollChoices[root.id] ?? null}
            onToggleLike={() => void toggle(root)}
            onVote={(index) => void vote(root, index)}
            onOpenGallery={() => void openPhoto(root)}
            onOpenThread={() => navigation.goBack()}
            onOpenMenu={() => setMenuPost(root)}
            onTip={() => setTipping(true)}
            highlight
          />
        ) : null}

        <View style={styles.threadHeading}>
          <Ionicons name="chatbubbles-outline" size={15} color={COLORS.purple} />
          <Text style={styles.threadTitle}>
            {replies.length === 0
              ? "No replies yet"
              : `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
          </Text>
          <Text style={styles.threadHint}>Replies are free</Text>
        </View>
      </View>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [root, replies.length, liked, likeCounts, replyCounts, imageState, claimedPhoto, pollChoices, pollCounts, userId]
  );

  if (loading) return <LoadingScreen label="Opening whisper" />;

  return (
    <Screen padded={false}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <IconButton icon="chevron-back" size={40} onPress={() => navigation.goBack()} accessibilityLabel="Go back" />
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Whisper</Text>
          <Text style={styles.headerSub}>
            {root ? `${rootAuthor} · ${timeAgo(root.created_at)}` : "This post is gone"}
          </Text>
        </View>
        <IconButton
          icon="ellipsis-horizontal"
          size={40}
          onPress={() => root && setMenuPost(root)}
          accessibilityLabel="Post options"
        />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <FlatList
          data={replies}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <FeedCard
              post={item}
              myId={userId ?? ""}
              liked={Boolean(liked[item.id])}
              likeCount={likeCounts[item.id] ?? 0}
              replyCount={replyCounts[item.id] ?? 0}
              imageState={imageState[item.id] ?? "locked"}
              openImageUri={claimedPhoto[item.id] ?? null}
              pollCounts={pollCounts[item.id]}
              pollChoice={pollChoices[item.id] ?? null}
              onToggleLike={() => void toggle(item)}
              onVote={(index) => void vote(item, index)}
              onOpenGallery={() => void openPhoto(item)}
              onOpenThread={() => navigation.push("SingleWhisper", { postId: item.id })}
              onOpenMenu={() => setMenuPost(item)}
              onTip={() => setTipping(true)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyThread}>
              <Text style={styles.emptyThreadText}>
                Nobody has replied yet. Yours would be the first.
              </Text>
            </View>
          }
        />

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <BlurView intensity={GLASS.blurIntensity} tint="dark" style={styles.composerInner}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Reply anonymously…"
              placeholderTextColor={COLORS.subtle}
              multiline
              keyboardAppearance="dark"
              style={styles.input}
            />

            <Pressable onPress={() => void reply()} disabled={sending || !draft.trim()} accessibilityLabel="Post reply">
              <LinearGradient
                colors={GRADIENT_COLORS}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.sendButton, (!draft.trim() || sending) && styles.disabled]}
              >
                <Ionicons name="arrow-up" size={19} color="#0a0814" />
              </LinearGradient>
            </Pressable>
          </BlurView>

          <Text style={styles.composerHint}>
            {FEED_REPLY_COST === 0 ? "Replies are free · " : ""}
            {formatCoins(balance ?? 0)} coins in your wallet
          </Text>
        </View>
      </KeyboardAvoidingView>

      <CoinTipSheet
        visible={tipping}
        onClose={() => setTipping(false)}
        balance={balance}
        onDone={(next) => {
          if (typeof next === "number") setBalance(next);
        }}
      />

      <Sheet visible={Boolean(menuPost)} onClose={() => setMenuPost(null)} title="Post options">
        {menuPost && (
          <View style={{ paddingBottom: 10 }}>
            <SheetRow
              icon="person-outline"
              label="View author"
              detail="See their profile and their link"
              onPress={() => {
                setMenuPost(null);
                rootNavigation.navigate("UserProfile", { userId: menuPost.author_id });
              }}
            />
            <SheetRow
              icon="flag-outline"
              label="Report"
              onPress={() => {
                const target = menuPost;
                setMenuPost(null);
                if (!target || !userId) return;
                void reportPost(target.id, userId, "Reported from a thread")
                  .then(() => showToast("Thanks — we'll take a look.", { variant: "success" }))
                  .catch(() => showToast("Couldn't send that report.", { variant: "error" }));
              }}
            />
            <SheetRow
              icon="ban-outline"
              label="Block author"
              onPress={() => {
                const target = menuPost;
                setMenuPost(null);
                if (!target || !userId) return;
                void blockAuthor(userId, target.author_id)
                  .then(() => {
                    showToast("Blocked", { variant: "subtle" });
                    navigation.goBack();
                  })
                  .catch(() => showToast("Couldn't block that account.", { variant: "error" }));
              }}
            />
            {menuPost.author_id === userId && (
              <SheetRow
                icon="trash-outline"
                label="Delete post"
                danger
                onPress={() => {
                  const target = menuPost;
                  setMenuPost(null);
                  if (!target) return;
                  void supabase
                    .from("public_feed_posts")
                    .delete()
                    .eq("id", target.id)
                    .then(({ error }) => {
                      if (error) {
                        showToast(error.message, { variant: "error" });
                        return;
                      }
                      showToast("Deleted", { variant: "subtle" });
                      navigation.goBack();
                    });
                }}
              />
            )}
            <SheetRow
              icon="link-outline"
              label="Copy link"
              detail={`${apiBase()}/public-feed?post=${menuPost.id}`}
              onPress={() => setMenuPost(null)}
            />
          </View>
        )}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GLASS.border,
  },
  headerText: { flex: 1 },
  headerTitle: { color: COLORS.text, fontSize: 16, fontWeight: "800" },
  headerSub: { color: COLORS.muted, fontSize: 11.5, fontWeight: "600", marginTop: 1 },

  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  threadHeading: { flexDirection: "row", alignItems: "center", gap: 7, marginVertical: 10 },
  threadTitle: { color: COLORS.text, fontSize: 14, fontWeight: "800" },
  threadHint: { color: COLORS.subtle, fontSize: 11.5, fontWeight: "600", marginLeft: "auto" },

  emptyThread: { paddingVertical: 30, alignItems: "center" },
  emptyThreadText: { color: COLORS.muted, fontSize: 13.5, textAlign: "center" },

  composer: { paddingHorizontal: 12, paddingTop: 8 },
  composerInner: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.6)",
    padding: 8,
    overflow: "hidden",
  },
  input: {
    flex: 1,
    color: COLORS.text,
    fontSize: 15.5,
    maxHeight: 110,
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 10,
  },
  sendButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.45 },
  composerHint: { color: COLORS.subtle, fontSize: 10.5, textAlign: "center", marginTop: 6 },
});
