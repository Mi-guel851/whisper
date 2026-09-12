import "react-native-gesture-handler";
import "../global.css";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { PaystackProvider } from "react-native-paystack-webview";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionProvider, useSession } from "@/lib/session";
import { ToastProvider } from "@/lib/toast";
import { startSupabaseAutoRefresh } from "@/lib/supabase";
import { COLORS } from "@/lib/theme";

/**
 * Route guard.
 *
 * Watches the current segment and the session, and replaces to either the
 * login screen or the tabs feed. The guard lives here (not in each screen)
 * because navigation decisions that depend on auth state should not be spread
 * across files — the route is a single fact.
 */
function InitialRoute() {
  const { session, loading } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const firstGroup = segments[0];
    const inAuthGroup = firstGroup === "(auth)";
    // Public unauthed routes (onboarding, forgot-password is not auth-group so handled separately)
    const inPublicNoAuth = firstGroup === undefined;

    if (!session) {
      // Allow onboarding, forgot-password (non-group), and login/signup
      if (inAuthGroup || firstGroup === "forgot-password" || inPublicNoAuth) return;
      router.replace("/(auth)/onboarding");
    } else {
      // If in an auth-only screen, bounce to feed
      if (inAuthGroup) {
        router.replace("/(tabs)/feed");
      }
    }
  }, [session, loading, segments, router]);

  return null;
}

function AuthNavigation() {
  useEffect(() => {
    const stop = startSupabaseAutoRefresh();
    return stop;
  }, []);

  return (
    <>
      <InitialRoute />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: COLORS.background },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="coins" options={{ headerShown: false, presentation: "card" }} />
        <Stack.Screen name="create-whisper" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="conversation" options={{ headerShown: false }} />
        <Stack.Screen name="whisper-detail" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const paystackKey = process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY || "";

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: COLORS.background }}>
          <StatusBar style="light" />
          <SessionProvider>
            <ToastProvider>
              <PaystackProvider publicKey={paystackKey} currency="NGN">
                <AuthNavigation />
              </PaystackProvider>
            </ToastProvider>
          </SessionProvider>
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
