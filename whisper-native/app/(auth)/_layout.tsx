import { Ionicons } from "@expo/vector-icons";
import { Redirect, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { useEffect } from "react";

import { Background } from "@/components/Background";
import { LoadingScreen } from "@/components/Screen";
import { useSession } from "@/lib/session";
import { COLORS, glow } from "@/lib/theme";

/**
 * The pre-account group.
 *
 * Every route in here is a screen for somebody *without* a session, so the
 * layout is the guard: while the auth read is in flight it holds a loader, and
 * with a session it redirects to the tabs before any auth screen can paint.
 * The screens themselves never check — one guard, in one place, is the reason
 * a deep link to /login while signed in lands on the feed instead of a form.
 */
export default function AuthLayout() {
  const { session, loading } = useSession();
  const breathe = useSharedValue(1);

  useEffect(() => {
    breathe.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, [breathe]);

  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: breathe.value }] }));

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <Background />
        <Animated.View style={[styles.mark, glow(COLORS.cyan, 26, 0.45), markStyle]}>
          <Ionicons name="chatbubbles" size={30} color={COLORS.cyan} />
        </Animated.View>
        <LoadingScreen label="Whisper" />
      </View>
    );
  }

  if (session) {
    return <Redirect href="/(tabs)/feed" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: styles.content,
      }}
    >
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  content: { backgroundColor: COLORS.background },
  center: { alignItems: "center", justifyContent: "center" },
  mark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(34,211,238,0.12)",
  },
});
