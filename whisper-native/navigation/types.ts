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
  /**
   * One conversation.
   *
   * `otherId` is optional because not every entry point knows it: the inbox
   * does, a notification tap and a deep link do not. The screen derives the
   * other participant from the conversation row once it has loaded.
   */
  Chat: { conversationId: string; otherId?: string };
  Saved: undefined;
  Settings: undefined;
  CoinStore: undefined;
  /** Reading another user's profile from a post or a conversation. */
  UserProfile: { userId: string };
};

/**
 * The root's flat view of the app.
 *
 * The container renders one of the two stacks depending on the session, which
 * means there is no single nested tree to describe — the reachable screen names
 * are simply the union of both stacks. That is what this type is: the names a
 * deep link or a notification tap can address, and the shape the navigation ref
 * and the linking config are typed against.
 */
export type RootStackParamList = AuthStackParamList & MainStackParamList;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface RootParamList extends RootStackParamList {}
  }
}
