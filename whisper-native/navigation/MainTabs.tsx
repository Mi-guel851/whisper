import { BlurView } from "expo-blur";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TabIcon } from "@/components/TabIcon";
import { useBadges } from "@/lib/badges";
import { vibrate } from "@/lib/haptics";
import { COLORS, GLASS, GRADIENT_COLORS, RADIUS } from "@/lib/theme";
import { ConversationsScreen } from "@/screens/ConversationsScreen";
import { FeedScreen } from "@/screens/FeedScreen";
import { NotificationsScreen } from "@/screens/NotificationsScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import type { TabParamList } from "./types";

const Tab = createBottomTabNavigator<TabParamList>();

/**
 * The tab bar.
 *
 * The web app's `BottomNavigation`, translated to native: a floating glass bar,
 * four destinations, the active one carrying the brand gradient. The bar is
 * rendered by a custom `tabBar` rather than by styling the default one, because
 * the default cannot express an active *pill with a gradient* — and that pill is
 * what makes the current tab unambiguous on a dark screen.
 *
 * The bar floats over the content instead of displacing it, so a list can scroll
 * under the glass the way it does on the site. Every screen that contains a list
 * adds bottom padding for it (see `TAB_BAR_SPACE`).
 */
export function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <GlassTabBar {...props} />}>
      <Tab.Screen name="Feed" component={FeedScreen} />
      <Tab.Screen name="DMs" component={ConversationsScreen} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

/** Room to leave at the bottom of a scroll view so the bar never covers the last row. */
export const TAB_BAR_SPACE = 96;

type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tab.Navigator>["tabBar"]>>[0];

const ITEMS = [
  { name: "Feed" as const, label: "Feed" },
  { name: "DMs" as const, label: "DMs" },
  { name: "Notifications" as const, label: "Alerts" },
  { name: "Profile" as const, label: "Profile" },
];

function GlassTabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const badges = useBadges();

  const countFor = (name: (typeof ITEMS)[number]["name"]) => {
    if (name === "DMs") return badges.unreadMessages;
    if (name === "Notifications") return badges.unreadWhispers + badges.unreadAlerts;
    return 0;
  };

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <BlurView intensity={GLASS.blurIntensity} tint="dark" style={styles.bar}>
        {ITEMS.map((item) => {
          const index = state.routes.findIndex((route) => route.name === item.name);
          const focused = state.index === index;
          if (index === -1) return null;

          return (
            <TabButton
              key={item.name}
              name={item.name}
              label={item.label}
              focused={focused}
              badge={countFor(item.name)}
              onPress={() => {
                vibrate("tap");
                const event = navigation.emit({
                  type: "tabPress",
                  target: state.routes[index].key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) navigation.navigate(item.name);
              }}
            />
          );
        })}
      </BlurView>
    </View>
  );
}

function TabButton({
  name,
  label,
  focused,
  badge,
  onPress,
}: {
  name: (typeof ITEMS)[number]["name"];
  label: string;
  focused: boolean;
  badge: number;
  onPress: () => void;
}) {
  const progress = useSharedValue(focused ? 1 : 0);
  const scale = useSharedValue(1);

  React.useEffect(() => {
    progress.value = withTiming(focused ? 1 : 0, { duration: 200, easing: Easing.out(Easing.cubic) });
  }, [focused, progress]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.88 + progress.value * 0.12 }],
  }));

  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + progress.value * 0.05 }] }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPressIn={() => {
        scale.value = withSpring(0.94, { damping: 16, stiffness: 300 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 14, stiffness: 240 });
      }}
      onPress={onPress}
      style={styles.tab}
    >
      <Animated.View style={[styles.tabInner, { transform: [{ scale: scale.value }] }]}>
        <View style={styles.iconWrap}>
          <Animated.View style={[styles.pill, pillStyle]}>
            <LinearGradient
              colors={GRADIENT_COLORS}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.pillGradient}
            />
          </Animated.View>

          <Animated.View style={iconStyle}>
            <TabIcon name={name} focused={focused} />
          </Animated.View>

          {badge > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge > 9 ? "9+" : badge}</Text>
            </View>
          )}
        </View>

        <Text style={[styles.label, { color: focused ? COLORS.text : COLORS.muted }]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: RADIUS.xxl,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(10,8,20,0.72)",
    paddingHorizontal: 8,
    paddingVertical: 8,
    overflow: "hidden",
  },
  tab: { flex: 1, alignItems: "center" },
  tabInner: { alignItems: "center", gap: 3 },
  iconWrap: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  pill: { ...StyleSheet.absoluteFillObject, borderRadius: 16, overflow: "hidden" },
  pillGradient: { flex: 1, borderRadius: 16 },
  badge: {
    position: "absolute",
    top: -1,
    right: -3,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: COLORS.rose,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: COLORS.background,
  },
  badgeText: { color: "#fff", fontSize: 9.5, fontWeight: "900" },
  label: { fontSize: 10.5, fontWeight: "700" },
});
