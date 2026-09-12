import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useEffect } from "react";

import { GradientText } from "@/components/GradientText";
import { Background } from "@/components/Background";
import { COLORS, GRADIENT_COLORS, RADIUS, glow } from "@/lib/theme";

/**
 * Onboarding.
 *
 * Full screen #0a0814, animated gradient "WHISPER" wordmark, tagline, gradient
 * Get Started button that pushes to login.
 */
export default function OnboardingScreen() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);
  const float = useSharedValue(0);
  const btnScale = useSharedValue(1);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) });
    float.value = withRepeat(
      withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [opacity, float]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: (1 - opacity.value) * 18 },
      { translateY: float.value * -8 },
    ],
  }));

  const taglineStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: (1 - opacity.value) * 14 }],
  }));

  const btnAnimStyle = useAnimatedStyle(() => ({ transform: [{ scale: btnScale.value }] }));

  return (
    <View style={styles.root}>
      <Background />

      <View style={styles.content}>
        <Animated.View style={logoStyle}>
          <View style={styles.logoMark}>
            <LinearGradient
              colors={GRADIENT_COLORS}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.logoCircle}
            >
              <Text style={styles.logoGlyph}>👻</Text>
            </LinearGradient>
            <GradientText style={styles.wordmark}>WHISPER</GradientText>
          </View>
        </Animated.View>

        <Animated.View style={taglineStyle}>
          <Text style={styles.tagline}>Say it. Anonymously.</Text>
          <Text style={styles.subtitle}>
            Share thoughts, voice notes, and moments without ever revealing who you are.
          </Text>
        </Animated.View>
      </View>

      <View style={styles.footer}>
        <Animated.View style={[btnAnimStyle, glow(COLORS.cyan, 20, 0.4)]}>
          <Pressable
            onPressIn={() => (btnScale.value = withTiming(0.96, { duration: 120 }))}
            onPressOut={() => (btnScale.value = withTiming(1, { duration: 180 }))}
            onPress={() => router.replace("/(auth)/login")}
          >
            <LinearGradient
              colors={GRADIENT_COLORS}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Get Started</Text>
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 28,
  },
  logoMark: { alignItems: "center", gap: 18 },
  logoCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  logoGlyph: { fontSize: 48 },
  wordmark: { fontSize: 44, letterSpacing: 4 },
  tagline: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 12,
    color: COLORS.muted,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 18,
  },
  footer: { padding: 24, paddingBottom: 48 },
  button: {
    height: 60,
    borderRadius: RADIUS.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "900", letterSpacing: 0.3 },
});
