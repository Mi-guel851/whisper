import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { Avatar } from "../Avatar";
import { GlassCard } from "../GlassCard";
import { Poll } from "./Poll";
import { PhotoWhisper } from "./PhotoWhisper";
import type { FeedImageState } from "@/lib/feedState";
import { formatCount, timeAgo } from "@/lib/format";
import { isCreatorPost, topicMeta } from "@/lib/feed";
import type { FeedPost } from "@/lib/types";
import { useAnonName } from "@/lib/identity";
import { vibrate } from "@/lib/haptics";
import { COLORS, EASINGS, GLASS, GRADIENT_COLORS, MOTION, RADIUS, useStyles } from "@/lib/theme";
import { LinearGradient } from "expo-linear-gradient";

/**
 * One post on the feed.
 *
 * The web app's `FeedPostCard`, reduced to what a phone can hold and kept
 * structurally identical everywhere else: avatar, author, timestamp, topic, the
 * body, an optional photo or poll, and the action row. The reply branch of the
 * web card is the single-thread screen here (`SingleWhisperScreen`) — recursion
 * four levels deep inside a scroll view on a phone is how a feed becomes a
 * performance bug, so a thread opens as its own screen instead.
 *
 * THE ACTION ROW
 *
 * Four wired controls, the same four the web app decided on: reply, like, views,
 * share — plus the coin tip the brief asks for. Nothing here is a dead icon. A
 * button that looks tappable and does nothing costs more trust than a missing
 * one, which is why the web app's row has four controls where X has five.
 *
 * The like's heart scales and colours on tap before the request resolves; the
 * optimistic count is reconciled against the server's on refresh.
 */
export function FeedCard({
  post,
  myId,
  liked,
  likeCount,
  replyCount,
  imageState,
  openImageUri,
  onToggleLike,
  onOpenThread,
  onOpenThreadScreen,
  threadOpen = false,
  onOpenMenu,
  onTip,
  saved = null,
  onToggleSave,
  onVote,
  pollCounts,
  pollChoice,
  pollPending,
  enteringIndex,
  onOpenGallery,
  highlight = false,
}: {
  post: FeedPost;
  myId: string;
  liked: boolean;
  likeCount: number;
  replyCount: number;
  imageState: FeedImageState;
  openImageUri?: string | null;
  onToggleLike: () => void;
  /** The reply action: opens the thread under the card, with its composer. */
  onOpenThread: () => void;
  /** The card's own surface: opens the whisper's own screen. Falls back to the
   *  inline thread when the caller has no separate screen for it. */
  onOpenThreadScreen?: () => void;
  /** Whether the thread is open under this card — the reply icon reads active. */
  threadOpen?: boolean;
  onOpenMenu: () => void;
  onTip: () => void;
  /**
   * Whether this post is saved, or `null`/absent when the database has no
   * `public_feed_saves` table — in which case the bookmark is not drawn at all.
   * A control that looks tappable and does nothing costs more trust than a
   * missing one, which is the rule the web app's menu follows too.
   */
  saved?: boolean | null;
  onToggleSave?: () => void;
  onVote?: (index: number) => void;
  pollCounts?: number[];
  pollChoice?: number | null;
  pollPending?: boolean;
  /**
   * The card's position in the feed's FIRST page — the initial-load entrance
   * staggers in 55ms steps (the web's stagger default) up to a visible cap.
   * `undefined` (every page after the first) enters without delay.
   */
  enteringIndex?: number;
  onOpenGallery?: () => void;
  highlight?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const name = useAnonName(post.author_id);
  const official = isCreatorPost(post);
  const isMine = post.author_id === myId;
  const topic = topicMeta(post.topic);
  const isReply = Boolean(post.parent_post_id);

  const heart = useSharedValue(1);

  React.useEffect(() => {
    if (!liked) return;
    heart.value = withSequence(
      withTiming(1.32, { duration: 130, easing: Easing.out(Easing.quad) }),
      withSpring(1, { damping: 11, stiffness: 220 })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liked]);

  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heart.value }] }));

  const share = async () => {
    const url = `${process.env.EXPO_PUBLIC_SITE_URL || "https://whisper-anonymous.vercel.app"}/public-feed?post=${post.id}`;
    try {
      await Share.share({
        message: official
          ? `${post.body}\n\n${url}`
          : `${name} on Whisper: ${post.body}\n\n${url}`,
      });
    } catch {
      /* The user dismissed the sheet. */
    }
  };

  return (
    <Animated.View
      entering={
        enteringIndex === undefined
          ? undefined
          : FadeInDown.duration(MOTION.base)
              .delay(Math.min(enteringIndex, 8) * MOTION.stagger)
              .easing(Easing.bezier(0.22, 1, 0.36, 1))
      }
    >
    <GlassCard
      style={[styles.card, highlight && styles.highlighted]}
      radius={RADIUS.xl}
      strong={highlight}
    >
      <View style={styles.head}>
        <Pressable
          onPress={onOpenThreadScreen ?? onOpenThread}
          accessibilityLabel={`Open ${name}'s whisper`}
        >
          <Avatar authorId={post.author_id} size={42} official={official} />
        </Pressable>

        <View style={styles.headText}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {official ? "Whisper" : name}
            </Text>
            {official && (
              <View style={styles.official}>
                <Ionicons name="checkmark" size={10} color={COLORS.contrast} />
              </View>
            )}
            <Text style={styles.dot}>·</Text>
            <Text style={styles.time}>{timeAgo(post.created_at)}</Text>
          </View>

          <View style={styles.metaRow}>
            {topic && (
              <View style={styles.topicChip}>
                <Text style={styles.topicText}>
                  {topic.emoji} {topic.label}
                </Text>
              </View>
            )}
            {isReply && <Text style={styles.replyTag}>Reply</Text>}
          </View>
        </View>

        <Pressable
          onPress={onOpenMenu}
          hitSlop={12}
          style={styles.menu}
          accessibilityLabel="More options"
          accessibilityRole="button"
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={COLORS.subtle} />
        </Pressable>
      </View>

      <Text style={styles.body} numberOfLines={12}>
        {post.body}
      </Text>

      {post.has_image && (
        <PhotoWhisper
          preview={post.image_preview ?? null}
          state={isMine ? "spent" : imageState}
          isAuthor={isMine}
          openUri={openImageUri}
          onOpen={onOpenGallery ?? (() => {})}
        />
      )}

      {post.poll_options && post.poll_options.length >= 2 && onVote && (
        <Poll
          options={post.poll_options}
          counts={pollCounts ?? post.poll_counts ?? []}
          choice={pollChoice ?? post.viewer_vote ?? null}
          pending={Boolean(pollPending)}
          onVote={onVote}
        />
      )}

      {/* Only a root post carries the author's Whisper link. Repeating it on
          every reply would turn a thread into a wall of identical CTAs. */}
      {!isReply && !official && post.whisper_link && (
        <View style={styles.linkRow}>
          <Ionicons name="link-outline" size={13} color={COLORS.cyan} />
          <Text style={styles.linkText} numberOfLines={1}>
            Send me an anonymous Whisper
          </Text>
        </View>
      )}

      {post.send_state === "sending" && (
        <View style={styles.stateRow}>
          <View style={styles.pulse} />
          <Text style={styles.stateText}>Posting…</Text>
        </View>
      )}
      {post.send_state === "failed" && (
        <View style={styles.stateRow}>
          <Ionicons name="alert-circle-outline" size={13} color={COLORS.danger} />
          <Text style={[styles.stateText, { color: COLORS.danger }]}>Couldn&apos;t post</Text>
        </View>
      )}

      <View style={styles.actions}>
        <ActionButton
          icon="chatbubble-outline"
          label={replyCount > 0 ? formatCount(replyCount) : undefined}
          accessibilityLabel={replyCount > 0 ? `${replyCount} replies` : "Reply"}
          onPress={() => {
            vibrate("tap");
            onOpenThread();
          }}
        />

        <Pressable
          onPress={() => {
            vibrate("select");
            onToggleLike();
          }}
          style={styles.action}
          accessibilityRole="button"
          accessibilityState={{ selected: liked }}
          accessibilityLabel={liked ? "Remove like" : "Like"}
        >
          <Animated.View style={heartStyle}>
            <Ionicons
              name={liked ? "heart" : "heart-outline"}
              size={17}
              color={liked ? COLORS.rose : COLORS.subtle}
            />
          </Animated.View>
          {likeCount > 0 && (
            <Text style={[styles.actionLabel, liked && { color: COLORS.rose }]}>{formatCount(likeCount)}</Text>
          )}
        </Pressable>

        <ActionButton
          icon="bar-chart-outline"
          label={formatCount(post.view_count ?? 0)}
          accessibilityLabel={`${post.view_count ?? 0} views`}
          onPress={() => {}}
          readOnly
        />

        <ActionButton
          icon="share-social-outline"
          accessibilityLabel="Share this post"
          onPress={() => {
            vibrate("tap");
            void share();
          }}
        />

        {saved !== null && (
          <Pressable
            onPress={() => {
              vibrate("select");
              onToggleSave?.();
            }}
            style={styles.action}
            accessibilityRole="button"
            accessibilityState={{ selected: saved }}
            accessibilityLabel={saved ? "Remove from saved" : "Save this whisper"}
          >
            <Ionicons
              name={saved ? "bookmark" : "bookmark-outline"}
              size={16}
              color={saved ? COLORS.cyan : COLORS.subtle}
            />
          </Pressable>
        )}

        {/* The coin tip. It opens the transfer sheet rather than spending
            anything on its own — see CoinTipSheet for why a tip needs an
            address to go to. */}
        <Pressable
          onPress={() => {
            vibrate("tap");
            onTip();
          }}
          style={styles.tip}
          accessibilityRole="button"
          accessibilityLabel="Tip coins"
        >
          <LinearGradient
            colors={GRADIENT_COLORS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.tipGradient}
          >
            <Ionicons name="logo-bitcoin" size={13} color={COLORS.contrast} />
            <Text style={styles.tipText}>Tip</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </GlassCard>
    </Animated.View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  accessibilityLabel,
  readOnly = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  onPress: () => void;
  accessibilityLabel: string;
  readOnly?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const content = (
    <>
      <Ionicons name={icon} size={17} color={COLORS.subtle} />
      {label ? <Text style={styles.actionLabel}>{label}</Text> : null}
    </>
  );

  if (readOnly) {
    return (
      <View style={styles.action} accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }

  return (
    <Pressable onPress={onPress} style={styles.action} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      {content}
    </Pressable>
  );
}

/** The topic chips row shown above the feed — exported for the composer too. */
export function TopicChip({ emoji, label, active }: { emoji: string; label: string; active: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <LinearGradient
      colors={active ? GRADIENT_COLORS : ["rgba(255,255,255,0.06)", "rgba(255,255,255,0.06)"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.topicChipLarge}
    >
      <Text style={[styles.topicChipText, active && { color: COLORS.contrast }]}>
        {emoji} {label}
      </Text>
    </LinearGradient>
  );
}

const makeStyles = () => StyleSheet.create({
  card: { marginBottom: 12 },
  highlighted: { borderColor: COLORS.cyan },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  headText: { flex: 1, gap: 4 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  name: { color: COLORS.text, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  official: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: COLORS.cyan,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { color: COLORS.subtle, fontSize: 13 },
  time: { color: COLORS.subtle, fontSize: 12.5, fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  topicChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(34,211,238,0.12)",
  },
  topicText: { color: COLORS.cyan, fontSize: 11, fontWeight: "700" },
  replyTag: { color: COLORS.muted, fontSize: 11, fontWeight: "600" },
  menu: { padding: 4, marginTop: -2 },
  body: { color: COLORS.text, fontSize: 15, lineHeight: 21.5, marginTop: 10 },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: RADIUS.md,
    backgroundColor: "rgba(34,211,238,0.08)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.22)",
  },
  linkText: { color: COLORS.cyan, fontSize: 12.5, fontWeight: "700", flexShrink: 1 },
  stateRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  pulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.purple },
  stateText: { color: COLORS.muted, fontSize: 11.5, fontWeight: "600" },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GLASS.border,
  },
  action: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4, paddingHorizontal: 2 },
  actionLabel: { color: COLORS.subtle, fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
  tip: { borderRadius: RADIUS.pill, overflow: "hidden" },
  tipGradient: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
  },
  tipText: { color: COLORS.contrast, fontSize: 11.5, fontWeight: "900" },
  topicChipLarge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    overflow: "hidden",
  },
  topicChipText: { color: COLORS.muted, fontSize: 12, fontWeight: "700" },
});
