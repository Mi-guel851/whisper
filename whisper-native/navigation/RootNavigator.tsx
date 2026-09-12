import {
  NavigationContainer,
  createNavigationContainerRef,
  type Theme,
  type LinkingOptions,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Linking from "expo-linking";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { Background } from "@/components/Background";
import { LoadingScreen } from "@/components/Screen";
import { watchBadges, resetBadges } from "@/lib/badges";
import { handleNotificationResponse, registerForPushNotifications } from "@/lib/push";
import { useSession } from "@/lib/session";
import { COLORS } from "@/lib/theme";
import { AuthScreen } from "@/screens/AuthScreen";
import { ChatScreen } from "@/screens/ChatScreen";
import { CoinStoreScreen } from "@/screens/CoinStoreScreen";
import { CreateWhisperScreen } from "@/screens/CreateWhisperScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { SingleWhisperScreen } from "@/screens/SingleWhisperScreen";
import { SplashScreen } from "@/screens/SplashScreen";
import { UserProfileScreen } from "@/screens/UserProfileScreen";
import { MainTabs } from "./MainTabs";
import type { AuthStackParamList, MainStackParamList, RootStackParamList } from "./types";

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainStack = createNativeStackNavigator<MainStackParamList>();

/**
 * The container's ref.
 *
 * A notification tap is an instruction to navigate somewhere, and on a cold
 * start it arrives before any screen exists. A ref is the only way to address
 * the navigator from outside React's tree — which is what a push handler is.
 */
const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * The dark navigation theme.
 *
 * React Navigation paints the container's background itself, and its default
 * theme is white — which is a white flash between screens on a `#0a0814` app,
 * visible on every push. Setting it here is what makes "no white screens" true
 * at the framework level rather than in forty screens.
 */
const NAV_THEME: Theme = {
  dark: true,
  colors: {
    primary: COLORS.cyan,
    background: COLORS.background,
    card: COLORS.surface,
    text: COLORS.text,
    border: COLORS.border,
    notification: COLORS.purple,
  },
  fonts: {
    regular: { fontFamily: "System", fontWeight: "400" },
    medium: { fontFamily: "System", fontWeight: "500" },
    bold: { fontFamily: "System", fontWeight: "700" },
    heavy: { fontFamily: "System", fontWeight: "800" },
  },
};

/**
 * Deep links.
 *
 * The app answers the same URLs the website does, so a whisper link received on
 * a phone opens the app rather than a browser: `whisper://u/<username>` and the
 * Universal/App Link form of the same path. A notification tap is handled
 * separately by `handleNotificationResponse`, because it carries a message id
 * rather than a route.
 */
const LINKING: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL("/"), "https://whisper-anonymous.vercel.app"],
  config: {
    screens: {
      Main: {
        screens: {
          Tabs: {
            screens: {
              Feed: "public-feed",
              DMs: "inbox",
              Notifications: "notifications",
              Profile: "profile",
            },
          },
          Chat: "chat/:conversationId",
          SingleWhisper: "public-feed/post/:postId",
          CoinStore: "premium",
          Settings: "settings",
        },
      },
      Auth: {
        screens: { Auth: "login" },
      },
    },
  },
};

export function RootNavigator() {
  const { session, userId, loading } = useSession();

  /* Badges and push follow the session, not any one screen: a user who never
     opens the notifications tab still needs the tab bar to be honest, and a
     device token has to be registered on the session that owns it. */
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
     the app may be cold-started by it, in which case there is no screen mounted
     yet to receive the event.
     
     The intent is turned into a navigation call rather than pushed into the
     stack directly: the navigator can only be addressed once it has mounted, and
     a cold-start tap arrives before it has. `navigationRef` closes that gap. */
  useEffect(() => {
    return handleNotificationResponse((hint) => {
      const navigate = () => {
        const ref = navigationRef.current;
        if (!ref?.isReady()) return;

        if (hint.conversationId) {
          ref.navigate("Main", {
            screen: "Chat",
            params: { conversationId: hint.conversationId, otherId: "" },
          });
          return;
        }
        if (hint.postId) {
          ref.navigate("Main", { screen: "SingleWhisper", params: { postId: hint.postId } });
          return;
        }
        if (hint.route?.startsWith("/notifications")) {
          ref.navigate("Main", { screen: "Tabs", params: { screen: "Notifications" } });
        }
      };

      /* One frame of slack: on a cold start the container is ready by the time
         the async `getLastNotificationResponseAsync` resolves, but not always by
         the time the listener fires. */
      setTimeout(navigate, 260);
    });
  }, []);

  if (loading) {
    return (
      <View style={styles.root}>
        <Background />
        <LoadingScreen label="Whisper" />
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={NAV_THEME}
      linking={LINKING}
      fallback={<LoadingScreen label="Whisper" />}
    >
      {session ? (
        <MainStack.Navigator screenOptions={{ headerShown: false, contentStyle: styles.content }}>
          <MainStack.Screen name="Tabs" component={MainTabs} />

          <MainStack.Group
            screenOptions={{
              presentation: "modal",
              animation: "slide_from_bottom",
              contentStyle: styles.content,
            }}
          >
            <MainStack.Screen name="CreateWhisper" component={CreateWhisperScreen} />
            <MainStack.Screen name="Settings" component={SettingsScreen} />
            <MainStack.Screen name="CoinStore" component={CoinStoreScreen} />
          </MainStack.Group>

          <MainStack.Group screenOptions={{ animation: "slide_from_right", contentStyle: styles.content }}>
            <MainStack.Screen name="SingleWhisper" component={SingleWhisperScreen} />
            <MainStack.Screen name="Chat" component={ChatScreen} />
            <MainStack.Screen name="UserProfile" component={UserProfileScreen} />
          </MainStack.Group>
        </MainStack.Navigator>
      ) : (
        <AuthStack.Navigator screenOptions={{ headerShown: false, contentStyle: styles.content }}>
          <AuthStack.Screen name="Splash" component={SplashScreen} />
          <AuthStack.Screen name="Auth" component={AuthScreen} />
        </AuthStack.Navigator>
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  content: { backgroundColor: COLORS.background },
});
