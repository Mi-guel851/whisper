/**
 * Navigation shape.
 *
 * Two stacks and a tab bar, which is the structure the brief asks for and the
 * one the web app's own information architecture implies:
 *
 *   RootNavigator
 *   ├── AuthStack        Splash → Auth (login / signup in one screen)
 *   └── MainStack        the tab bar, plus everything that opens *over* it
 *       ├── BottomTabs   Feed · DMs · Notifications · Profile
 *       └── modals       CreateWhisper · SingleWhisper · Chat · Settings · CoinStore
 *
 * Everything is typed, so a screen that navigates with the wrong parameter is a
 * compile error rather than a crash on a cold path nobody tests.
 */

import type { NavigatorScreenParams } from "@react-navigation/native";

export type AuthStackParamList = {
  Splash: undefined;
  Auth: { mode?: "login" | "signup" } | undefined;
};

export type TabParamList = {
  Feed: undefined;
  DMs: undefined;
  Notifications: undefined;
  Profile: undefined;
};

export type MainStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;

  /** Compose a post or a reply for the public feed. */
  CreateWhisper: { parentPostId?: string; parentAuthorId?: string } | undefined;
  /** One post with its thread and a comment composer. */
  SingleWhisper: { postId: string };
  /** One conversation. */
  Chat: { conversationId: string; otherId: string };
  Settings: undefined;
  CoinStore: undefined;
  /** Reading another user's profile from a post or a conversation. */
  UserProfile: { userId: string };
};

/**
 * The root has no destinations of its own: it decides between the two stacks.
 * It is declared anyway so `useNavigation<RootStackParamList>()` types the
 * handful of places that navigate across the auth boundary (a sign-out landing
 * on Auth, a deep link landing on Chat).
 */
export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainStackParamList>;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface RootParamList extends RootStackParamList {}
  }
}
