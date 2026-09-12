import React, { useEffect } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { BLOBS, COLORS, FILLS, MOTION, RADIUS, useStyles } from "@/lib/theme";

/**
 * The background of every screen.
 *
 * Two soft radial washes — cyan top-left, purple bottom-right — over the flat
 * `#000000`. This is the same treatment the web app's `Background` component
 * gives the landing and dashboard: the colour is never a decorative gradient
 * across the whole surface, it is two lights sitting behind the content, which
 * is what keeps the glass panels reading as glass.
 *
 * `LinearGradient`'s `colors` cannot be transparent-to-colour in a radial
 * sense, so the washes are drawn as very large, very rounded gradient views
 * positioned partly off-screen. The effect is the same and it costs one view
 * each rather than a shader.
 */
export function Background({ children }: { children?: React.ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.root} pointerEvents="none">
      <LinearGradient
        colors={[BLOBS[2], "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.glowTop}
      />
      <LinearGradient
        colors={[BLOBS[1], "transparent"]}
        start={{ x: 1, y: 1 }}
        end={{ x: 0, y: 0 }}
        style={styles.glowBottom}
      />
      {children}
    </View>
  );
}

/**
 * Fades its children in on mount, and (optionally) rises them into place.
 *
 * Every screen uses this, which is what the brief asks for and what the web app
 * does with Framer Motion's `template.tsx`: content arrives rather than
 * appearing. 220ms is long enough to read as motion and short enough that a fast
 * screen never feels gated by its own animation.
 */
export function FadeIn({
  children,
  delay = 0,
  distance = 12,
  duration = MOTION.base,
  style,
  ...rest
}: ViewProps & {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  duration?: number;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * distance }],
  }));

  return (
    <Animated.View style={[style, animatedStyle]} {...rest}>
      {children}
    </Animated.View>
  );
}

/** A rounded, tinted plate used for icon buttons and small chips. */
export function Surface({
  children,
  style,
  ...rest
}: ViewProps & { children: React.ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={[styles.surface, style]} {...rest}>
      {children}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.background,
    overflow: "hidden",
  },
  glowTop: {
    position: "absolute",
    top: -180,
    left: -160,
    width: 420,
    height: 420,
    borderRadius: 210,
  },
  glowBottom: {
    position: "absolute",
    bottom: -220,
    right: -180,
    width: 480,
    height: 480,
    borderRadius: 240,
  },
  surface: {
    backgroundColor: FILLS[1],
    borderRadius: RADIUS.md,
  },
});
