import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BlurView } from "expo-blur";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { GradientButton, IconButton } from "@/components/GradientButton";
import { FeedCard } from "@/components/feed/FeedCard";
import { EmptyState, LoadingScreen, Screen } from "@/components/Screen";
import { Sheet, SheetRow } from "@/components/Sheet";
import type { MainStackParamList } from "@/navigation/types";
import { blockAuthor, fetchMyPosts, reportPost } from "@/lib/feed";
import { timeAgo } from "@/lib/format";
import { useAnonName } from "@/lib/identity";
import { fetchProfile, whisperLink } from "@/lib/profile";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { COLORS, GLASS, RADIUS } from "@/lib/theme";
import type { FeedPost, Profile } from "@/lib/types";

type Props = NativeStackScreenProps<MainStackParamList, "UserProfile">;

/**
 * Somebody else's profile.
 *
 * Reachable from a post, a thread, a chat header or a notification — the same
 * places the web app links to `/u/[username]`. It is read-only on purpose: there
 * is nothing here you can change, because the only editable profile is your own
 * and that lives on the Profile tab.
 *
 * What it *is* for: the whisper link. A profile is where you decide whether to
 * send somebody something anonymously, so the link is the primary action and it
 * is on the gradient. Everything else — their posts, and the two escape hatches
 * (report, block) — is below it.
 */
export function UserProfileScreen({ navigation, route }: Props) {
  const { userId: viewerId } = useSession();
  const { showToast } = useToast();
  const { userId: subjectId } = route.params;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  const fallbackName = useAnonName(subjectId);
  const name = profile?.display_name || profile?.username || fallbackName;
  const isSelf = viewerId === subjectId;

  const load = useCallback(async () => {
    const [row, mine] = await Promise.all([fetchProfile(subjectId), fetchMyPosts(subjectId, 40)]);
    setProfile(row);
    setPosts(mine);
    setLoading(false);
  }, [subjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingScreen label="Opening profile" />;

  const link = whisperLink(profile?.username);

  const header = (
    <View style={styles.header}>
      <BlurView intensity={GLASS.blurIntensity} tint="dark" style={styles.identityCard}>
        <View style={styles.identityInner}>
          <Avatar authorId={subjectId} size={78} imageUrl={profile?.avatar_url} />

          {/* No creator tick here on purpose: `author_role` lives on the feed
              rows, not on `profiles`, and a badge drawn from a guess would be
              the one thing on this screen that could be wrong. */}
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>

          <Text style={styles.handle}>
            {profile?.username ? `@${profile.username}` : "Anonymous user"}
            {profile?.created_at ? ` · joined ${timeAgo(profile.created_at)}` : ""}
          </Text>

          {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

          {!isSelf && profile?.username ? (
            <>
              <GradientButton
                label="Send an anonymous Whisper"
                icon="mail-outline"
                fullWidth
                onPress={() => {
                  void Clipboard.setStringAsync(link);
                  showToast("Link copied — open it to send anonymously", { variant: "success" });
                }}
                style={styles.cta}
              />

              <Pressable
                onPress={() => {
                  void Clipboard.setStringAsync(link);
                  showToast("Link copied", { variant: "subtle" });
                }}
                style={styles.linkRow}
              >
                <Ionicons name="link-outline" size={14} color={COLORS.cyan} />
                <Text style={styles.linkText} numberOfLines={1}>
                  whisper.app/u/{profile.username}
                </Text>
              </Pressable>
            </>
          ) : null}

          {isSelf ? (
            <GradientButton
              label="This is you"
              icon="person-circle-outline"
              variant="glass"
              fullWidth
              onPress={() => navigation.navigate("Tabs", { screen: "Profile" })}
              style={styles.cta}
            />
          ) : null}
        </View>
      </BlurView>

      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Whispers</Text>
        <Text style={styles.sectionCount}>
          {posts.length} {posts.length === 1 ? "post" : "posts"}
        </Text>
      </View>
    </View>
  );

  return (
    <Screen padded={false}>
      <View style={styles.topBar}>
        <IconButton icon="chevron-back" size={40} onPress={() => navigation.goBack()} accessibilityLabel="Go back" />
        <Text style={styles.topTitle}>Profile</Text>
        <IconButton icon="ellipsis-horizontal" size={40} onPress={() => setMenuOpen(true)} accessibilityLabel="Options" />
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <FeedCard
            post={item}
            myId={viewerId ?? ""}
            liked={Boolean(item.viewer_liked)}
            likeCount={Number(item.like_count ?? 0)}
            replyCount={Number(item.reply_count ?? 0)}
            imageState="spent"
            onToggleLike={() => {}}
            onOpenThread={() => navigation.push("SingleWhisper", { postId: item.id })}
            onOpenMenu={() => setMenuOpen(true)}
            onTip={() => navigation.navigate("CoinStore")}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="sparkles-outline"
            title="No whispers yet"
            body={`${name} hasn't posted to the feed.`}
            actionLabel={isSelf ? "Write one" : undefined}
            onAction={isSelf ? () => navigation.navigate("CreateWhisper") : undefined}
          />
        }
      />

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Profile options">
        <View style={{ paddingBottom: 10 }}>
          <SheetRow
            icon="link-outline"
            label="Copy whisper link"
            detail={link}
            onPress={() => {
              setMenuOpen(false);
              void Clipboard.setStringAsync(link);
              showToast("Link copied", { variant: "subtle" });
            }}
          />

          {!isSelf && (
            <>
              <SheetRow
                icon="flag-outline"
                label="Report this account"
                onPress={() => {
                  setMenuOpen(false);
                  const target = posts[0]?.id;
                  if (!target || !viewerId) {
                    showToast("Nothing to report from here.", { variant: "subtle" });
                    return;
                  }
                  void reportPost(target, viewerId, `Reported @${profile?.username ?? subjectId}`)
                    .then(() => showToast("Thanks — we'll take a look.", { variant: "success" }))
                    .catch(() => showToast("Couldn't send that report.", { variant: "error" }));
                }}
              />

              <SheetRow
                icon="ban-outline"
                label="Block this account"
                danger
                detail="You won't see their posts or messages again"
                onPress={() => {
                  setMenuOpen(false);
                  if (!viewerId) return;
                  void blockAuthor(viewerId, subjectId)
                    .then(() => {
                      showToast("Blocked", { variant: "subtle" });
                      navigation.goBack();
                    })
                    .catch(() => showToast("Couldn't block that account.", { variant: "error" }));
                }}
              />
            </>
          )}
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 4,
  },
  topTitle: { color: COLORS.text, fontSize: 16, fontWeight: "800" },

  list: { paddingHorizontal: 16, paddingBottom: 40 },
  header: { paddingTop: 8 },

  identityCard: {
    borderRadius: RADIUS.xxl,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.55)",
    overflow: "hidden",
  },
  identityInner: { alignItems: "center", padding: 18, gap: 6 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 10 },
  name: { color: COLORS.text, fontSize: 20, fontWeight: "900", marginTop: 10, flexShrink: 1 },
  handle: { color: COLORS.muted, fontSize: 12.5, fontWeight: "600" },
  bio: { color: COLORS.muted, fontSize: 13.5, textAlign: "center", lineHeight: 19, marginTop: 6 },
  cta: { marginTop: 14 },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: RADIUS.md,
    backgroundColor: "rgba(34,211,238,0.08)",
    marginTop: 10,
  },
  linkText: { color: COLORS.cyan, fontSize: 12.5, fontWeight: "700", flexShrink: 1 },

  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    marginBottom: 10,
  },
  sectionTitle: { color: COLORS.text, fontSize: 16.5, fontWeight: "900" },
  sectionCount: { color: COLORS.subtle, fontSize: 12.5, fontWeight: "700" },
});
