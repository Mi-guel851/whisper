import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GradientText } from "@/components/GradientText";
import { GradientButton } from "@/components/GradientButton";
import { Background } from "@/components/Background";
import { COLORS, GRADIENT_COLORS, glow } from "@/lib/theme";
import type { AuthStackParamList } from "@/navigation/types";

type Props = NativeStackScreenProps<AuthStackParamList, "Splash">;

/**
 * The first screen.
 *
 * A gradient ghost that breathes, the wordmark, the tagline, and one button.
 * That is the whole page — the web app's landing is a hero plus a value
 * proposition, and a phone cannot hold a hero plus a value proposition without
 * becoming a scroll; a first-run screen that needs scrolling is a first-run
 * screen nobody reads.
 *
 * THE ANIMATION
 *
 * Everything arrives in sequence rather than at once: the mark fades and lifts,
 * the wordmark follows, the tagline follows that, and the button last. Staggered
 * entrances are the cheapest way to make a static screen feel like it was
 * designed rather than assembled — and on a cold start it covers the moment the
 * session read is still in flight.
 *
 * The ghost keeps breathing after the entrance, because a screen the user may
 * sit on for a second needs *something* alive on it. Motion is stopped by the
 * platform when "reduce motion" is on, so this is not an accessibility problem.
 *
 * Where it goes depends on the session, not on the user: an already-signed-in
 * user goes straight to the feed, and the Auth screen is only ever seen by
 * somebody who needs it. `useSession()` has the answer by the time the entrance
 * has finished — the read starts in `App.tsx`, before this screen mounts, so
 * the sequence is decorative rather than a mandatory wait.
 */
export function SplashScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  const markScale = useSharedValue(0.8);
  const markOpacity = useSharedValue(0);
  const breathe = useSharedValue(1);
  const titleOpacity = useSharedValue(0);
  const titleShift = useSharedValue(18);
  const taglineOpacity = useSharedValue(0);
  const buttonOpacity = useSharedValue(0);
  const buttonShift = useSharedValue(22);

  useEffect(() => {
    markOpacity.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
    markScale.value = withSpring(1, { damping: 12, stiffness: 120 });

    titleOpacity.value = withDelay(180, withTiming(1, { duration: 420 }));
    titleShift.value = withDelay(180, withTiming(0, { duration: 420, easing: Easing.out(Easing.cubic) }));

    taglineOpacity.value = withDelay(340, withTiming(1, { duration: 420 }));

    buttonOpacity.value = withDelay(500, withTiming(1, { duration: 420 }));
    buttonShift.value = withDelay(500, withTiming(0, { duration: 460, easing: Easing.out(Easing.cubic) }));

    /* The heartbeat: a small, slow swell that never completes and never
       announces itself. Anything larger reads as a loading state. */
    breathe.value = withRepeat(
      withSequence(
        withTiming(1.045, { duration: 1900, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 1900, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, [breathe, buttonOpacity, buttonShift, markOpacity, markScale, taglineOpacity, titleOpacity, titleShift]);

  /* This screen is only ever mounted when there is no session — the root
     navigator decides that, and it holds the splash while the session read is
     in flight. So there is nothing to redirect *to* here: an existing user is
     already past this stack, and a new one is meant to read the tagline. */

  /* `Get Started` is the only way forward, and it opens on signup: the app's
     first run is somebody creating an account, and a login form as the landing
     tab is a form for a password they do not have yet. */
  const start = () => navigation.navigate("Auth", { mode: "signup" });

  const markStyle = useAnimatedStyle(() => ({
    opacity: markOpacity.value,
    transform: [{ scale: markScale.value * breathe.value }],
  }));

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleShift.value }],
  }));

  const taglineStyle = useAnimatedStyle(() => ({ opacity: taglineOpacity.value }));

  const buttonStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ translateY: buttonShift.value }],
  }));

  return (
    <View style={styles.root}>
      <Background />

      <View style={styles.center}>
        <Animated.View style={markStyle}>
          <LinearGradient
            colors={GRADIENT_COLORS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.markRing, glow(COLORS.cyan, 34, 0.5)]}
          >
            <View style={styles.markInner}>
              <Image
                source={require("../assets/ghost-mark.png")}
                style={styles.mark}
                contentFit="contain"
              />
            </View>
          </LinearGradient>
        </Animated.View>

        <Animated.View style={titleStyle}>
          <GradientText style={styles.wordmark}>Whisper</GradientText>
        </Animated.View>

        <Animated.View style={taglineStyle}>
          <Text style={styles.tagline}>Say it. Anonymously.</Text>
        </Animated.View>

        <View style={styles.promiseRow}>
          {[
            { icon: "lock-closed-outline" as const, label: "No names" },
            { icon: "eye-off-outline" as const, label: "No traces" },
            { icon: "sparkles-outline" as const, label: "Just words" },
          ].map((item) => (
            <View key={item.label} style={styles.promise}>
              <Ionicons name={item.icon} size={14} color={COLORS.purple} />
              <Text style={styles.promiseText}>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <Animated.View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 22) }, buttonStyle]}>
        <GradientButton label="Get Started" icon="arrow-forward" size="lg" fullWidth onPress={start} />
        <Text style={styles.legal}>
          Whisper is anonymous by design. Nothing here asks for your real name.
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  markRing: { width: 132, height: 132, borderRadius: 66, padding: 3 },
  markInner: {
    flex: 1,
    borderRadius: 63,
    backgroundColor: "rgba(10,8,20,0.86)",
    alignItems: "center",
    justifyContent: "center",
  },
  mark: { width: 74, height: 74 },
  wordmark: { fontSize: 46, fontWeight: "900", letterSpacing: -1.6, marginTop: 26 },
  tagline: {
    color: COLORS.muted,
    fontSize: 16,
    fontWeight: "600",
    marginTop: 10,
    letterSpacing: 0.2,
  },
  promiseRow: { flexDirection: "row", gap: 14, marginTop: 30 },
  promise: { flexDirection: "row", alignItems: "center", gap: 5 },
  promiseText: { color: COLORS.subtle, fontSize: 12.5, fontWeight: "700" },
  footer: { paddingHorizontal: 22, gap: 12 },
  legal: { color: COLORS.subtle, fontSize: 11.5, textAlign: "center", lineHeight: 16 },
});
