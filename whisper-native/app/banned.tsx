import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useEffect } from "react";

import { Background } from "@/components/Background";
import { GradientButton } from "@/components/GradientButton";
import { GhostMark } from "@/components/Logo";
import { formatBanExpiry, useBanStatus } from "@/lib/bans";
import { apiBase } from "@/lib/feed";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { COLORS, RADIUS, useStyles } from "@/lib/theme";

/**
 * The banned screen — the native port of the web app's `app/banned/page.tsx`.
 *
 * The root layout's ban gate routes here the moment `my_ban_status` says
 * "banned"; nothing else in the app stays reachable, the same contract the
 * web's BanGate keeps. Signed-out visitors are sent back to the intro —
 * a screen that says "your account" about no account is a lie.
 *
 * The server is the actual gate (bans live in triggers and RLS); this screen
 * is the reason the person finds out — with the reason, the expiry when it
 * is temporary, the way to appeal, and the way out.
 */
export default function Banned() {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { session, signOut } = useSession();
  const { banned, reason, duration, expiresAt, checking, recheck } = useBanStatus();

  /* A signed-out visitor has no ban to show — the web replaces onto "/". */
  useEffect(() => {
    if (!checking && !session) router.replace("/(auth)/onboarding");
  }, [checking, session]);

  const support = () => {
    const base = process.env.EXPO_PUBLIC_SITE_URL || "https://whisper-anonymous.vercel.app";
    void Linking.openURL(`${base}/contact-support`).catch(() =>
      showToast("Couldn't open support. Visit the website for help.", { variant: "error" })
    );
  };

  return (
    <View style={styles.root}>
      <Background />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 60, paddingBottom: Math.max(insets.bottom, 24) + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {checking ? (
          <Text style={styles.checking}>Checking your account…</Text>
        ) : !banned ? (
          <View style={styles.card}>
            <View style={styles.markWrap}>
              <GhostMark size={40} />
            </View>
            <Text style={styles.title}>Your account is active</Text>
            <Text style={styles.body}>There is no active restriction on this account.</Text>
            <GradientButton
              label="Back to Whisper"
              icon="arrow-forward"
              fullWidth
              onPress={() => router.replace("/(tabs)")}
              style={styles.button}
            />
            <Pressable onPress={() => recheck()} accessibilityRole="button" hitSlop={6}>
              <Text style={styles.subtleLink}>Re-check now</Text>
            </Pressable>
          </View>
        ) : (
          <Animated.View entering={FadeInDown.duration(420)} style={styles.card}>
            <View style={[styles.markWrap, styles.bannedMark]}>
              <Ionicons name="shield" size={34} color={COLORS.danger} />
            </View>
            <Text style={[styles.title, styles.dangerTitle]}>You&apos;ve been banned from Whisper</Text>

            {reason ? (
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Reason</Text>
                <Text style={styles.body}>{reason}</Text>
              </View>
            ) : null}

            {duration === "temporary" && expiresAt ? (
              <Text style={styles.body}>
                Your ban expires on <Text style={styles.strong}>{formatBanExpiry(expiresAt) ?? expiresAt}</Text>.
              </Text>
            ) : (
              <Text style={styles.body}>This restriction is permanent.</Text>
            )}

            <GradientButton
              label="Contact Support"
              icon="chatbubble-ellipses-outline"
              fullWidth
              onPress={support}
              style={styles.button}
            />
            <Pressable
              onPress={() => {
                void signOut();
              }}
              accessibilityRole="button"
              hitSlop={6}
            >
              <Text style={styles.subtleLink}>Sign out</Text>
            </Pressable>
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: COLORS.background },
    scroll: { paddingHorizontal: 22 },
    checking: { color: COLORS.muted, fontSize: 14, textAlign: "center", marginTop: 80 },

    card: {
      alignItems: "center",
      gap: 14,
      borderRadius: RADIUS.xl,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.card,
      padding: 26,
    },
    markWrap: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: COLORS.surface,
    },
    bannedMark: { backgroundColor: `${COLORS.danger}1f` },
    title: { color: COLORS.text, fontSize: 19, fontWeight: "900", textAlign: "center", lineHeight: 26 },
    dangerTitle: { color: COLORS.danger },
    body: { color: COLORS.muted, fontSize: 14, lineHeight: 21, textAlign: "center" },
    strong: { color: COLORS.text, fontWeight: "800" },
    row: { alignSelf: "stretch", gap: 4 },
    rowLabel: {
      color: COLORS.subtle,
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 1,
      textTransform: "uppercase",
    },
    button: { alignSelf: "stretch", marginTop: 6 },
    subtleLink: { color: COLORS.subtle, fontSize: 13, fontWeight: "700", paddingVertical: 4 },
  });
