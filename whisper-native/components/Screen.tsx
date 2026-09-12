import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { Background, FadeIn } from "./Background";
import { GlassCard } from "./GlassCard";
import { COLORS, GRADIENT_COLORS, RADIUS, useStyles } from "@/lib/theme";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

/**
 * The screen shell.
 *
 * Every screen in this app is the same three things: the `#000000` background,
 * a safe-area inset, and a fade-in on mount. Putting them in one component is
 * not just convenience — it is what makes "no white screens anywhere" a
 * structural property rather than a rule forty files have to remember.
 */
export function Screen({
  children,
  edges = ["top", "left", "right"],
  padded = true,
}: {
  children: React.ReactNode;
  edges?: Edge[];
  padded?: boolean;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.root}>
      <Background />
      <SafeAreaView style={styles.flex} edges={edges}>
        <FadeIn style={[styles.flex, padded && styles.padded]}>{children}</FadeIn>
      </SafeAreaView>
    </View>
  );
}

/**
 * The full-screen gate.
 *
 * Shown while a session read or a first page is in flight — and always on
 * `#000000`, so the splash is part of the app rather than a white flash with a
 * spinner on it.
 */
export function LoadingScreen({ label = "Loading" }: { label?: string }) {
  const styles = useStyles(makeStyles);
  const rotation = useSharedValue(0);

  React.useEffect(() => {
    rotation.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false);
  }, [rotation]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  return (
    <View style={styles.root}>
      <Background />
      <View style={styles.loadingWrap}>
        <Animated.View style={style}>
          <LinearGradient
            colors={GRADIENT_COLORS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.spinner}
          >
            <View style={styles.spinnerHole} />
          </LinearGradient>
        </Animated.View>
        <Text style={styles.loadingLabel}>{label}</Text>
      </View>
    </View>
  );
}

/** A centred spinner sized for a section rather than a screen. */
export function InlineLoader({ label }: { label?: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.inlineLoader}>
      <ActivityIndicator color={COLORS.cyan} size="small" />
      {label ? <Text style={styles.inlineLabel}>{label}</Text> : null}
    </View>
  );
}

/**
 * The empty state.
 *
 * Big glyph, one sentence, an optional action. The wording is the caller's —
 * this only guarantees that "nothing here" never renders as a blank screen,
 * which reads as a bug.
 */
export function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.emptyWrap}>
      <GlassCard style={styles.emptyCard} radius={RADIUS.xl}>
        <View style={styles.emptyInner}>
          <LinearGradient
            colors={["rgba(34,211,238,0.22)", "rgba(168,85,247,0.22)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.emptyIcon}
          >
            <Ionicons name={icon} size={30} color={COLORS.text} />
          </LinearGradient>

          <Text style={styles.emptyTitle}>{title}</Text>
          {body ? <Text style={styles.emptyBody}>{body}</Text> : null}

          {actionLabel && onAction ? (
            <Pressable onPress={onAction} style={styles.emptyAction}>
              <Text style={styles.emptyActionText}>{actionLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      </GlassCard>
    </View>
  );
}

/** A pulse placeholder for a list that is still loading. */
export function SkeletonRow({ height = 72 }: { height?: number }) {
  const styles = useStyles(makeStyles);
  const opacity = useSharedValue(0.35);

  React.useEffect(() => {
    opacity.value = withRepeat(withTiming(0.7, { duration: 750, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[styles.skeleton, { height }, style]} />;
}

const makeStyles = () => StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  padded: { paddingHorizontal: 16 },

  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18 },
  spinner: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  spinnerHole: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.background },
  loadingLabel: { color: COLORS.muted, fontSize: 14, fontWeight: "600" },

  inlineLoader: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 18 },
  inlineLabel: { color: COLORS.muted, fontSize: 13 },

  emptyWrap: { paddingTop: 40, alignItems: "center" },
  emptyCard: { width: "100%" },
  emptyInner: { alignItems: "center", gap: 12, paddingVertical: 22, paddingHorizontal: 18 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: COLORS.text, fontSize: 17, fontWeight: "800", textAlign: "center" },
  emptyBody: {
    color: COLORS.muted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  emptyAction: { marginTop: 6, paddingVertical: 8, paddingHorizontal: 12 },
  emptyActionText: { color: COLORS.cyan, fontSize: 14, fontWeight: "800" },

  skeleton: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: RADIUS.lg,
    marginBottom: 12,
  },
});
