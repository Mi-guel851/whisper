import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { GlassCard } from "@/components/GlassCard";
import { COIN_PACKAGES, fetchWallet } from "@/lib/coins";
import { describeOutcome, useCoinPurchase } from "@/lib/paystack";
import { useSession } from "@/lib/session";
import { COLORS, GLASS, GRADIENT_COLORS, RADIUS } from "@/lib/theme";
import { useToast } from "@/lib/toast";
import type { Wallet } from "@/lib/types";
import { formatNaira } from "@/lib/format";

/**
 * Coin Store.
 *
 * Coin packages as glass cards with a gradient Buy button. Uses
 * react-native-paystack-webview. On success, POSTs to /api/paystack/verify
 * to credit coins.
 */
export default function CoinsScreen() {
  const { userId } = useSession();
  const { showToast } = useToast();
  const { purchase, busyCoins, ready, unavailableReason } = useCoinPurchase();
  const [wallet, setWallet] = useState<Wallet | null>(null);

  const loadWallet = async () => {
    if (!userId) return;
    const w = await fetchWallet(userId);
    setWallet(w);
  };

  useEffect(() => {
    loadWallet();
  }, [userId]);

  const handleBuy = async (pkg: (typeof COIN_PACKAGES)[number]) => {
    if (!ready) {
      showToast(unavailableReason || "Payments aren't available.", { variant: "error" });
      return;
    }
    const outcome = await purchase(pkg);
    const { message, tone } = describeOutcome(outcome, pkg.coins);
    showToast(message, { variant: tone as any });
    if (outcome.kind === "cancelled") {
      showToast("Payment cancelled", { variant: "info" });
    }
    await loadWallet();
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Coin Store</Text>
          <View style={{ width: 40 }} />
        </View>

        <Animated.View entering={FadeIn.duration(300)}>
          <LinearGradient
            colors={GRADIENT_COLORS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.balanceCard}
          >
            <Text style={styles.balanceLabel}>Your Balance</Text>
            <View style={styles.balanceRow}>
              <Ionicons name="logo-bitcoin" size={36} color="#0a0814" />
              <Text style={styles.balanceAmount}>{wallet?.balance?.toLocaleString() ?? "—"}</Text>
            </View>
            <Text style={styles.balanceSub}>coins</Text>
          </LinearGradient>
        </Animated.View>

        {!ready && (
          <View style={styles.warningBox}>
            <Ionicons name="alert-circle-outline" size={18} color={COLORS.warning} />
            <Text style={styles.warningText}>{unavailableReason}</Text>
          </View>
        )}

        <View style={styles.packagesWrap}>
          {COIN_PACKAGES.map((pkg, idx) => (
            <Animated.View key={pkg.coins} entering={FadeIn.delay(idx * 80).duration(300)}>
              <GlassCard
                radius={RADIUS.xl}
                strong={pkg.popular}
                style={[styles.pkgCard, pkg.popular && styles.popularCard]}
              >
                {pkg.popular && (
                  <View style={styles.popularTag}>
                    <Text style={styles.popularTagText}>MOST POPULAR</Text>
                  </View>
                )}
                <View style={styles.pkgTop}>
                  <Ionicons name="logo-bitcoin" size={28} color={COLORS.cyan} />
                  <Text style={styles.pkgCoins}>{pkg.coins}</Text>
                  <Text style={styles.pkgLabel}>{pkg.label}</Text>
                </View>
                <Text style={styles.pkgPrice}>{formatNaira(pkg.ngnAmount)}</Text>
                <Pressable
                  onPress={() => handleBuy(pkg)}
                  disabled={busyCoins === pkg.coins}
                >
                  <LinearGradient
                    colors={busyCoins === pkg.coins ? ["rgba(255,255,255,0.1)", "rgba(255,255,255,0.1)"] : GRADIENT_COLORS}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.buyBtn}
                  >
                    <Text style={styles.buyBtnText}>
                      {busyCoins === pkg.coins ? "Processing..." : "Buy"}
                    </Text>
                  </LinearGradient>
                </Pressable>
              </GlassCard>
            </Animated.View>
          ))}
        </View>

        <Text style={styles.disclaimer}>
          Payments processed securely via Paystack. Coins are added instantly when payment confirms.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingTop: 50,
    paddingBottom: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
  balanceCard: {
    margin: 16,
    borderRadius: RADIUS.xxl,
    padding: 22,
    alignItems: "center",
  },
  balanceLabel: { color: "rgba(10,8,20,0.7)", fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  balanceRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  balanceAmount: { color: "#0a0814", fontSize: 38, fontWeight: "900" },
  balanceSub: { color: "rgba(10,8,20,0.6)", fontSize: 11, fontWeight: "800", letterSpacing: 1, marginTop: 2 },
  warningBox: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.3)",
    backgroundColor: "rgba(245,158,11,0.08)",
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  warningText: { color: COLORS.warning, fontSize: 12, flex: 1 },
  packagesWrap: { padding: 16, gap: 12 },
  pkgCard: { padding: 18, position: "relative" },
  popularCard: { borderColor: "rgba(34,211,238,0.35)" },
  popularTag: {
    position: "absolute",
    top: 10,
    right: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.cyan,
  },
  popularTagText: { color: "#0a0814", fontSize: 9, fontWeight: "900", letterSpacing: 0.6 },
  pkgTop: { alignItems: "center", gap: 4 },
  pkgCoins: { color: COLORS.text, fontSize: 30, fontWeight: "900" },
  pkgLabel: { color: COLORS.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  pkgPrice: { color: COLORS.text, fontSize: 20, fontWeight: "900", textAlign: "center", marginVertical: 12 },
  buyBtn: {
    borderRadius: RADIUS.pill,
    paddingVertical: 12,
    alignItems: "center",
  },
  buyBtnText: { color: "#0a0814", fontSize: 14, fontWeight: "900" },
  disclaimer: { color: COLORS.subtle, fontSize: 11, textAlign: "center", paddingHorizontal: 32, marginTop: 8 },
});
