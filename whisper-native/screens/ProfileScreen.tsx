import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { BlurView } from "expo-blur";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { CoinBadge } from "@/components/CoinBadge";
import { GradientButton, IconButton } from "@/components/GradientButton";
import { FeedCard } from "@/components/feed/FeedCard";
import { Field } from "@/components/Input";
import { EmptyState, Screen, SkeletonRow } from "@/components/Screen";
import { Sheet, SheetRow } from "@/components/Sheet";
import { TAB_BAR_SPACE } from "@/navigation/MainTabs";
import type { MainStackParamList } from "@/navigation/types";
import { fetchWallet } from "@/lib/coins";

import { fetchMyPosts } from "@/lib/feed";
import { timeAgo } from "@/lib/format";
import { BIO_LIMIT, fetchProfile, invalidateIdentity, saveProfile, whisperLink, whisperLinkLabel } from "@/lib/profile";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { COLORS, GLASS, RADIUS } from "@/lib/theme";
import { saveAvatarUrl, uploadAvatar } from "@/lib/uploads";
import type { FeedPost, Profile } from "@/lib/types";

/**
 * Your profile.
 *
 * The web app's `/profile`, plus the one thing it puts on `/dashboard` that
 * belongs here on a phone: the shareable link, with a copy button. On the web
 * the link lives in a sidebar card; on a phone the profile screen *is* the
 * place you show somebody, so the thing you show them is on it.
 *
 * Four sections, in the order they matter:
 *
 *   identity   avatar, name, anonymous handle, the link
 *   wallet     the gradient coin badge, which opens the store
 *   whispers   your own posts, with the counts that belong to you
 *   settings   the way in to the settings screen
 *
 * The avatar is the only uploaded image in the product (everything else is
 * generated from an id), so this is the only screen with an image picker.
 */
export function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { userId, session } = useSession();
  const { showToast } = useToast();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;

    const [row, mine, wallet] = await Promise.all([
      fetchProfile(userId),
      fetchMyPosts(userId, 40),
      fetchWallet(userId),
    ]);

    setProfile(row);
    setDisplayName(row?.display_name ?? row?.username ?? "");
    setBio(row?.bio ?? "");
    setPosts(mine);
    setBalance(wallet?.balance ?? 0);
    setLoading(false);
    setRefreshing(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const copyLink = async () => {
    await Clipboard.setStringAsync(whisperLink(profile?.username));
    showToast("Link copied — send it to anyone", { variant: "success" });
  };

  const shareLink = async () => {
    await Share.share({
      message: `Send me an anonymous Whisper 👻\n${whisperLink(profile?.username)}`,
    }).catch(() => {});
  };

  const pickAvatar = async () => {
    if (!userId || !session?.access_token) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast("Photo access is off. Turn it on in your settings.", { variant: "warning" });
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      aspect: [1, 1],
      allowsEditing: true,
    });

    if (picked.canceled || !picked.assets[0]) return;

    const asset = picked.assets[0];
    setUploadingAvatar(true);

    try {
      const uploaded = await uploadAvatar(
        {
          uri: asset.uri,
          mimeType: asset.mimeType ?? "image/jpeg",
          fileName: asset.fileName ?? `avatar-${userId}.jpg`,
        },
        userId,
        session.access_token
      );

      /* The URL is written to `profiles.avatar_url` before it is trusted in the
         UI: a picture that is on screen but not on the row is a picture that
         disappears on the next launch. */
      await saveAvatarUrl(userId, uploaded.url);
      setProfile((current) => (current ? { ...current, avatar_url: uploaded.url } : current));
      showToast("Avatar updated", { variant: "success" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn't upload that picture.", {
        variant: "error",
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const save = async () => {
    if (!userId) return;
    setSaving(true);

    try {
      await saveProfile(userId, {
        displayName,
        bio: bio.slice(0, BIO_LIMIT),
      });
      invalidateIdentity(userId);
      setProfile((current) => (current ? { ...current, display_name: displayName, bio } : current));
      setEditing(false);
      showToast("Profile saved", { variant: "success" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn't save your profile.", {
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };


  const header = (
    <View style={styles.headerWrap}>
      <BlurView intensity={GLASS.blurIntensity} tint="dark" style={styles.identityCard}>
        <View style={styles.identityInner}>
          <Pressable onPress={() => void pickAvatar()} accessibilityLabel="Change your avatar">
            <View style={styles.avatarWrap}>
              <Avatar authorId={userId} size={86} imageUrl={profile?.avatar_url} />
              <View style={styles.avatarEdit}>
                <Ionicons name={uploadingAvatar ? "hourglass-outline" : "camera"} size={13} color="#0a0814" />
              </View>
            </View>
          </Pressable>

          <Text style={styles.name} numberOfLines={1}>
            {profile?.display_name || profile?.username || "You"}
          </Text>
          <Text style={styles.handle}>@{profile?.username ?? "set-a-username"}</Text>
          {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

          <View style={styles.badgeRow}>
            <CoinBadge balance={balance} variant="prominent" onPress={() => navigation.navigate("CoinStore")} />
          </View>

          <View style={styles.linkCard}>
            <View style={styles.linkText}>
              <Text style={styles.linkLabel}>Your whisper link</Text>
              <Text style={styles.linkValue} numberOfLines={1}>
                {whisperLinkLabel(profile?.username)}
              </Text>
            </View>

            <View style={styles.linkActions}>
              <Pressable onPress={() => void copyLink()} style={styles.linkButton} accessibilityLabel="Copy link">
                <Ionicons name="copy-outline" size={15} color={COLORS.cyan} />
              </Pressable>
              <Pressable
                onPress={() => void shareLink()}
                style={styles.linkButton}
                accessibilityLabel="Share link"
              >
                <Ionicons name="share-social-outline" size={15} color={COLORS.cyan} />
              </Pressable>
            </View>
          </View>

          <View style={styles.actions}>
            <GradientButton
              label="Edit profile"
              icon="create-outline"
              variant="glass"
              onPress={() => setEditing(true)}
              style={styles.actionButton}
            />
            <GradientButton
              label="Settings"
              icon="settings-outline"
              variant="glass"
              onPress={() => navigation.navigate("Settings")}
              style={styles.actionButton}
            />
          </View>
        </View>
      </BlurView>

      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Your whispers</Text>
        <Text style={styles.sectionCount}>
          {posts.length} {posts.length === 1 ? "post" : "posts"}
        </Text>
      </View>
    </View>
  );

  return (
    <Screen padded={false} edges={["left", "right"]}>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
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
          <FeedCard
            post={item}
            myId={userId ?? ""}
            liked={Boolean(item.viewer_liked)}
            likeCount={Number(item.like_count ?? 0)}
            replyCount={Number(item.reply_count ?? 0)}
            imageState="spent"
            onToggleLike={() => {}}
            onOpenThread={() => navigation.navigate("SingleWhisper", { postId: item.id })}
            onOpenMenu={() => navigation.navigate("SingleWhisper", { postId: item.id })}
            onTip={() => navigation.navigate("CoinStore")}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <View>
              <SkeletonRow height={140} />
              <SkeletonRow height={140} />
            </View>
          ) : (
            <EmptyState
              icon="sparkles-outline"
              title="You haven't posted yet"
              body="Say something to the feed, or answer what somebody else said."
              actionLabel="Write a whisper"
              onAction={() => navigation.navigate("CreateWhisper")}
            />
          )
        }
      />

      {/* The profile menu, reached from the tab bar's own header on the feed.
          Kept here so the tab is self-sufficient. */}
      <View style={[styles.fab, { bottom: TAB_BAR_SPACE + 4 }]}>
        <IconButton
          icon="add"
          gradient
          size={54}
          onPress={() => navigation.navigate("CreateWhisper")}
          accessibilityLabel="Create a whisper"
        />
      </View>

      <Sheet visible={editing} onClose={() => setEditing(false)} title="Edit profile">
        <View style={{ gap: 10, paddingBottom: 10 }}>
          <Field
            label="Display name"
            icon="person-outline"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="What people call you"
            autoCapitalize="words"
            maxLength={40}
          />

          <Field
            label="Bio"
            icon="document-text-outline"
            value={bio}
            onChangeText={(value) => setBio(value.slice(0, BIO_LIMIT))}
            placeholder="A line about you"
            multiline
            maxLength={BIO_LIMIT}
          />

          <Text style={styles.counter}>
            {bio.length}/{BIO_LIMIT} characters
          </Text>

          <GradientButton
            label="Save"
            icon="checkmark"
            size="lg"
            fullWidth
            loading={saving}
            disabled={saving}
            onPress={() => void save()}
          />

          <SheetRow
            icon="at-outline"
            label="Change username"
            detail={profile?.username ? `Currently @${profile.username}` : "Not set yet"}
            onPress={() => {
              setEditing(false);
              showToast("Usernames are set at signup and changed on the website.", { variant: "subtle" });
            }}
          />

          <SheetRow
            icon="time-outline"
            label="Account created"
            detail={profile?.created_at ? timeAgo(profile.created_at) : "—"}
            onPress={() => {}}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerWrap: { paddingHorizontal: 16, paddingTop: 12 },
  identityCard: {
    borderRadius: RADIUS.xxl,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.55)",
    overflow: "hidden",
  },
  identityInner: { alignItems: "center", padding: 18, gap: 6 },
  avatarWrap: { position: "relative" },
  avatarEdit: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.cyan,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: COLORS.background,
  },
  name: { color: COLORS.text, fontSize: 21, fontWeight: "900", marginTop: 10 },
  handle: { color: COLORS.cyan, fontSize: 13, fontWeight: "700" },
  bio: { color: COLORS.muted, fontSize: 13.5, textAlign: "center", lineHeight: 19, marginTop: 6, paddingHorizontal: 8 },
  badgeRow: { marginTop: 12 },

  linkCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    width: "100%",
    marginTop: 14,
    padding: 12,
    borderRadius: RADIUS.lg,
    backgroundColor: "rgba(34,211,238,0.07)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.22)",
  },
  linkText: { flex: 1 },
  linkLabel: { color: COLORS.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  linkValue: { color: COLORS.cyan, fontSize: 13.5, fontWeight: "700", marginTop: 3 },
  linkActions: { flexDirection: "row", gap: 8 },
  linkButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(34,211,238,0.12)",
  },

  actions: { flexDirection: "row", gap: 10, marginTop: 16, width: "100%" },
  actionButton: { flex: 1 },

  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 22,
    marginBottom: 10,
  },
  sectionTitle: { color: COLORS.text, fontSize: 16.5, fontWeight: "900" },
  sectionCount: { color: COLORS.subtle, fontSize: 12.5, fontWeight: "700" },

  list: { paddingBottom: TAB_BAR_SPACE + 40 },
  counter: { color: COLORS.subtle, fontSize: 11.5, textAlign: "right" },
  fab: { position: "absolute", right: 18 },
});

