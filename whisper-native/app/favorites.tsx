import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Screen } from "@/components/Screen";
import { CARD_SHADOW, COLORS, GLASS, RADIUS } from "@/lib/theme";

/**
 * Favorites — the native twin of the web app's `/favorites`, which is a
 * "Coming Soon" page. That is the parity, deliberately: the saved-posts
 * feature already exists (the `saved` route), and a favorites surface that
 * invented its own storage would be a second, worse version of it. When the
 * web ships favorites, this screen ships with it — the page title and the
 * promise are the whole contract for now.
 */
export default function Favorites() {
  const router = useRouter();

  return (
    <Screen edges={["top", "left", "right"]}>
      <View style={styles.wrap}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </Pressable>

        <View style={styles.card}>
          <View style={styles.mark}>
            <Ionicons name="heart-outline" size={30} color={COLORS.pink} />
          </View>
          <Text style={styles.title}>Favorites Coming Soon</Text>
          <Text style={styles.body}>
            Whisper is working on a place for the whispers you want to keep close. Saved posts
            already live on their own tab — favorites will sit beside them.
          </Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  back: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    marginLeft: -8,
    marginBottom: 10,
    backgroundColor: "rgba(23,18,42,0.55)",
    borderWidth: 1,
    borderColor: GLASS.border,
  },

  card: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 26,
    borderRadius: RADIUS.xl,
    backgroundColor: GLASS.background,
    borderWidth: 1,
    borderColor: GLASS.border,
    ...CARD_SHADOW,
  },
  mark: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(236,72,153,0.13)",
    borderWidth: 1,
    borderColor: "rgba(236,72,153,0.3)",
  },
  title: { color: COLORS.text, fontSize: 21, fontWeight: "900", textAlign: "center" },
  body: {
    color: COLORS.muted,
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 300,
  },
});
