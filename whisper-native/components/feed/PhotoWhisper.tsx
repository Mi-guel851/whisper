import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { COLORS, FILLS, RADIUS, useStyles } from "@/lib/theme";
import type { FeedImageState } from "@/lib/feedState";

/**
 * A photo whisper.
 *
 * The feed never ships the photo's bytes — only a ~24px blurred JPEG that rides
 * along in the row as a data URI (`image_preview`). That preview is what this
 * renders behind a frosted plate, so the "locked" state is genuinely the
 * picture and not a decorative stand-in, while being far too small to make out.
 *
 * Opening it spends the viewer's single look. The state machine is the web
 * client's:
 *
 *   locked       one tap from being spent
 *   loading      the claim is in flight
 *   spent        this viewer has had their look; it will not come back
 *   unavailable  expired, removed, or the server refused
 *
 * The author always sees their own photo and never sees a locked plate — they
 * cannot "spend" their own picture, and asking them to would be nonsense.
 */
export function PhotoWhisper({
  preview,
  state,
  isAuthor,
  onOpen,
  openUri,
}: {
  preview: string | null;
  state: FeedImageState;
  isAuthor: boolean;
  onOpen: () => void;
  /** The claimed photo, once the route has answered. */
  openUri?: string | null;
}) {
  const styles = useStyles(makeStyles);
  const overlay = useSharedValue(state === "locked" ? 1 : 0);

  React.useEffect(() => {
    overlay.value = withTiming(state === "locked" ? 1 : 0, { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [state, overlay]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlay.value }));

  const showPhoto = state === "spent" && Boolean(openUri);

  return (
    <Pressable
      onPress={state === "locked" ? onOpen : undefined}
      disabled={state !== "locked"}
      style={styles.wrap}
      accessibilityRole={state === "locked" ? "button" : "image"}
      accessibilityLabel={
        state === "locked"
          ? isAuthor
            ? "Your photo whisper"
            : "Photo whisper — tap to view once"
          : state === "spent"
            ? "Viewed photo whisper"
            : "Photo unavailable"
      }
    >
      {preview ? (
        <Image source={{ uri: preview }} style={styles.preview} contentFit="cover" blurRadius={4} />
      ) : (
        <View style={[styles.preview, styles.placeholder]} />
      )}

      {showPhoto && (
        <Image source={{ uri: openUri! }} style={[styles.preview, StyleSheet.absoluteFill]} contentFit="contain" />
      )}

      <Animated.View style={[styles.overlay, overlayStyle]} pointerEvents="none">
        <View style={styles.lockBadge}>
          <Ionicons name="lock-closed" size={18} color={COLORS.text} />
        </View>
        <Text style={styles.hint}>{isAuthor ? "Your photo whisper" : "Tap to view once"}</Text>
      </Animated.View>

      {state === "loading" && (
        <View style={styles.statusOverlay}>
          <ActivityIndicator color={COLORS.cyan} />
        </View>
      )}

      {state === "spent" && !openUri && (
        <View style={styles.spentBadge}>
          <Ionicons name="eye-off-outline" size={13} color={COLORS.muted} />
          <Text style={styles.spentText}>Viewed</Text>
        </View>
      )}

      {state === "unavailable" && (
        <View style={styles.statusOverlay}>
          <Text style={styles.unavailable}>This photo is no longer available.</Text>
        </View>
      )}
    </Pressable>
  );
}

const makeStyles = () => StyleSheet.create({
  wrap: {
    marginTop: 10,
    borderRadius: RADIUS.lg,
    overflow: "hidden",
    height: 200,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  preview: { width: "100%", height: "100%" },
  placeholder: { backgroundColor: FILLS[2] },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(10,8,20,0.45)",
  },
  lockBadge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,8,20,0.6)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  hint: { color: COLORS.text, fontSize: 12.5, fontWeight: "700" },
  statusOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,8,20,0.6)",
  },
  spentBadge: {
    position: "absolute",
    left: 10,
    bottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(10,8,20,0.7)",
  },
  spentText: { color: COLORS.muted, fontSize: 11, fontWeight: "700" },
  unavailable: { color: COLORS.muted, fontSize: 13, fontWeight: "600" },
});
