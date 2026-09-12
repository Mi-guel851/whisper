import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { GradientButton } from "@/components/GradientButton";
import { Screen } from "@/components/Screen";
import { supabase } from "@/lib/supabase";
import { WHISPER_GAMES, type WhisperGame } from "@/lib/games";
import { vibrate } from "@/lib/haptics";
import { whisperLink } from "@/lib/profile";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { CARD_SHADOW, COLORS, GLASS, RADIUS, useStyles } from "@/lib/theme";

/**
 * Whisper Games — the native port of the web app's `/games` page.
 *
 * The screen exists to answer "what do I even ask people?" — so every card is
 * one tap from being sent, and Share is the primary action on each rather than
 * a detail view being the primary action. There is deliberately no per-game
 * page: an extra navigation step between "that one looks fun" and "sent" is
 * exactly where this kind of feature loses people.
 *
 * The web's share flow opens its own story-card sheet and then the browser's
 * share sheet; on a phone those collapse into one step — the OS share sheet
 * *is* the visual card, so `Share.share` carries the prompt and the link
 * together, in the web's exact message shape (prompt, a nudge, then the link
 * on its own line, because WhatsApp, Instagram and X all linkify a trailing
 * URL and leave the text before it alone).
 */
export default function Games() {
  const styles = useStyles(makeStyles);
  const router = useRouter();
  const { userId } = useSession();
  const { showToast } = useToast();

  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /* Which card just confirmed a copy. Held per-id rather than as a boolean so
     two quick copies on different cards don't tick the wrong one. */
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!userId) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      setUsername((data as { username: string | null } | null)?.username ?? null);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  /* No username, no link: a share whose whole purpose is to carry a link would
     be a picture of nothing. The banner says what to do about it, and Share
     still sends the bare prompt honestly rather than opening with a dead link. */
  const link = username ? whisperLink(username) : null;

  const composeMessage = useCallback(
    (prompt: string) => `${prompt}\n\nTell me anonymously 👇\n${link ?? whisperLink(null)}`,
    [link]
  );

  const handleShare = useCallback(
    async (game: WhisperGame) => {
      vibrate();
      const message = composeMessage(game.prompt);
      try {
        const result = await Share.share({ title: "Whisper", message });
        if (result.action === Share.sharedAction) {
          vibrate();
          return;
        }
        /* A dismissed sheet is the user declining — silently copying instead
           would be doing something they just said no to. */
      } catch {
        // dismissed; nothing to recover
      }
    },
    [composeMessage]
  );

  const handleCopy = useCallback(
    async (game: WhisperGame) => {
      try {
        await Clipboard.setStringAsync(composeMessage(game.prompt));
      } catch {
        showToast("Couldn't copy — try sharing instead.", { variant: "warning" });
        return;
      }
      vibrate();
      setCopiedId(game.id);
      showToast("Prompt and link copied", { variant: "subtle" });
      /* No cleanup ref: this only ever schedules a state reset that is harmless
         after unmount, and a per-card timer map would be more machinery than
         the tick is worth. */
      setTimeout(() => {
        setCopiedId((current) => (current === game.id ? null : current));
      }, 1600);
    },
    [composeMessage, showToast]
  );

  return (
    <Screen edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Ionicons name="game-controller-outline" size={22} color={COLORS.purple} />
          <Text style={styles.eyebrow}>Whisper Games</Text>
        </View>
        <Text style={styles.title}>Pick one. Send it. See what happens.</Text>
        <Text style={styles.subtitle}>
          Every game is a question people can answer anonymously. Share one and your Whisper link
          goes with it.
        </Text>

        {!link && !loading ? (
          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={16} color={COLORS.warning} />
            <Text style={styles.noticeText}>
              Set a username on your profile first — that&apos;s what creates the link these games
              are shared with.
            </Text>
            <GradientButton
              label="Set a username"
              icon="person-outline"
              size="sm"
              onPress={() => router.push("/settings")}
              style={styles.noticeCta}
            />
          </View>
        ) : null}

        {WHISPER_GAMES.map((game, index) => (
          <Animated.View key={game.id} entering={FadeInDown.delay(index * 55).springify().damping(16)}>
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <View style={[styles.tile, { backgroundColor: game.gradient[1] }]}>
                  <View
                    style={[
                      styles.tileInner,
                      { backgroundColor: game.gradient[0] },
                    ]}
                  />
                  <Text style={styles.tileEmoji}>{game.emoji}</Text>
                </View>
                <View style={styles.cardHeading}>
                  <Text style={styles.cardTitle}>{game.title}</Text>
                  <Text style={styles.cardTagline}>{game.tagline}</Text>
                </View>
              </View>

              <Text style={styles.cardPrompt}>“{game.prompt}”</Text>

              <View style={styles.cardActions}>
                <GradientButton
                  label="Share"
                  icon="share-social-outline"
                  size="sm"
                  onPress={() => void handleShare(game)}
                  style={styles.shareBtn}
                />
                <Pressable
                  accessibilityLabel={`Copy the ${game.title} prompt`}
                  onPress={() => void handleCopy(game)}
                  style={({ pressed }) => [styles.copyBtn, pressed && styles.copyBtnPressed]}
                >
                  <Ionicons
                    name={copiedId === game.id ? "checkmark" : "copy-outline"}
                    size={17}
                    color={copiedId === game.id ? COLORS.teal300 : COLORS.subtle}
                  />
                </Pressable>
              </View>
            </View>
          </Animated.View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = () => StyleSheet.create({
  scroll: { padding: 18, paddingBottom: 48, gap: 14 },

  header: { flexDirection: "row", alignItems: "center", gap: 7 },
  eyebrow: { color: COLORS.purple, fontSize: 12, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  title: { color: COLORS.text, fontSize: 24, fontWeight: "900", lineHeight: 30 },
  subtitle: { color: COLORS.muted, fontSize: 13.5, lineHeight: 20, marginTop: -6 },

  notice: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: RADIUS.md,
    backgroundColor: "rgba(245,158,11,0.10)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.32)",
  },
  noticeText: { flex: 1, color: COLORS.warning, fontSize: 12, lineHeight: 17 },
  noticeCta: { width: "100%", marginTop: 2 },

  card: {
    padding: 14,
    gap: 10,
    borderRadius: RADIUS.xl,
    backgroundColor: GLASS.background,
    borderWidth: 1,
    borderColor: GLASS.border,
    ...CARD_SHADOW,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  tile: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  tileInner: { ...StyleSheet.absoluteFillObject, opacity: 0.55 },
  tileEmoji: { fontSize: 22 },
  cardHeading: { flex: 1, gap: 2 },
  cardTitle: { color: COLORS.text, fontSize: 15, fontWeight: "900" },
  cardTagline: { color: COLORS.subtle, fontSize: 12, lineHeight: 16 },
  cardPrompt: { color: COLORS.muted, fontSize: 13, lineHeight: 19, fontStyle: "italic" },

  cardActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  shareBtn: { flex: 1 },
  copyBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(23,18,42,0.55)",
    borderWidth: 1,
    borderColor: GLASS.border,
  },
  copyBtnPressed: { transform: [{ scale: 0.92 }], backgroundColor: "rgba(34,211,238,0.10)" },
});
