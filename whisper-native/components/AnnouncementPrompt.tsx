import { Image, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import Animated, { FadeIn, FadeInDown, FadeOutDown, Layout } from "react-native-reanimated";

import { useAnnouncements, type Announcement } from "@/lib/announcements";
import { vibrate } from "@/lib/haptics";
import { COLORS, FILLS, RADIUS, useStyles } from "@/lib/theme";

/**
 * The announcement prompt — the native port of the web app's
 * `components/AnnouncementPrompt.tsx`, mounted in the root layout.
 *
 * One at a time (the queue in `useAnnouncements`), a small modal that names
 * its kind, carries the message — and for a poll, the voting UI with the
 * viewer's option highlighted and live counts. A CTA opens its destination
 * (internal routes navigate; web links open in the browser), and the dismiss
 * is a real button, never a backdrop tap the user could hit by accident.
 */

const KIND_META: Record<
  Announcement["kind"],
  { icon: keyof typeof Ionicons.glyphMap; label: string; color: string }
> = {
  info: { icon: "information-circle", label: "Whisper update", color: COLORS.info },
  cta: { icon: "megaphone", label: "New on Whisper", color: COLORS.violet },
  poll: { icon: "bar-chart", label: "Your vote", color: COLORS.cyan },
  maintenance: { icon: "construct", label: "Scheduled maintenance", color: COLORS.warning },
};

export default function AnnouncementPrompt() {
  const styles = useStyles(makeStyles);
  const { current, voting, dismiss, vote } = useAnnouncements();
  const [error, setError] = useState<string | null>(null);

  if (!current) return null;

  const meta = KIND_META[current.kind] ?? KIND_META.info;
  const voted = current.my_vote !== null && current.my_vote !== undefined;
  const total = Math.max(current.total_votes ?? 0, 0);

  const handleCta = () => {
    const href = current.cta_href;
    dismiss(current.id);
    if (!href) return;
    if (href.startsWith("/")) {
      router.push(href as never);
      return;
    }
    void Linking.openURL(href);
  };

  const handleVote = async (optionIndex: number) => {
    setError(null);
    vibrate("tap");
    const result = await vote(current.id, optionIndex);
    if (!result.ok) setError(result.error ?? "Couldn't record that vote.");
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => dismiss(current.id)}>
      <View style={styles.scrim}>
        <Animated.View entering={FadeInDown.duration(280)} exiting={FadeOutDown.duration(200)} layout={Layout.springify().damping(18)} style={styles.card}>
          <View style={styles.accentHead}>
            <View style={[styles.accentMark, { backgroundColor: `${meta.color}22` }]}>
              <Ionicons name={meta.icon} size={20} color={meta.color} />
            </View>
            <Text style={[styles.accentLabel, { color: meta.color }]}>{meta.label}</Text>
          </View>

          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.body}>{current.body}</Text>

          {current.image_url ? (
            <Image source={{ uri: current.image_url }} style={styles.image} resizeMode="cover" />
          ) : null}

          {current.kind === "poll" && current.poll_options.length > 0 ? (
            <View style={styles.poll}>
              {current.poll_options.map((option, index) => {
                const count = current.vote_counts?.[index] ?? 0;
                const share = total > 0 ? count / total : 0;
                const mine = current.my_vote === index;
                return (
                  <Pressable
                    key={index}
                    disabled={voting}
                    onPress={() => void handleVote(index)}
                    style={({ pressed }) => [styles.pollRow, pressed && { opacity: 0.85 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Vote: ${option}`}
                  >
                    {voted ? (
                      <View style={styles.pollBarTrack}>
                        <View style={[styles.pollBar, { width: `${Math.round(share * 100)}%`, backgroundColor: mine ? COLORS.violet : FILLS[3] }]} />
                        <View style={styles.pollRowInner}>
                          <Ionicons
                            name={mine ? "checkmark-circle" : "ellipse-outline"}
                            size={15}
                            color={mine ? COLORS.violet : COLORS.subtle}
                          />
                          <Text style={[styles.pollText, mine && { color: COLORS.text, fontWeight: "800" }]} numberOfLines={1}>
                            {option}
                          </Text>
                          <Text style={styles.pollCount}>{total > 0 ? `${Math.round(share * 100)}%` : "—"}</Text>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.pollRowInner}>
                        <Ionicons name="ellipse-outline" size={15} color={COLORS.subtle} />
                        <Text style={styles.pollText} numberOfLines={1}>
                          {option}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
              {voted ? (
                <Text style={styles.pollMeta}>
                  {total} {total === 1 ? "vote" : "votes"}
                </Text>
              ) : (
                <Text style={styles.pollMeta}>Tap an option to vote</Text>
              )}
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            {current.kind === "cta" && current.cta_label ? (
              <Pressable
                onPress={() => {
                  vibrate("tap");
                  handleCta();
                }}
                style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}
                accessibilityRole="button"
                accessibilityLabel={current.cta_label}
              >
                <Text style={styles.ctaText}>{current.cta_label}</Text>
                <Ionicons name="arrow-forward" size={15} color={COLORS.contrast} />
              </Pressable>
            ) : (
              <View style={styles.ctaSpacer} />
            )}
            <Pressable
              onPress={() => {
                vibrate("tap");
                dismiss(current.id);
              }}
              style={({ pressed }) => [styles.dismiss, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel="Dismiss announcement"
            >
              <Text style={styles.dismissText}>Got it</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.58)",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    card: {
      width: "100%",
      maxWidth: 360,
      borderRadius: RADIUS.xl,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.surfaceSolid,
      padding: 18,
      gap: 12,
    },
    accentHead: { flexDirection: "row", alignItems: "center", gap: 9 },
    accentMark: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
    },
    accentLabel: { fontSize: 11.5, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
    title: { color: COLORS.text, fontSize: 18, fontWeight: "900", lineHeight: 24 },
    body: { color: COLORS.muted, fontSize: 14, lineHeight: 21 },
    image: { width: "100%", aspectRatio: 16 / 9, borderRadius: RADIUS.md },

    poll: { gap: 8 },
    pollRow: { borderRadius: RADIUS.md, overflow: "hidden" },
    pollBarTrack: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "transparent",
    },
    pollBar: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.55 },
    pollRowInner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: COLORS.border,
      borderRadius: RADIUS.md,
      backgroundColor: FILLS[1],
    },
    pollText: { flex: 1, color: COLORS.muted, fontSize: 13.5, fontWeight: "700" },
    pollCount: { color: COLORS.subtle, fontSize: 12, fontWeight: "800" },
    pollMeta: { color: COLORS.subtle, fontSize: 11.5, fontWeight: "700" },

    error: { color: COLORS.danger, fontSize: 12.5, fontWeight: "700" },

    actions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 },
    cta: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      flex: 1,
      height: 44,
      borderRadius: RADIUS.pill,
      backgroundColor: COLORS.violet,
    },
    ctaText: { color: COLORS.text, fontSize: 14, fontWeight: "900" },
    ctaSpacer: { flex: 1 },
    dismiss: {
      height: 44,
      paddingHorizontal: 20,
      borderRadius: RADIUS.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: FILLS[2],
    },
    dismissText: { color: COLORS.muted, fontSize: 14, fontWeight: "800" },
  });
