import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { COLORS, GLASS, GRADIENT_COLORS, RADIUS } from "@/lib/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * The dark glass tab bar.
 *
 * Cyan when active, white/60 when inactive, and the whole bar sits on a BlurView
 * with a subtle top border — exactly the treatment the brief asks for.
 */
function TabBar({ state, descriptors, navigation }: any) {
  const insets = useSafeAreaInsets();

  return (
    <View pointerEvents="box-none" style={[styles.tabBarWrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <BlurView intensity={50} tint="dark" style={styles.blur}>
        <View style={styles.inner}>
          {state.routes.map((route: any, index: number) => {
            const { options } = descriptors[route.key];
            const isFocused = state.index === index;

            const iconName =
              route.name === "feed"
                ? isFocused
                  ? "home"
                  : "home-outline"
                : route.name === "dms"
                  ? isFocused
                    ? "chatbubble-ellipses"
                    : "chatbubble-ellipses-outline"
                  : route.name === "notifications"
                    ? isFocused
                      ? "notifications"
                      : "notifications-outline"
                    : route.name === "profile"
                      ? isFocused
                        ? "person"
                        : "person-outline"
                      : "ellipse";

            const onPress = () => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            return (
              <View key={route.key} style={styles.tabBtnWrap}>
                {isFocused ? (
                  <LinearGradient
                    colors={GRADIENT_COLORS}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.iconPill}
                  >
                    <Ionicons name={iconName as any} size={22} color="#0a0814" />
                  </LinearGradient>
                ) : (
                  <View style={styles.iconPlain}>
                    <Ionicons name={iconName as any} size={22} color="rgba(255,255,255,0.72)" />
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: { display: "none" },
      }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen name="feed" />
      <Tabs.Screen name="dms" />
      <Tabs.Screen name="notifications" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
  },
  blur: {
    borderRadius: RADIUS.xxxl,
    backgroundColor: "rgba(15,12,28,0.72)",
    borderWidth: 1,
    borderColor: GLASS.border,
    overflow: "hidden",
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingVertical: 10,
  },
  tabBtnWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconPill: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  iconPlain: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});
