import Ionicons from "@expo/vector-icons/Ionicons";
import { BlurView } from "expo-blur";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { GradientButton } from "@/components/GradientButton";
import { Field } from "@/components/Input";
import { LoadingScreen, Screen } from "@/components/Screen";
import { apiBase } from "@/lib/feed";
import { vibrate } from "@/lib/haptics";
import { uploadImage, type LocalImage } from "@/lib/uploads";
import { sendWhisper, type SenderContext } from "@/lib/whispers";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { CARD_SHADOW, COLORS, GLASS, RADIUS, useStyles } from "@/lib/theme";

type Subject = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
};

const MESSAGE_LIMIT = 2000;

/**
 * Send an anonymous whisper.
 *
 * The native port of the web app's `/u/[username]` send form, and the screen
 * the profile page's primary button opens. Three things, in the web page's own
 * order:
 *
 *  1. The sender context is fetched on mount and held in a ref — a promise the
 *     send only reads if it actually fires. Nothing is written by opening this
 *     screen, and closing it discards everything.
 *  2. The photo, if any, uploads to Cloudinary on submit rather than on pick,
 *     so an abandoned draft leaves nothing behind.
 *  3. The insert goes through `sendWhisper`, which writes exactly the columns
 *     the web client writes — message, optional image, and the four coarse
 *     context fields. The recipient's notification is written by the database
 *     trigger on `messages`; the client must not insert into `notifications`
 *     or every whisper would be announced twice.
 *
 * On the device string: the web parses the `user-agent` header, which a React
 * Native fetch does not carry in a parseable form, so the device half of the
 * hint degrades honestly to the platform family ("iPhone" / "Android device").
 * The location half still comes from the same edge route — the request from
 * this app traverses the same Vercel edge the browser's does.
 */
export default function SendWhisper() {
  const styles = useStyles(makeStyles);
  const { username, userId } = useLocalSearchParams<{ username?: string; userId?: string }>();
  const { session, userId: myId } = useSession();
  const { showToast } = useToast();

  const [subject, setSubject] = useState<Subject | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [image, setImage] = useState<LocalImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  /* The in-flight context request, exactly the web page's pattern: started on
     mount, awaited on send, columns written only then. A ref rather than state
     so a slow network can never re-render the form into a stale closure. */
  const contextRef = useRef<Promise<SenderContext> | null>(null);

  useEffect(() => {
    contextRef.current = (async (): Promise<SenderContext> => {
      const device =
        Platform.OS === "ios" ? "iPhone" : Platform.OS === "android" ? "Android device" : Platform.OS;
      try {
        const res = await fetch(`${apiBase()}/api/sender-context`);
        if (!res.ok) return { country: null, state: null, city: null, device };
        const data = (await res.json()) as Partial<SenderContext>;
        return {
          country: data.country ?? null,
          state: data.state ?? null,
          city: data.city ?? null,
          device,
        };
      } catch {
        return { country: null, state: null, city: null, device };
      }
    })();
    return () => {
      contextRef.current = null;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      try {
        if (userId && typeof userId === "string") {
          const { data } = await supabase
            .from("profiles")
            .select("id,username,display_name,avatar_url,bio")
            .eq("id", userId)
            .maybeSingle();
          if (alive) setSubject((data as Subject | null) ?? null);
        } else if (username) {
          const { data } = await supabase
            .from("profiles")
            .select("id,username,display_name,avatar_url,bio")
            .eq("username", String(username).toLowerCase().replace(/^@/, ""))
            .maybeSingle();
          if (alive) setSubject((data as Subject | null) ?? null);
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [username, userId]);

  const pickImage = useCallback(async () => {
    if (image) {
      setImage(null);
      showToast("Photo removed", { variant: "subtle" });
      return;
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
  }, [image, showToast]);

  const send = useCallback(async () => {
    if (!subject || sending || sent) return;
    if (!message.trim() && !image) {
      showToast("Write something first — a whisper needs words or a photo.", { variant: "warning" });
      return;
    }
    if (myId && myId === subject.id) {
      showToast("That's you — whispers are for other people.", { variant: "warning" });
      return;
    }

    vibrate();
    setSending(true);
    try {
      /* Capture the context before any await that could outlive the screen —
         the ref is nulled on unmount. */
      const contextPromise = contextRef.current;
      const context = contextPromise ? await contextPromise : undefined;

      let imageUrl: string | null = null;
      if (image && session?.access_token) {
        setUploading(true);
        try {
          const uploaded = await uploadImage(image, `whisper-photos/${subject.id}`, session.access_token);
          imageUrl = uploaded.url;
        } catch (error) {
          showToast(error instanceof Error ? error.message : "Couldn't upload that photo.", {
            variant: "error",
          });
          return;
        } finally {
          setUploading(false);
        }
      }

      const result = await sendWhisper({
        recipientId: subject.id,
        message,
        imageUrl,
        context,
      });

      if (!result.ok) {
        showToast(result.error, { variant: "error" });
        return;
      }

      vibrate();
      setSent(true);
      showToast("Sent anonymously", { variant: "success" });
    } finally {
      setSending(false);
    }
  }, [image, message, myId, sent, sending, session?.access_token, showToast, subject]);

  if (loading) return <LoadingScreen label="Opening" />;

  if (!subject) {
    return (
      <Screen>
        <View style={styles.missing}>
          <Ionicons name="person-circle-outline" size={56} color={COLORS.muted} />
          <Text style={styles.missingTitle}>No such user</Text>
          <Text style={styles.missingBody}>
            This Whisper link doesn&apos;t point at anyone. Check the username and try again.
          </Text>
          <GradientButton
            label="Go back"
            variant="glass"
            onPress={() => router.back()}
            style={styles.missingButton}
          />
        </View>
      </Screen>
    );
  }

  const name = subject.display_name?.trim() || subject.username || "Anonymous user";

  return (
    <Screen edges={["top", "left", "right"]}>
      {sent ? (
        <View style={styles.done}>
          <View style={[styles.doneMark, { shadowColor: COLORS.cyan }]}>
            <Ionicons name="checkmark" size={40} color={COLORS.cyan} />
          </View>
          <Text style={styles.doneTitle}>Whisper sent</Text>
          <Text style={styles.doneBody}>
            {name} will never know it was you. Your name isn&apos;t attached — not to the message,
            not to the notification, nowhere.
          </Text>
          <GradientButton
            label="Send another"
            icon="add"
            variant="glass"
            onPress={() => {
              setSent(false);
              setMessage("");
              setImage(null);
            }}
            style={styles.doneButton}
          />
          <GradientButton label="Done" onPress={() => router.back()} style={styles.doneButton} />
        </View>
      ) : (
        <>
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
              <Ionicons name="chevron-back" size={24} color={COLORS.text} />
            </Pressable>
            <Text style={styles.title}>Anonymous Whisper</Text>
          </View>

          <BlurView intensity={GLASS.blurIntensity} tint={GLASS.tint} style={styles.identity}>
            <View style={styles.identityInner}>
              <Avatar authorId={subject.id} size={54} imageUrl={subject.avatar_url} />
              <View style={styles.identityText}>
                <Text style={styles.identityName} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={styles.identityHandle}>
                  {subject.username ? `@${subject.username}` : "Anonymous user"}
                </Text>
              </View>
              <View style={styles.anonBadge}>
                <Ionicons name="eye-off-outline" size={13} color={COLORS.cyan} />
                <Text style={styles.anonBadgeText}>You stay hidden</Text>
              </View>
            </View>
          </BlurView>

          <View style={[styles.compose, styles.glass]}>
            <View style={styles.composeTop}>
              <Text style={styles.composeLabel}>Your whisper</Text>
              <Text style={styles.count}>
                {message.length}/{MESSAGE_LIMIT}
              </Text>
            </View>

            <Field
              value={message}
              onChangeText={setMessage}
              placeholder="Say the thing. No name attached — they'll only see the words."
              multiline
              maxLength={MESSAGE_LIMIT}
              autoCapitalize="sentences"
              style={styles.field}
            />

            {image ? (
              <View style={styles.imageRow}>
                <Image source={{ uri: image.uri }} style={styles.imageThumb} />
                <Pressable onPress={pickImage} style={styles.imageRemove} hitSlop={8}>
                  <Ionicons name="close-circle" size={22} color={COLORS.danger} />
                </Pressable>
              </View>
            ) : null}

            <View style={styles.composeActions}>
              <Pressable onPress={pickImage} style={styles.attach} hitSlop={6}>
                <Ionicons
                  name={image ? "trash-outline" : "image-outline"}
                  size={19}
                  color={image ? COLORS.danger : COLORS.cyan}
                />
                <Text style={[styles.attachText, image && { color: COLORS.danger }]}>
                  {image ? "Remove photo" : "Add a photo"}
                </Text>
                {uploading ? <ActivityIndicator size="small" color={COLORS.cyan} /> : null}
              </Pressable>
            </View>
          </View>

          <Text style={styles.notice}>
            Whisper never shares your identity. Only coarse details — country and device family —
            reach the recipient, and only if they pay coins for a Hint.
          </Text>

          <GradientButton
            label={sending || uploading ? "Sending" : "Send it anonymously"}
            icon="paper-plane-outline"
            loading={sending || uploading}
            disabled={!message.trim() && !image}
            onPress={() => void send()}
            size="lg"
            style={styles.send}
          />
        </>
      )}
    </Screen>
  );
}

const makeStyles = () => StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  back: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18 },
  title: { color: COLORS.text, fontSize: 20, fontWeight: "800", flex: 1 },

  identity: {
    borderRadius: RADIUS.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: GLASS.border,
    marginBottom: 14,
    ...CARD_SHADOW,
  },
  identityInner: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  identityText: { flex: 1, gap: 2 },
  identityName: { color: COLORS.text, fontSize: 16, fontWeight: "800" },
  identityHandle: { color: COLORS.muted, fontSize: 12.5, fontWeight: "600" },
  anonBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(34,211,238,0.12)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.26)",
  },
  anonBadgeText: { color: COLORS.cyan, fontSize: 10.5, fontWeight: "800" },

  glass: {
    backgroundColor: GLASS.background,
    borderWidth: 1,
    borderColor: GLASS.border,
    borderRadius: RADIUS.lg,
    ...CARD_SHADOW,
  },
  compose: { padding: 14, gap: 10 },
  composeTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  composeLabel: { color: COLORS.text, fontSize: 13.5, fontWeight: "800" },
  count: { color: COLORS.subtle, fontSize: 11.5, fontWeight: "700" },

  field: {},

  imageRow: { alignSelf: "flex-start" },
  imageThumb: { width: 96, height: 96, borderRadius: RADIUS.md, borderWidth: 1, borderColor: GLASS.border },
  imageRemove: { position: "absolute", top: -8, right: -8 },

  composeActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  attach: { flexDirection: "row", alignItems: "center", gap: 7 },
  attachText: { color: COLORS.cyan, fontSize: 13, fontWeight: "800" },

  notice: {
    color: COLORS.subtle,
    fontSize: 11.5,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 12,
    paddingHorizontal: 10,
  },

  send: { marginTop: 18 },

  done: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  doneMark: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(34,211,238,0.12)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.3)",
    shadowRadius: 24,
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 0 },
  },
  doneTitle: { color: COLORS.text, fontSize: 22, fontWeight: "900", marginTop: 6 },
  doneBody: {
    color: COLORS.muted,
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 320,
  },
  doneButton: { marginTop: 8, maxWidth: 320 },

  missing: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 28 },
  missingTitle: { color: COLORS.text, fontSize: 20, fontWeight: "900" },
  missingBody: { color: COLORS.muted, fontSize: 13.5, textAlign: "center", lineHeight: 20 },
  missingButton: { marginTop: 10, maxWidth: 260 },
});
