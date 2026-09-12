import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, router } from "expo-router";
import { useEffect, useState } from "react";
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

import { FeedCard } from "@/components/feed/FeedCard";
import { Avatar } from "@/components/Avatar";
import { GlassCard } from "@/components/GlassCard";
import { useSession } from "@/lib/session";
import { COLORS, GLASS, GRADIENT_COLORS, RADIUS } from "@/lib/theme";
import { useToast } from "@/lib/toast";
import { fetchPost, fetchThread, toggleLike, createFeedPost } from "@/lib/feed";
import type { FeedPost } from "@/lib/types";
import { formatCount, timeAgo } from "@/lib/format";
import { useAnonName } from "@/lib/identity";
import { vibrate } from "@/lib/haptics";

/**
 * Whisper Detail.
 *
 * Full whisper at top (glass card), comments list below, add comment input
 * pinned at the bottom, like button with count.
 */
export default function WhisperDetailScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { session, userId } = useSession();
  const { showToast } = useToast();

  const [post, setPost] = useState<FeedPost | null>(null);
  const [replies, setReplies] = useState<FeedPost[]>([]);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!postId) return;
    (async () => {
      setLoading(true);
      const p = await fetchPost(postId);
      if (p) {
        setPost(p);
        setLiked(Boolean(p.viewer_liked));
        setLikeCount(p.like_count ?? 0);
      }
      const thread = await fetchThread(postId);
      setReplies(thread || []);
      setLoading(false);
    })();
  }, [postId]);

  const handleLike = async () => {
    if (!userId || !post) return;
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikeCount((c) => Math.max(0, c + (wasLiked ? -1 : 1)));
    vibrate("select");
    try {
      await toggleLike(post.id, userId, wasLiked);
    } catch (err: any) {
      showToast(err?.message || "Couldn't toggle like.", { variant: "error" });
      setLiked(wasLiked);
      setLikeCount((c) => c + (wasLiked ? 1 : -1));
    }
  };

  const handleSendComment = async () => {
    const text = comment.trim();
    if (!text || !session || !post || !userId) return;
    setSending(true);
    try {
      const result = await createFeedPost(
        { body: text, parentPostId: post.id },
        session.access_token
      );
      if ("error" in result) {
        showToast(result.error, { variant: "error" });
      } else {
        setReplies((prev) => [...prev, result.post]);
        setComment("");
        vibrate("success");
        showToast("Reply posted", { variant: "subtle" });
      }
    } catch (err: any) {
      showToast(err?.message || "Couldn't send reply.", { variant: "error" });
    } finally {
      setSending(false);
    }
  };

  if (loading || !post) {
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Whisper</Text>
          <View style={{ width: 40 }} />
        </View>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Whisper</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={88}
      >
        <FlatList
          data={replies}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={
            <View style={{ padding: 16, gap: 12 }}>
              <FeedCard
                post={post}
                myId={userId ?? ""}
                liked={liked}
                likeCount={likeCount}
                replyCount={replies.length}
                imageState="locked"
                onToggleLike={handleLike}
                onOpenThread={() => {}}
                onOpenMenu={() => {}}
                onTip={() => router.push("/coins")}
                saved={false}
              />

              <Pressable onPress={handleLike} style={styles.likeRow}>
                <Ionicons
                  name={liked ? "heart" : "heart-outline"}
                  size={22}
                  color={liked ? COLORS.rose : COLORS.text}
                />
                <Text style={[styles.likeCount, liked && { color: COLORS.rose }]}>
                  {formatCount(likeCount)} {likeCount === 1 ? "like" : "likes"}
                </Text>
              </Pressable>

              <Text style={styles.sectionTitle}>
                {replies.length === 0 ? "No replies yet" : `Replies (${replies.length})`}
              </Text>
            </View>
          }
          renderItem={({ item }) => <ReplyItem reply={item} myId={userId ?? ""} />}
          contentContainerStyle={{ paddingBottom: 100 }}
        />

        <View style={styles.inputBar}>
          <GlassCard radius={RADIUS.pill} padded={false} style={styles.inputWrap}>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Add a reply..."
              placeholderTextColor={COLORS.subtle}
              multiline
              style={styles.input}
            />
          </GlassCard>
          <Pressable onPress={handleSendComment} disabled={sending || !comment.trim()}>
            <LinearGradient
              colors={comment.trim() && !sending ? GRADIENT_COLORS : ["rgba(255,255,255,0.1)", "rgba(255,255,255,0.1)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sendBtn}
            >
              <Ionicons name="send" size={18} color={comment.trim() ? "#0a0814" : COLORS.subtle} />
            </LinearGradient>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function ReplyItem({ reply, myId }: { reply: FeedPost; myId: string }) {
  const name = useAnonName(reply.author_id);
  return (
    <View style={styles.replyItem}>
      <Avatar authorId={reply.author_id} size={32} />
      <View style={styles.replyBody}>
        <View style={styles.replyBubble}>
          <Text style={styles.replyName}>{name}</Text>
          <Text style={styles.replyText}>{reply.body}</Text>
        </View>
        <Text style={styles.replyTime}>{timeAgo(reply.created_at)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingTop: 50,
    paddingBottom: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: COLORS.text, fontSize: 17, fontWeight: "900" },
  loadingText: { color: COLORS.muted, textAlign: "center", marginTop: 40 },
  likeRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  likeCount: { color: COLORS.text, fontSize: 14, fontWeight: "700" },
  sectionTitle: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 8,
    marginLeft: 4,
  },
  replyItem: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  replyBody: { flex: 1 },
  replyBubble: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: GLASS.border,
    padding: 10,
  },
  replyName: { color: COLORS.cyan, fontSize: 13, fontWeight: "800", marginBottom: 3 },
  replyText: { color: COLORS.text, fontSize: 14 },
  replyTime: { color: COLORS.subtle, fontSize: 11, marginTop: 4, marginLeft: 4 },
  inputBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(10,8,20,0.9)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GLASS.border,
  },
  inputWrap: { flex: 1 },
  input: {
    color: COLORS.text,
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 120,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
});
