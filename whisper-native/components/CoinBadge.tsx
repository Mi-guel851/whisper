import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text } from "react-native";

import { formatCoins } from "@/lib/format";
import { COLORS, GRADIENT_COLORS, RADIUS, glow, useStyles } from "@/lib/theme";

/**
 * The coin balance.
 *
 * `prominent` is the profile/settings variant — the gradient pill the brief asks
 * for, with the balance in the display size. `compact` is the one that rides in
 * the coin store's header and on the wallet card: same colours, less height.
 *
 * Both are tappable when given an `onPress`, and both open the coin store, which
 * is where a balance is meant to lead. A balance you cannot act on is a number.
 */
export function CoinBadge({
  balance,
  onPress,
  variant = "compact",
  loading = false,
}: {
  balance: number | null;
  onPress?: () => void;
  variant?: "compact" | "prominent";
  loading?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const prominent = variant === "prominent";
  const label = loading ? "—" : formatCoins(balance ?? 0);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={`${label} Whisper Coins${onPress ? ", open the coin store" : ""}`}
    >
      <LinearGradient
        colors={GRADIENT_COLORS}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[
          styles.gradient,
          prominent ? styles.prominent : styles.compact,
          glow(COLORS.cyan, prominent ? 18 : 12, 0.32),
        ]}
      >
        <Ionicons name="logo-bitcoin" size={prominent ? 22 : 15} color={COLORS.contrast} />
        <Text style={[styles.amount, prominent && styles.amountProminent]}>{label}</Text>
        <Text style={[styles.unit, prominent && styles.unitProminent]}>COINS</Text>
      </LinearGradient>
    </Pressable>
  );
}

const makeStyles = () => StyleSheet.create({
  gradient: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: RADIUS.pill,
  },
  compact: { paddingHorizontal: 12, paddingVertical: 7 },
  prominent: { paddingHorizontal: 20, paddingVertical: 12, alignSelf: "flex-start" },
  amount: { color: COLORS.contrast, fontSize: 15, fontWeight: "900" },
  amountProminent: { fontSize: 26 },
  unit: { color: "rgba(10,8,20,0.75)", fontSize: 9.5, fontWeight: "900", letterSpacing: 0.8 },
  unitProminent: { fontSize: 11 },
});
