import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

import { Avatar } from "@/components/Avatar";
import { Background } from "@/components/Background";
import { GradientButton } from "@/components/GradientButton";
import { GradientText } from "@/components/GradientText";
import { FeedCard } from "@/components/feed/FeedCard";
import { GhostMark } from "@/components/Logo";
import {
  CLOUDINARY_FOLDERS,
  discardUpload,
  uploadImage,
  type LocalImage,
  type UploadedAsset,
} from "@/lib/uploads";
import { checkCreatorAccess, publishOfficialPost, CREATOR_ROLE, isCreatorPost } from "@/lib/creator";
import { apiBase } from "@/lib/feed";
import { vibrate } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { COLORS, RADIUS, useStyles } from "@/lib/theme";
import type { FeedPost } from "@/lib/types";

/**
 * The creator console — the native port of the web app's `/creator`
 * (`app/creator/page.tsx`): the one screen where an official Whisper post is
 * written, previewed as it will render in everyone's feed, and published.
 *
 * THE GATE
 *
 * Access is the `is_whisper_creator` RPC, resolved before the console renders
 * (the web's `useCreatorAccess`). Everyone else gets the access-denied state —
 * what a non-admin who typed the URL sees. The route is not linked from
 * anywhere a regular user walks; it is a known URL, exactly as on the web.
 *
 * THE RULES THE SERVER KEEPS
 *
 * Only `message`, `imagePath` and `imagePreview` go over the wire — the role,
 * the identity and the badge are derived server-side from the session. A
 * client that sends `author_role` anyway is ignored, which is why this screen
 * is convenience and the route is the boundary.
 */

const MAX_BODY = 500;

type Access = Awaited<ReturnType<typeof checkCreatorAccess>>;

export default function CreatorConsole() {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { session, userId } = useSession();

  const [access, setAccess] = useState<Access>({ state: "checking" });
  const [body, setBody] = useState("");
  const [image, setImage] = useState<LocalImage | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [recent, setRecent] = useState<FeedPost[]>([]);

  const trimmed = body.trim();
  const canPublish = trimmed.length > 0 && !publishing && !preparing;

  /* The gate, and (behind it) the creator's recent posts for context. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await checkCreatorAccess();
      if (!cancelled) setAccess(result);

      if (result.state !== "yes" || !userId) return;
      const { data } = await supabaseListRecent(result.userId);
      if (!cancelled && data) setRecent(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const clearImage = useCallback(() => {
    setImage(null);
    setImageUrl(null);
    setPreviewing(false);
  }, []);

  const pickImage = useCallback(async () => {
    if (preparing || publishing) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast("Photo permission is needed to attach a picture.", { variant: "subtle" });
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      exif: false,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    const asset = picked.assets[0];

    setPreparing(true);
    try {
      const local: LocalImage = {
        uri: asset.uri,
        mimeType: asset.mimeType ?? "image/jpeg",
        fileName: asset.fileName ?? `official-${Date.now()}.jpg`,
      };
      clearImage();
      setImage(local);
      setImageUrl(local.uri);
      vibrate("tap");
    } finally {
      setPreparing(false);
    }
  }, [clearImage, preparing, publishing, showToast]);

  const publish = useCallback(async () => {
    if (!canPublish || !session) return;
    setPublishing(true);
    let uploaded: UploadedAsset | null = null;

    try {
      if (image) {
        uploaded = await uploadImage(image, `${CLOUDINARY_FOLDERS.feedPhotos}/${session.user.id}`, session.access_token);
      }

      const post = await publishOfficialPost({
        message: trimmed.slice(0, MAX_BODY),
        imagePath: uploaded?.publicId ?? null,
        imagePreview: image ? uploaded?.url ?? null : null,
      });

      setRecent((current) => [post, ...current].slice(0, 5));
      vibrate("success");
      showToast("Post live", { variant: "subtle" });
      setBody("");
      clearImage();
    } catch (cause) {
      /* An uploaded photo whose post failed must not orphan an asset the
         route would never reference again. */
      if (uploaded) {
        await discardUpload(uploaded.url, session.access_token).catch(() => {});
      }
      showToast(cause instanceof Error ? cause.message : "Couldn't publish that.", { variant: "error" });
    } finally {
      setPublishing(false);
    }
  }, [canPublish, clearImage, image, session, showToast, trimmed]);

  const previewPost: FeedPost | null =
    trimmed.length > 0
      ? {
          id: "preview",
          author_id: userId ?? "preview",
          body: trimmed,
          whisper_link: "",
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          author_role: CREATOR_ROLE,
          like_count: 0,
          reply_count: 0,
        }
      : null;

  return (
    <View style={styles.root}>
      <Background />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 18, paddingBottom: Math.max(insets.bottom, 24) + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.head}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8}>
              <Ionicons name="chevron-back" size={22} color={COLORS.text} />
            </Pressable>
            <View style={styles.brandRow}>
              <View style={styles.mark}>
                <GhostMark size={20} />
              </View>
              <GradientText style={styles.title}>Creator console</GradientText>
            </View>
          </View>

          {access.state === "checking" ? (
            <View style={styles.state}>
              <ActivityIndicator color={COLORS.cyan} />
              <Text style={styles.stateText}>Checking access…</Text>
            </View>
          ) : access.state === "unavailable" ? (
            <View style={styles.state}>
              <Ionicons name="cloud-offline-outline" size={26} color={COLORS.warning} />
              <Text style={styles.stateText}>The creator check is unavailable right now. Try again later.</Text>
            </View>
          ) : access.state === "no" ? (
            <Animated.View entering={FadeInDown.duration(300)} style={styles.state}>
              <View style={styles.deniedMark}>
                <Ionicons name="shield-outline" size={28} color={COLORS.danger} />
              </View>
              <Text style={styles.deniedTitle}>Not authorized</Text>
              <Text style={styles.stateText}>
                This console publishes official Whisper posts. Your account isn't on the creator list.
              </Text>
            </Animated.View>
          ) : (
            <Animated.View entering={FadeInUp.duration(360)}>
              {/* The composer */}
              <View style={styles.card}>
                <View style={styles.identityRow}>
                  <Avatar authorId={userId ?? ""} size={40} official />
                  <View style={styles.identityText}>
                    <Text style={styles.identityName}>Whisper</Text>
                    <Text style={styles.identityRole}>Official · posts as Whisper</Text>
                  </View>
                </View>

                <Pressable onPress={() => void pickImage()} style={styles.imagePick} accessibilityRole="button" accessibilityLabel="Attach a photo">
                  {imageUrl ? (
                    <Image source={{ uri: imageUrl }} style={styles.picked} />
                  ) : (
                    <View style={styles.imagePickEmpty}>
                      <Ionicons name="image-outline" size={22} color={COLORS.subtle} />
                      <Text style={styles.imagePickText}>{preparing ? "Preparing…" : "Attach a photo"}</Text>
                    </View>
                  )}
                </Pressable>

                <TextInputStyled
                  value={body}
                  onChangeText={setBody}
                  placeholder="Speak as Whisper…"
                  maxLength={MAX_BODY}
                />
                <View style={styles.metaRow}>
                  <Text style={styles.counter}>
                    {trimmed.length}/{MAX_BODY}
                  </Text>
                  {image ? (
                    <Pressable onPress={clearImage} hitSlop={6} accessibilityRole="button" accessibilityLabel="Remove photo">
                      <Text style={styles.removePhoto}>Remove photo</Text>
                    </Pressable>
                  ) : null}
                </View>

                {previewing && previewPost ? (
                  <View style={styles.previewWrap}>
                    <Text style={styles.previewLabel}>Live preview</Text>
                    <FeedCard
                      post={previewPost}
                      myId={userId ?? ""}
                      liked={false}
                      likeCount={0}
                      replyCount={0}
                      imageState="locked"
                      onToggleLike={() => {}}
                      onOpenThread={() => {}}
                      onOpenMenu={() => {}}
                      onTip={() => {}}
                    />
                  </View>
                ) : null}

                <View style={styles.actions}>
                  {trimmed.length > 0 && !publishing ? (
                    <Pressable
                      onPress={() => {
                        vibrate("tap");
                        setPreviewing((value) => !value);
                      }}
                      style={styles.previewToggle}
                      accessibilityRole="button"
                      accessibilityLabel="Toggle live preview"
                    >
                      <Text style={styles.previewToggleText}>{previewing ? "Hide preview" : "Preview"}</Text>
                    </Pressable>
                  ) : null}
                  <GradientButton
                    label={publishing ? "Publishing…" : "Publish"}
                    icon="megaphone-outline"
                    fullWidth
                    loading={publishing}
                    disabled={!canPublish}
                    onPress={() => void publish()}
                    style={styles.publishBtn}
                  />
                </View>
              </View>

              {/* Recent official posts */}
              {recent.length > 0 ? (
                <View style={styles.recent}>
                  <Text style={styles.recentTitle}>Recent official posts</Text>
                  {recent.map((post) => (
                    <FeedCard
                      key={post.id}
                      post={post}
                      myId={userId ?? ""}
                      liked={post.viewer_liked === true}
                      likeCount={post.like_count ?? 0}
                      replyCount={post.reply_count ?? 0}
                      imageState={post.image_preview ? "locked" : "unavailable"}
                      onToggleLike={() => {}}
                      onOpenThread={() => {}}
                      onOpenMenu={() => {}}
                      onTip={() => {}}
                    />
                  ))}
                </View>
              ) : null}
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* The creator's five most recent official posts — read straight from the table
   under RLS (select is open on live posts), the web page's exact query. */
async function supabaseListRecent(userId: string): Promise<{ data: FeedPost[] | null }> {
  const { supabase } = await import("@/lib/supabase");
  const { data, error } = await supabase
    .from("public_feed_posts")
    .select("id,author_id,body,whisper_link,created_at,expires_at,parent_post_id,view_count,image_preview,author_role")
    .eq("author_id", userId)
    .eq("author_role", CREATOR_ROLE)
    .is("parent_post_id", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) {
    console.warn("[creator] recent posts read failed:", error.message);
    return { data: null };
  }
  return { data: (data ?? []) as unknown as FeedPost[] };
}

import { TextInput } from "react-native";

function TextInputStyled(props: React.ComponentProps<typeof TextInput>) {
  const styles = useStyles(makeStyles);
  return <TextInput {...props} style={[styles.input, props.style]} placeholderTextColor={COLORS.subtle} multiline />;
}

const makeStyles = () =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: COLORS.background },
    flex: { flex: 1 },
    scroll: { paddingHorizontal: 18 },

    head: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
    brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    mark: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: COLORS.card,
    },
    title: { fontSize: 18, fontWeight: "900", letterSpacing: -0.3 },

    state: { alignItems: "center", gap: 10, paddingVertical: 64, paddingHorizontal: 30 },
    stateText: { color: COLORS.muted, fontSize: 13.5, textAlign: "center", lineHeight: 20 },
    deniedMark: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: COLORS.danger,
      opacity: 0.14,
    },
    deniedTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },

    card: {
      borderRadius: RADIUS.xl,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.card,
      padding: 14,
      gap: 12,
    },
    identityRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    identityText: { flex: 1 },
    identityName: { color: COLORS.text, fontSize: 15, fontWeight: "900" },
    identityRole: { color: COLORS.subtle, fontSize: 12, fontWeight: "600", marginTop: 1 },

    imagePick: { borderRadius: RADIUS.md, overflow: "hidden", backgroundColor: COLORS.surface },
    imagePickEmpty: { alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 26 },
    imagePickText: { color: COLORS.subtle, fontSize: 13, fontWeight: "700" },
    picked: { width: "100%", aspectRatio: 16 / 9 },

    input: {
      color: COLORS.text,
      fontSize: 15.5,
      lineHeight: 22,
      minHeight: 96,
      textAlignVertical: "top",
      padding: 12,
      borderRadius: RADIUS.md,
      backgroundColor: COLORS.surface,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    counter: { color: COLORS.subtle, fontSize: 11.5, fontWeight: "700" },
    removePhoto: { color: COLORS.danger, fontSize: 12.5, fontWeight: "800" },

    previewWrap: { gap: 6 },
    previewLabel: { color: COLORS.subtle, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },

    actions: { flexDirection: "row", alignItems: "center", gap: 12 },
    previewToggle: { paddingVertical: 8, paddingHorizontal: 4 },
    previewToggleText: { color: COLORS.cyan, fontSize: 13.5, fontWeight: "800" },
    publishBtn: { flex: 1 },

    recent: { gap: 12, marginTop: 22 },
    recentTitle: {
      color: COLORS.subtle,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 1,
      textTransform: "uppercase",
    },
  });
