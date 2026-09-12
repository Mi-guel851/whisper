import { BlurView } from "expo-blur";
import { withLayoutContext } from "expo-router";
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
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from "@react-navigation/bottom-tabs";

import { TabIcon } from "@/components/TabIcon";
import { useBadges } from "@/lib/badges";
import { vibrate } from "@/lib/haptics";
import { COLORS, GLASS, GRADIENT_COLORS, NAV, RADIUS, useStyles } from "@/lib/theme";

/**
 * The tab bar.
 *
 * The web app's `BottomNavigation`, translated to native: a floating glass bar,
 * four destinations, the active one carrying the brand gradient. The navigator
 * is created here and wrapped with `withLayoutContext` so the file-system
 * routes in this folder become its screens — `feed`, `dms`, `notifications`
 * and `profile` are files, and this is the thing that gives them a bar.
 *
 * The bar floats over the content instead of displacing it, so a list can
 * scroll under the glass the way it does on the site. Every tab screen adds
 * `TAB_BAR_SPACE` at the bottom of its list for exactly this reason.
 */
const { Navigator } = createBottomTabNavigator();

const BottomTabs = withLayoutContext(Navigator);

export default function TabsLayout() {
  return (
    <BottomTabs screenOptions={{ headerShown: false }} tabBar={(props) => <GlassTabBar {...props} />} />
  );
}

const ITEMS = [
  { name: "feed", label: "Feed" },
  { name: "dms", label: "DMs" },
  { name: "notifications", label: "Alerts" },
  { name: "profile", label: "Profile" },
] as const;

function GlassTabBar({ state, navigation }: BottomTabBarProps) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const badges = useBadges();

  const countFor = (name: string) => {
    if (name === "dms") return badges.unreadMessages;
    if (name === "notifications") return badges.unreadWhispers + badges.unreadAlerts;
    return 0;
  };

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <BlurView intensity={GLASS.blurIntensity} tint={GLASS.tint} style={styles.bar}>
        {state.routes.map((route, index) => {
          const item = ITEMS.find((candidate) => candidate.name === route.name);
          if (!item) return null;

          const focused = state.index === index;

          return (
            <TabButton
              key={route.key}
              name={item.name}
              label={item.label}
              focused={focused}
              badge={countFor(item.name)}
              onPress={() => {
                vibrate("tap");
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name, route.params);
                }
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
  const styles = useStyles(makeStyles);
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
            <TabIcon name={name === "feed" ? "Feed" : name === "dms" ? "DMs" : name === "notifications" ? "Notifications" : "Profile"} focused={focused} />
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

const makeStyles = () => StyleSheet.create({
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
    backgroundColor: NAV.gloss,
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
  badgeText: { color: COLORS.text, fontSize: 9.5, fontWeight: "900" },
  label: { fontSize: 10.5, fontWeight: "700" },
});
