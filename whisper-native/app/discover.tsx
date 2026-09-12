import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Screen } from "@/components/Screen";
import { useToast } from "@/lib/toast";
import { CARD_SHADOW, COLORS, GLASS, RADIUS, TAB_BAR_SPACE } from "@/lib/theme";

type FeatureCard = {
  href: string;
  label: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  delay: number;
};

type UtilityCard = {
  href: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  delay: number;
};

/* The launcher grid, the web app's `/discover` card for card: the two
   feature surfaces people come for, then the utility and policy pages under
   one roof. Each entry pushes a real native route — nothing here shells out
   to a web view. */
const FEATURE_CARDS: FeatureCard[] = [
  {
    href: "/friends?tab=friends",
    label: "Friends",
    desc: "Connect, chat and discover new people.",
    icon: "people-outline",
    delay: 0,
  },
  {
    href: "/games",
    label: "Whisper Games",
    desc: "Play, have fun and win rewards.",
    icon: "game-controller-outline",
    delay: 60,
  },
];

const UTILITY_CARDS: UtilityCard[] = [
  { href: "/feedback", label: "Feedback", icon: "chatbubble-ellipses-outline", delay: 30 },
  { href: "/support", label: "Contact Support", icon: "headset-outline", delay: 90 },
  { href: "/help", label: "Help Center", icon: "help-circle-outline", delay: 120 },
  { href: "/legal?slug=guidelines", label: "Community Guidelines", icon: "shield-checkmark-outline", delay: 150 },
  { href: "/legal?slug=privacy", label: "Privacy Policy", icon: "lock-closed-outline", delay: 180 },
  { href: "/legal?slug=terms", label: "Terms of Service", icon: "document-text-outline", delay: 210 },
];

/**
 * Discover — the native port of the web app's `/discover` hub.
 *
 * One screen that answers "what else does Whisper do?": the two feature
 * surfaces at the top at full width, then every utility and policy page as a
 * compact row. Everything is a route push; the hub holds no data of its own,
 * which is why it can render instantly on any device.
 */
export default function Discover() {
  const { showToast } = useToast();

  function open(href: string) {
    const [pathname, query] = href.split("?");
    const params: Record<string, string> = {};
    for (const pair of new URLSearchParams(query || "")) {
      params[pair[0]] = pair[1];
    }
    /* Unknown routes fail loud in dev and silent in production; a toast keeps
       both honest rather than a tap that does nothing. */
    try {
      router.push({ pathname: pathname as never, params });
    } catch {
      showToast("That screen isn't available.", { variant: "warning" });
    }
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: TAB_BAR_SPACE + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Discover</Text>
          <Text style={styles.subtitle}>Everything Whisper can do, one tap away.</Text>
        </View>

        <View style={styles.features}>
          {FEATURE_CARDS.map((card) => (
            <Animated.View key={card.label} entering={FadeInDown.delay(card.delay).springify().damping(16)} style={styles.featureWrap}>
              <Pressable
                accessibilityRole="button"
                onPress={() => open(card.href)}
                style={({ pressed }) => [styles.featureCard, pressed && styles.pressed]}
              >
                <LinearGradient
                  colors={["rgba(34,211,238,0.16)", "rgba(168,85,247,0.16)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.featureIcon}
                >
                  <Ionicons name={card.icon} size={24} color={COLORS.cyan} />
                </LinearGradient>
                <View style={styles.featureText}>
                  <Text style={styles.featureLabel}>{card.label}</Text>
                  <Text style={styles.featureDesc}>{card.desc}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={COLORS.subtle} />
              </Pressable>
            </Animated.View>
          ))}
        </View>

        <View style={styles.utility}>
          {UTILITY_CARDS.map((card) => (
            <Animated.View key={card.label} entering={FadeInDown.delay(card.delay).springify().damping(16)}>
              <Pressable
                accessibilityRole="button"
                onPress={() => open(card.href)}
                style={({ pressed }) => [styles.utilityRow, pressed && styles.pressed]}
              >
                <View style={styles.utilityIcon}>
                  <Ionicons name={card.icon} size={17} color={COLORS.purple} />
                </View>
                <Text style={styles.utilityLabel}>{card.label}</Text>
                <Ionicons name="chevron-forward" size={15} color={COLORS.subtle} />
              </Pressable>
            </Animated.View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 18, gap: 16 },

  header: { gap: 3 },
  title: { color: COLORS.text, fontSize: 24, fontWeight: "900" },
  subtitle: { color: COLORS.muted, fontSize: 13.5, fontWeight: "600" },

  features: { gap: 10 },
  featureWrap: { flex: 1 },
  featureCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    padding: 15,
    borderRadius: RADIUS.xl,
    backgroundColor: GLASS.background,
    borderWidth: 1,
    borderColor: GLASS.border,
    ...CARD_SHADOW,
  },
  featureIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { flex: 1, gap: 2 },
  featureLabel: { color: COLORS.text, fontSize: 15.5, fontWeight: "900" },
  featureDesc: { color: COLORS.muted, fontSize: 12.5, lineHeight: 17 },

  utility: {
    borderRadius: RADIUS.xl,
    backgroundColor: GLASS.background,
    borderWidth: 1,
    borderColor: GLASS.border,
    overflow: "hidden",
    ...CARD_SHADOW,
  },
  utilityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  utilityIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(139,92,246,0.14)",
  },
  utilityLabel: { flex: 1, color: COLORS.text, fontSize: 13.5, fontWeight: "800" },

  pressed: { transform: [{ scale: 0.985 }], opacity: 0.9 },
});
