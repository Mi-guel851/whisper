import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { Avatar } from "@/components/Avatar";
import { CoinBadge } from "@/components/CoinBadge";
import { GlassCard } from "@/components/GlassCard";
import { GradientText } from "@/components/GradientText";
import { fetchMyPosts } from "@/lib/feed";
import { fetchWallet } from "@/lib/coins";
import { fetchProfile } from "@/lib/profile";
import { useSession } from "@/lib/session";
import { COLORS, GLASS, RADIUS } from "@/lib/theme";
import type { FeedPost, Profile, Wallet } from "@/lib/types";
import { timeAgo } from "@/lib/format";

/**
 * Profile screen.
 *
 * Avatar, username, bio, coin balance as gradient badge, user's whispers list,
 * edit profile / settings navigation.
 */
export default function ProfileScreen() {
  const { userId } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [p, w, myPosts] = await Promise.all([
        fetchProfile(userId),
        fetchWallet(userId),
        fetchMyPosts(userId),
      ]);
      setProfile(p);
      setWallet(w);
      setPosts(myPosts);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.header}>
          <GradientText style={styles.title}>Profile</GradientText>
          <Pressable onPress={() => router.push("/settings")} hitSlop={12}>
            <Ionicons name="settings-outline" size={24} color={COLORS.text} />
          </Pressable>
        </View>

        <Animated.View entering={FadeIn.duration(300)}>
          <GlassCard radius={RADIUS.xxl} strong style={styles.heroCard}>
            <View style={styles.heroTop}>
              <Avatar
                authorId={userId}
                imageUrl={profile?.avatar_url ?? null}
                size={80}
              />
              <CoinBadge balance={wallet?.balance ?? 0} onPress={() => router.push("/coins")} variant="prominent" />
            </View>
            <Text style={styles.displayName}>
              {profile?.display_name || "New User"}
            </Text>
            <Text style={styles.handle}>@{profile?.username || "username"}</Text>
            <Text style={styles.bio}>
              {profile?.bio || "Just here for the honest whispers ✨"}
            </Text>

            <View style={styles.actionRow}>
              <Pressable
                style={styles.actionBtn}
                onPress={() => router.push("/settings")}
              >
                <Ionicons name="create-outline" size={16} color={COLORS.text} />
                <Text style={styles.actionBtnText}>Edit Profile</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, styles.actionBtnAccent]}
                onPress={() => router.push("/coins")}
              >
                <LinearGradient
                  colors={["rgba(34,211,238,0.14)", "rgba(168,85,247,0.14)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <Ionicons name="wallet-outline" size={16} color={COLORS.cyan} />
                <Text style={[styles.actionBtnText, { color: COLORS.cyan }]}>Coin Store</Text>
              </Pressable>
            </View>
          </GlassCard>
        </Animated.View>

        <Text style={styles.section}>Your Whispers</Text>

        {posts.length === 0 && !loading ? (
          <GlassCard radius={RADIUS.xl} style={styles.emptyPosts}>
            <Ionicons name="chatbubble-outline" size={36} color={COLORS.subtle} />
            <Text style={styles.emptyPostsText}>You haven't posted yet.</Text>
          </GlassCard>
        ) : (
          <View style={{ gap: 10, paddingHorizontal: 16 }}>
            {posts.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => router.push({ pathname: "/whisper-detail", params: { postId: p.id } })}
              >
                <GlassCard radius={RADIUS.xl} style={{ padding: 14 }}>
                  <Text style={styles.postBody} numberOfLines={3}>{p.body}</Text>
                  <View style={styles.postMeta}>
                    <Text style={styles.postTime}>{timeAgo(p.created_at)}</Text>
                    <View style={styles.postStats}>
                      <Ionicons name="heart-outline" size={13} color={COLORS.subtle} />
                      <Text style={styles.statNum}>{p.like_count ?? 0}</Text>
                      <Ionicons name="chatbubble-outline" size={13} color={COLORS.subtle} style={{ marginLeft: 8 }} />
                      <Text style={styles.statNum}>{p.reply_count ?? 0}</Text>
                    </View>
                  </View>
                </GlassCard>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 8,
  },
  title: { fontSize: 28, letterSpacing: 1 },
  heroCard: { margin: 16, padding: 20 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  displayName: { color: COLORS.text, fontSize: 22, fontWeight: "900", marginTop: 14 },
  handle: { color: COLORS.cyan, fontSize: 14, fontWeight: "700", marginTop: 2 },
  bio: { color: COLORS.muted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(255,255,255,0.04)",
    overflow: "hidden",
  },
  actionBtnAccent: { borderColor: "rgba(34,211,238,0.3)" },
  actionBtnText: { color: COLORS.text, fontSize: 13, fontWeight: "800" },
  section: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  emptyPosts: {
    marginHorizontal: 16,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  emptyPostsText: { color: COLORS.muted, fontSize: 14 },
  postBody: { color: COLORS.text, fontSize: 14, lineHeight: 20 },
  postMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  postTime: { color: COLORS.subtle, fontSize: 11, fontWeight: "600" },
  postStats: { flexDirection: "row", alignItems: "center", gap: 4 },
  statNum: { color: COLORS.subtle, fontSize: 11, fontWeight: "700" },
});
