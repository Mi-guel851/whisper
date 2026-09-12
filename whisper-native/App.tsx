import "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { PaystackProvider } from "react-native-paystack-webview";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { RootNavigator } from "@/navigation/RootNavigator";
import { SessionProvider } from "@/lib/session";
import { ToastProvider } from "@/lib/toast";
import { COLORS } from "@/lib/theme";

/**
 * The app.
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
 * The Paystack provider is given the public key from the environment. With no
 * key the store still renders and says so, rather than crashing at import time
 * — a missing build variable should be a visible configuration problem, not a
 * white screen.
 */
export default function App() {
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
                <RootNavigator />
              </PaystackProvider>
            </ToastProvider>
          </SessionProvider>
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
});
