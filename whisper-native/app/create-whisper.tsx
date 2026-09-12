import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassCard } from "@/components/GlassCard";
import { GradientButton, IconButton } from "@/components/GradientButton";
import { TopicChip } from "@/components/feed/FeedCard";
import { Screen } from "@/components/Screen";
import { Sheet, SheetRow } from "@/components/Sheet";
import { FEED_POST_COST, FEED_REPLY_COST, fetchWallet } from "@/lib/coins";
import { FEED_TOPICS, createFeedPost } from "@/lib/feed";
import { formatCoins } from "@/lib/format";
import { vibrate } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { COLORS, GLASS, RADIUS, useStyles } from "@/lib/theme";
import { discardUpload, uploadImage } from "@/lib/uploads";

/* Mirrors FeedComposer.tsx on the web, which mirrors the route's own check. */
const MAX_POLL_OPTIONS = 4;
const MAX_POLL_OPTION_CHARS = 60;

const BODY_LIMIT = 500;

/**
 * Compose.
 *
 * One screen for both a new post and a reply, because they are the same
 * composer with a different heading — the web app's `FeedComposer` is likewise
 * one component. The differences are real and small: a reply costs nothing, and
 * a reply's topic is its parent's.
 *
 * THE ANONYMITY SWITCH
 *
 * On, and locked on. Every identity in this product is generated from the
 * author's id — there is no name to attach and no display name to hide — so a
 * switch that could be turned off would be a lie with a gradient on it. It is
 * rendered as a switch anyway, because "you are anonymous here" is worth saying
 * out loud once, in the place where somebody might worry about it.
 *
 * WHAT ACTUALLY GETS SENT
 *
 * `POST /api/coins/feed-post`, never a direct insert. The route is where the
 * ban gate, the 6-per-minute rate limit, the attachment validation and the
 * debit/refund live; a client that inserted into `public_feed_posts` directly
 * would bypass every one of them. A root post costs 2 coins, a reply is free,
 * and the response carries the row the feed should show.
 */
export default function CreateWhisper() {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { userId, session } = useSession();
  const { showToast } = useToast();

  const parentPostId = useLocalSearchParams()?.parentPostId;
  const parentPostIdString = typeof parentPostId === "string" ? parentPostId : undefined;
  const isReply = Boolean(parentPostIdString);

  const [body, setBody] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const [image, setImage] = useState<{ uri: string; mimeType: string; fileName: string } | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [anonymous] = useState(true);
  const [topicsOpen, setTopicsOpen] = useState(false);
  /* `null` means "no poll", an array means the builder is open. A photo and a
     poll cannot ride together — see `togglePoll` and `pickImage`. */
  const [pollOptions, setPollOptions] = useState<string[] | null>(null);

  useEffect(() => {
    if (!userId) return;
    void fetchWallet(userId).then((wallet) => setBalance(wallet?.balance ?? 0));
  }, [userId]);

  const cost = isReply ? FEED_REPLY_COST : FEED_POST_COST;
  const affordable = balance === null || balance >= cost;
  const filledPoll = (pollOptions ?? []).map((option) => option.trim()).filter(Boolean);
  const pollReady = !pollOptions || filledPoll.length >= 2;
  const canPost = body.trim().length > 0 || Boolean(imageUrl) || filledPoll.length >= 2;

  const setPollOption = (index: number, value: string) =>
    setPollOptions((current) => {
      if (!current) return current;
      const next = [...current];
      next[index] = value.slice(0, MAX_POLL_OPTION_CHARS);
      return next;
    });

  const addPollOption = () =>
    setPollOptions((current) =>
      current && current.length < MAX_POLL_OPTIONS ? [...current, ""] : current
    );

  const removePollOption = (index: number) =>
    setPollOptions((current) =>
      current && current.length > 2 ? current.filter((_, position) => position !== index) : current
    );

  const counter = useSharedValue(0);
  useEffect(() => {
    counter.value = withTiming(body.length / BODY_LIMIT, { duration: 180, easing: Easing.out(Easing.cubic) });
  }, [body.length, counter]);

  const counterStyle = useAnimatedStyle(() => ({
    width: `${Math.min(1, counter.value) * 100}%`,
    backgroundColor: counter.value > 0.9 ? COLORS.danger : COLORS.cyan,
  }));

  const pickImage = useCallback(async () => {
    if (pollOptions) {
      setPollOptions(null);
      showToast("Removed the poll — a whisper carries a photo or a poll, not both.", {
        variant: "subtle",
      });
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast("Photo access is off. Turn it on in your settings.", { variant: "warning" });
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });

    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];

    setImage({
      uri: asset.uri,
      mimeType: asset.mimeType ?? "image/jpeg",
      fileName: asset.fileName ?? `whisper-${Date.now()}.jpg`,
    });
  }, [pollOptions, showToast]);

  /* The upload happens on submit rather than on pick, so an abandoned draft
     leaves nothing in Cloudinary. */
  const uploadPendingImage = useCallback(async (): Promise<string | null> => {
    if (!image || !userId || !session?.access_token) return imageUrl;

    setUploading(true);
    try {
      const uploaded = await uploadImage(image, `feed-photos/${userId}`, session.access_token);
      setImageUrl(uploaded.url);
      return uploaded.url;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn't upload that photo.", { variant: "error" });
      return null;
    } finally {
      setUploading(false);
    }
  }, [image, imageUrl, session?.access_token, showToast, userId]);

  const submit = async () => {
    if (!userId || submitting || !canPost) return;
    if (!affordable) {
      showToast(`You need ${cost} coins to post.`, { variant: "warning" });
      return;
    }

    setSubmitting(true);

    if (!session?.access_token) {
      setSubmitting(false);
      showToast("Your session expired. Sign in again.", { variant: "error" });
      return;
    }

    const url = await uploadPendingImage();
    if (image && !url) {
      setSubmitting(false);
      return;
    }

    const result = await createFeedPost(
      {
        body: body.trim(),
        parentPostId: parentPostIdString ?? null,
        topic: isReply ? null : topic,
        imageUrl: url,
        /* The blurred placeholder the feed ships instead of the photo. Without
           one, a locked photo whisper has nothing to render, and the locked
           state would be a grey box rather than the picture. */
        imagePreview: url ? url.replace("/image/upload/", "/image/upload/w_24,e_blur:800,q_20/") : null,
        /* Padded to the server's ceiling here rather than trusted from the
           builder: the route is the authority on the option count. */
        pollOptions: pollOptions ? filledPoll.slice(0, MAX_POLL_OPTIONS) : null,
      },
      session.access_token
    );

    setSubmitting(false);

    if ("error" in result) {
      if (result.status === 403) {
        showToast("Your account can't post right now.", { variant: "error" });
      } else if (result.status === 429) {
        showToast("Slow down a moment — too many posts in a row.", { variant: "warning" });
      } else {
        showToast(result.error, { variant: "error" });
      }
      /* The upload is orphaned by a refused post; clean it up rather than
         leaving a photo in Cloudinary that no row points at. */
      if (url && session.access_token) void discardUpload(url, session.access_token);
      return;
    }

    vibrate("success");
    showToast(isReply ? "Reply posted" : "Whisper posted", { variant: "success" });
    if (userId) void fetchWallet(userId).then((wallet) => setBalance(wallet?.balance ?? 0));

    router.back();
  };

  const discardImage = async () => {
    if (imageUrl && session?.access_token) await discardUpload(imageUrl, session.access_token);
    setImage(null);
    setImageUrl(null);
  };

  /**
   * Photo or poll, never both.
   *
   * The web composer enforces this the same way. A post that carried both would
   * need two spends and two refund paths in the server route, and the card has
   * one place for a payload — so instead of silently dropping one, the tool that
   * was just tapped wins and says so.
   */
  const togglePoll = useCallback(() => {
    vibrate("tap");

    if (pollOptions) {
      setPollOptions(null);
      return;
    }

    if (image) {
      void discardImage();
      showToast("Removed the photo — a whisper carries a photo or a poll, not both.", {
        variant: "subtle",
      });
    }

    setPollOptions(["", ""]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discardImage, image, pollOptions, showToast]);

  const topicLabel = useMemo(
    () => FEED_TOPICS.find((entry) => entry.key === topic) ?? null,
    [topic]
  );

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <IconButton icon="close" size={40} onPress={() => router.back()} accessibilityLabel="Close" />

          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>{isReply ? "Reply" : "New whisper"}</Text>
            <Text style={styles.headerSub}>{isReply ? "Free to reply" : `Costs ${cost} coins`}</Text>
          </View>

          <GradientButton
            label={submitting ? "Posting…" : "Post"}
            icon="paper-plane"
            size="sm"
            loading={submitting || uploading}
            disabled={!canPost || submitting || uploading || !affordable}
            onPress={() => void submit()}
          />
        </View>

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 30 }]}
          keyboardShouldPersistTaps="handled"
        >
          <BlurView intensity={GLASS.blurIntensity} tint={GLASS.tint} style={styles.composer}>
            <TextInput
              value={body}
              onChangeText={(value) => setBody(value.slice(0, BODY_LIMIT))}
              placeholder={isReply ? "Say something back…" : "Say it. Anonymously."}
              placeholderTextColor={COLORS.subtle}
              multiline
              autoFocus
              keyboardAppearance={GLASS.tint === "light" ? "light" : "dark"}
              style={styles.input}
            />

            <View style={styles.counterTrack}>
              <Animated.View style={[styles.counterFill, counterStyle]} />
            </View>
          </BlurView>

          {image && (
            <GlassCard style={styles.attachment} radius={RADIUS.lg}>
              <View style={styles.attachmentInner}>
                <Image source={{ uri: image.uri }} style={styles.preview} contentFit="cover" />
                <View style={styles.attachmentText}>
                  <Text style={styles.attachmentTitle}>Photo attached</Text>
                  <Text style={styles.attachmentBody}>
                    It will be blurred until somebody spends their one look.
                  </Text>
                </View>
                <Pressable onPress={() => void discardImage()} hitSlop={10} accessibilityLabel="Remove photo">
                  <Ionicons name="close-circle" size={20} color={COLORS.muted} />
                </Pressable>
              </View>
            </GlassCard>
          )}

          {!isReply && (
            <>
              <Text style={styles.sectionLabel}>Topic</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topicRow}>
                {FEED_TOPICS.map((entry) => (
                  <Pressable
                    key={entry.key}
                    onPress={() => {
                      vibrate("tap");
                      setTopic(topic === entry.key ? null : entry.key);
                    }}
                  >
                    <TopicChip emoji={entry.emoji} label={entry.label} active={topic === entry.key} />
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}

          {pollOptions && (
            <GlassCard style={styles.pollCard} radius={RADIUS.lg}>
              <View style={styles.pollInner}>
                <View style={styles.pollHead}>
                  <Ionicons name="stats-chart-outline" size={16} color={COLORS.cyan} />
                  <Text style={styles.pollTitle}>Poll</Text>
                  <Text style={styles.pollHint}>2–{MAX_POLL_OPTIONS} options</Text>
                </View>

                {pollOptions.map((option, index) => (
                  <View key={index} style={styles.pollRow}>
                    <Text style={styles.pollIndex}>{index + 1}</Text>
                    <TextInput
                      value={option}
                      onChangeText={(value) => setPollOption(index, value)}
                      placeholder={`Option ${index + 1}`}
                      placeholderTextColor={COLORS.subtle}
                      keyboardAppearance={GLASS.tint === "light" ? "light" : "dark"}
                      style={styles.pollInput}
                    />
                    {pollOptions.length > 2 && (
                      <Pressable
                        onPress={() => {
                          vibrate("tap");
                          removePollOption(index);
                        }}
                        hitSlop={10}
                        accessibilityLabel={`Remove option ${index + 1}`}
                      >
                        <Ionicons name="close-circle" size={18} color={COLORS.muted} />
                      </Pressable>
                    )}
                  </View>
                ))}

                {pollOptions.length < MAX_POLL_OPTIONS && (
                  <Pressable
                    onPress={() => {
                      vibrate("tap");
                      addPollOption();
                    }}
                    style={styles.pollAdd}
                    accessibilityLabel="Add a poll option"
                  >
                    <Ionicons name="add-circle-outline" size={17} color={COLORS.purple} />
                    <Text style={styles.pollAddText}>Add option</Text>
                  </Pressable>
                )}

                {!pollReady && <Text style={styles.pollWarn}>A poll needs at least two options.</Text>}
              </View>
            </GlassCard>
          )}

          <View style={styles.optionRow}>
            <Pressable
              onPress={() => void pickImage()}
              style={[styles.option, image && styles.optionActive]}
              accessibilityLabel="Add a photo"
            >
              <Ionicons name="image-outline" size={19} color={COLORS.cyan} />
              <Text style={styles.optionText}>Photo</Text>
            </Pressable>

            {/* Polls are a root-post feature: the thread RPC does not compute
                tallies for replies, so a poll down a thread would render bars
                that never move. The server refuses it too. */}
            {!isReply && (
              <Pressable
                onPress={togglePoll}
                style={[styles.option, pollOptions && styles.optionActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: Boolean(pollOptions) }}
                accessibilityLabel="Add a poll"
              >
                <Ionicons name="stats-chart-outline" size={19} color={COLORS.purple} />
                <Text style={styles.optionText}>Poll</Text>
              </Pressable>
            )}

            <Pressable
              onPress={() => setTopicsOpen(true)}
              style={styles.option}
              accessibilityLabel="More options"
            >
              <Ionicons name="ellipsis-horizontal" size={19} color={COLORS.muted} />
              <Text style={styles.optionText}>More</Text>
            </Pressable>
          </View>

          <GlassCard style={styles.anonCard} radius={RADIUS.lg}>
            <View style={styles.anonInner}>
              <View style={styles.anonIcon}>
                <Ionicons name="eye-off-outline" size={18} color={COLORS.text} />
              </View>
              <View style={styles.anonText}>
                <Text style={styles.anonTitle}>Post anonymously</Text>
                <Text style={styles.anonBody}>
                  Always on. Your name, email and photo never appear with a whisper.
                </Text>
              </View>
              <Switch
                value={anonymous}
                onValueChange={() => {
                  vibrate("warning");
                  showToast("Anonymous is the only option here — that's the point.", { variant: "subtle" });
                }}
                trackColor={{ false: "rgba(255,255,255,0.12)", true: COLORS.cyan }}
                thumbColor={COLORS.text}
                disabled
              />
            </View>
          </GlassCard>

          {topicLabel && (
            <Text style={styles.voiceHint}>
              Posting to {topicLabel.emoji} {topicLabel.label}.
            </Text>
          )}

          <Text style={styles.footer}>
            {isReply
              ? "Replies are free and anonymous."
              : `Posting costs ${cost} coins · your balance is ${formatCoins(balance ?? 0)}`}
          </Text>

          {/* Voice notes are deliberately not offered here. `public_feed_posts`
              has no audio column — the feed is text, a photo or a poll — and the
              `voice-messages` bucket is scoped to conversations by its own
              storage policies, which parse the conversation id out of the
              object's first path segment. Recording one here would produce an
              upload with nowhere to live. They are sent from a chat, where the
              schema does store them. */}
          <Text style={styles.footerNote}>Voice notes are sent from a chat, where they play once.</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <Sheet visible={topicsOpen} onClose={() => setTopicsOpen(false)} title="Post options">
        <View style={{ paddingBottom: 10 }}>
          <SheetRow
            icon="image-outline"
            label="Add a photo"
            detail="View-once, blurred until opened"
            onPress={() => {
              setTopicsOpen(false);
              void pickImage();
            }}
          />
          <SheetRow
            icon="pricetag-outline"
            label="Clear topic"
            detail={topicLabel ? `Currently ${topicLabel.label}` : "No topic set"}
            onPress={() => {
              setTopic(null);
              setTopicsOpen(false);
            }}
          />
          <SheetRow
            icon="trash-outline"
            label="Discard draft"
            danger
            onPress={() => {
              setTopicsOpen(false);
              setBody("");
              void discardImage();
            }}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

const makeStyles = () => StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GLASS.border,
  },
  headerText: { flex: 1 },
  headerTitle: { color: COLORS.text, fontSize: 16, fontWeight: "800" },
  headerSub: { color: COLORS.muted, fontSize: 11.5, fontWeight: "600", marginTop: 1 },

  scroll: { padding: 16, gap: 14 },
  composer: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.55)",
    padding: 14,
    overflow: "hidden",
  },
  input: {
    color: COLORS.text,
    fontSize: 17,
    lineHeight: 24,
    minHeight: 130,
    textAlignVertical: "top",
  },
  counterTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginTop: 12,
    overflow: "hidden",
  },
  counterFill: { height: 3, borderRadius: 2 },

  attachment: {},
  attachmentInner: { flexDirection: "row", alignItems: "center", gap: 12 },
  preview: { width: 58, height: 58, borderRadius: RADIUS.md },
  attachmentText: { flex: 1 },
  attachmentTitle: { color: COLORS.text, fontSize: 14, fontWeight: "800" },
  attachmentBody: { color: COLORS.muted, fontSize: 11.5, marginTop: 3, lineHeight: 16 },

  sectionLabel: {
    color: COLORS.muted,
    fontSize: 11.5,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: -4,
  },
  topicRow: { gap: 8, paddingVertical: 4 },

  optionRow: { flexDirection: "row", gap: 10 },
  optionActive: { borderColor: "rgba(34,211,238,0.5)", backgroundColor: "rgba(34,211,238,0.08)" },
  pollCard: { marginTop: 14 },
  pollInner: { padding: 14 },
  pollHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  pollTitle: { color: COLORS.text, fontSize: 14, fontWeight: "800", flex: 1 },
  pollHint: { color: COLORS.subtle, fontSize: 11.5, fontWeight: "600" },
  pollRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  pollIndex: { color: COLORS.subtle, fontSize: 12, fontWeight: "800", width: 12, textAlign: "center" },
  pollInput: { flex: 1, color: COLORS.text, fontSize: 14, paddingVertical: 11 },
  pollAdd: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 6 },
  pollAddText: { color: COLORS.purple, fontSize: 13, fontWeight: "700" },
  pollWarn: { color: COLORS.warning, fontSize: 12, marginTop: 2 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: GLASS.border,
  },
  optionText: { color: COLORS.text, fontSize: 13, fontWeight: "700" },

  anonCard: {},
  anonInner: { flexDirection: "row", alignItems: "center", gap: 12 },
  anonIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "rgba(168,85,247,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  anonText: { flex: 1 },
  anonTitle: { color: COLORS.text, fontSize: 14.5, fontWeight: "800" },
  anonBody: { color: COLORS.muted, fontSize: 11.5, marginTop: 2, lineHeight: 16 },

  voiceHint: { color: COLORS.subtle, fontSize: 12, textAlign: "center" },
  footer: { color: COLORS.subtle, fontSize: 12, textAlign: "center", marginTop: 4 },
  footerNote: { color: COLORS.subtle, fontSize: 11, textAlign: "center", opacity: 0.75 },
});
