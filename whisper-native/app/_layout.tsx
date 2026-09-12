import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { Stack, router } from "expo-router";
import { PaystackProvider } from "react-native-paystack-webview";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import { Background } from "@/components/Background";
import { resetBadges, watchBadges } from "@/lib/badges";
import { registerForPushNotifications, handleNotificationResponse } from "@/lib/push";
import { SessionProvider, useSession } from "@/lib/session";
import { ToastProvider } from "@/lib/toast";
import { COLORS, glow } from "@/lib/theme";

/**
 * The root layout.
 *
 * Five providers, and the order is the dependency order:
 *
 *   GestureHandlerRootView   every swipe, press and drag in the app
 *   SafeAreaProvider         the insets every screen reads
 *   SessionProvider          who is signed in — starts the auth read immediately
 *   ToastProvider            messages, which the session's errors use
 *   PaystackProvider         the coin checkout, keyed on the public key
 *
 * `SessionProvider` is deliberately high in the stack and mounts before the
 * navigator: the auth read runs while the splash is animating, so the first
 * screen is never a spinner waiting on a network round trip it could have
 * started earlier.
 *
 * THE ROUTE TREE
 *
 *   app/
 *   ├── index.tsx        the fork: session ? (tabs) : (auth)
 *   ├── (auth)/          onboarding, login, signup — seen before an account
 *   ├── (tabs)/          feed · dms · notifications · profile
 *   └── coins, create-whisper, conversation, whisper-detail,
 *       settings, forgot-password, saved, u   — opened over the tabs
 *
 * The Paystack provider is given the public key from the environment. With no
 * key the store still renders and says so, rather than crashing at import time
 * — a missing build variable should be a visible configuration problem, not a
 * white screen.
 */
export default function RootLayout() {
  const paystackKey = process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY || "";

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <View style={styles.root}>
          {/* Light content on a #0a0814 app: the status bar is part of the
              design, not a system bar sitting on top of it. */}
          <StatusBar style="light" />

          <SessionProvider>
            <ToastProvider>
              <PaystackProvider publicKey={paystackKey} currency="NGN">
                <RootShell />
              </PaystackProvider>
            </ToastProvider>
          </SessionProvider>
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Everything that needs the session.
 *
 * While the auth read is in flight the route tree is held back entirely: a
 * flash of the login screen before "actually, you're signed in" is exactly the
 * white-flash-between-screens bug this layout exists to prevent. The badges
 * watcher and the push registration also live here, because they follow the
 * *session* and not any one screen — a user who never opens the notifications
 * tab still needs the tab bar to be honest, and a device token has to be
 * registered on the session that owns it.
 */
function RootShell() {
  const { session, userId, loading } = useSession();

  /* Badges follow the session. */
  useEffect(() => {
    if (!userId) {
      resetBadges();
      return;
    }

    const stop = watchBadges(userId);
    void registerForPushNotifications(userId).catch(() => {});
    return stop;
  }, [userId]);

  /* A tap on a push opens the thing it is about. Handled at the root because
     the app may be cold-started by it, in which case no screen is mounted yet
     to receive the event — the router singleton is the only addressable target
     at that moment, and one frame of slack covers the read that resolves it. */
  useEffect(() => {
    return handleNotificationResponse((hint) => {
      const navigate = () => {
        if (hint.conversationId) {
          router.push({ pathname: "/conversation", params: { conversationId: hint.conversationId } });
          return;
        }
        if (hint.postId) {
          router.push({ pathname: "/whisper-detail", params: { postId: hint.postId } });
          return;
        }
        if (hint.route?.startsWith("/notifications")) {
          router.push("/(tabs)/notifications");
        }
      };

      setTimeout(navigate, 260);
    });
  }, []);

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <Background />
        <BreathingMark />
        <Text style={styles.loadingLabel}>Whisper</Text>
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: styles.content,
      }}
    >
      <Stack.Screen name="index" />

      {/* The pre-account group. Guarded in its own layout: signed-in users
          never see it, even from a deep link. */}
      <Stack.Screen name="(auth)" />

      {/* The four tabs. The bar itself is built in (tabs)/_layout. */}
      <Stack.Screen name="(tabs)" />

      {/* Everything that opens over the tabs. The composer and the wallet
          present as modals, the way the web app's sheets do. */}
      <Stack.Screen
        name="create-whisper"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="settings"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="coins"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen name="conversation" />
      <Stack.Screen name="whisper-detail" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="saved" />
      <Stack.Screen name="u" />

      {/* Phase-2 surfaces. complete-profile is a full stop, not a modal: it
          gates the account until the profile trigger lets messaging through.
          The whisper composer presents as a modal, like the web's own form
          feels — a card over the profile, dismissible, nothing underneath
          navigated away from. The hub pages (discover / games / friends /
          legal / help / support / feedback / favorites) push as ordinary
          screens, the way the web app routes to them. */}
      <Stack.Screen
        name="complete-profile"
        options={{ gestureEnabled: false, headerBackVisible: false }}
      />
      <Stack.Screen
        name="whisper"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen name="friends" />
      <Stack.Screen name="games" />
      <Stack.Screen name="discover" />
      <Stack.Screen name="legal" />
      <Stack.Screen name="help" />
      <Stack.Screen name="support" />
      <Stack.Screen name="feedback" />
      <Stack.Screen name="favorites" />
    </Stack>
  );
}

/** The session read can take a beat; this is what covers it. */
function BreathingMark() {
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

  const style = useAnimatedStyle(() => ({ transform: [{ scale: breathe.value }] }));

  return (
    <Animated.View style={[styles.mark, glow(COLORS.cyan, 26, 0.45), style]}>
      <Ionicons name="chatbubbles" size={30} color={COLORS.cyan} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  content: { backgroundColor: COLORS.background },
  center: { alignItems: "center", justifyContent: "center", gap: 18 },
  mark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(34,211,238,0.12)",
  },
  loadingLabel: { color: COLORS.muted, fontSize: 15, fontWeight: "800", letterSpacing: 0.4 },
});
