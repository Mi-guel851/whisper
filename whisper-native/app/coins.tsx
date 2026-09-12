import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { CoinBadge } from "@/components/CoinBadge";
import { GradientButton } from "@/components/GradientButton";
import { Screen } from "@/components/Screen";
import { ConfirmSheet } from "@/components/Sheet";
import { CoinTipSheet } from "@/components/CoinTipSheet";
import {
  COIN_PACKAGES,
  FEED_POST_COST,
  HINT_UNLOCK_COST,
  SEND_IMAGE_COST,
  SEND_VOICE_COST,
  UNLOCK_CHAT_COST,
  fetchTransactions,
  fetchWallet,
  type CoinPackage,
} from "@/lib/coins";
import { formatCoins, formatNaira, timeAgo } from "@/lib/format";
import { vibrate } from "@/lib/haptics";
import { describeOutcome, useCoinPurchase } from "@/lib/paystack";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { COLORS, GLASS, GRADIENT_COLORS, RADIUS, glow } from "@/lib/theme";
import type { CoinTransaction, Wallet } from "@/lib/types";

/**
 * The coin store.
 *
 * Four packages, NGN prices, and a Paystack checkout that opens in a web view.
 * The purchase is a three-step handshake and the app only does steps one and
 * three:
 *
 *   1. The popup charges the card. Its `onSuccess` fires when Paystack's modal
 *      closes happily — *not* when the money has settled.
 *   2. `/api/paystack/verify` re-checks the reference against Paystack's API and
 *      credits through `credit_verified_payment`, which is idempotent on the
 *      reference, so a retry cannot double-credit.
 *   3. The balance is re-read from the server. The client never adds coins to a
 *      number it holds.
 *
 * The amount is in kobo — NGN × 100 — because that is what Paystack's API takes.
 * Getting that wrong by a factor of 100 is the classic version of this bug, so
 * the conversion lives in one place (`chargeFor`) rather than at the call site.
 */
export default function Coins() {
  const { userId } = useSession();
  const { showToast } = useToast();
  const { purchase, ready, unavailableReason } = useCoinPurchase();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [selected, setSelected] = useState<CoinPackage | null>(null);
  const [buying, setBuying] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [cancelNotice, setCancelNotice] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    const [row, history] = await Promise.all([fetchWallet(userId), fetchTransactions(userId, 20)]);
    setWallet(row);
    setTransactions(history);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const buy = useCallback(
    async (pkg: CoinPackage) => {
      if (!userId || buying) return;

      if (!ready) {
        showToast(unavailableReason ?? "Payments aren't configured yet.", { variant: "warning" });
        return;
      }

      setBuying(true);
      setSelected(pkg);

      const outcome = await purchase(pkg);
      setBuying(false);
      setSelected(null);

      if (outcome.kind === "credited") {
        vibrate("success");
        showToast(`Added ${formatCoins(pkg.coins)} coins`, { variant: "success" });
        await load();
        return;
      }

      if (outcome.kind === "cancelled") {
        setCancelNotice(true);
        return;
      }

      const described = describeOutcome(outcome, pkg.coins);
      showToast(described.message, { variant: described.tone === "error" ? "error" : "subtle" });
    },
    [buying, load, purchase, ready, showToast, unavailableReason, userId]
  );

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Coin Store</Text>
        <CoinBadge balance={wallet?.balance ?? null} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <BlurView intensity={GLASS.blurIntensity} tint="dark" style={[styles.hero, glow(COLORS.purple, 24, 0.35)]}>
          <View style={styles.heroInner}>
            <Text style={styles.heroTitle}>Whisper Coins</Text>
            <Text style={styles.heroBody}>
              Coins unlock chats, send photos and voice notes, buy sender hints, and post to the feed.
              They also move between people — send some to a friend&apos;s Whispers address.
            </Text>

            <View style={styles.priceRow}>
              {[
                { label: "Chat unlock", value: UNLOCK_CHAT_COST },
                { label: "Photo", value: SEND_IMAGE_COST },
                { label: "Voice note", value: SEND_VOICE_COST },
                { label: "Hint", value: HINT_UNLOCK_COST },
                { label: "Post", value: FEED_POST_COST },
              ].map((item) => (
                <View key={item.label} style={styles.priceChip}>
                  <Text style={styles.priceValue}>{item.value}</Text>
                  <Text style={styles.priceLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </BlurView>

        {!ready && (
          <View style={styles.warning}>
            <Ionicons name="warning-outline" size={16} color={COLORS.warning} />
            <Text style={styles.warningText}>
              {unavailableReason ?? "Payments need EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY before they can open."}
            </Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Packages</Text>

        {COIN_PACKAGES.map((pkg) => (
          <PackageCard key={pkg.coins} pkg={pkg} busy={buying && selected?.coins === pkg.coins} onBuy={() => void buy(pkg)} />
        ))}

        <GradientButton
          label="Send coins instead"
          icon="paper-plane-outline"
          variant="glass"
          fullWidth
          onPress={() => setTipOpen(true)}
          style={styles.sendButton}
        />

        <Text style={styles.sectionTitle}>Recent activity</Text>

        {transactions.length === 0 ? (
          <View style={styles.emptyHistory}>
            <Ionicons name="receipt-outline" size={20} color={COLORS.subtle} />
            <Text style={styles.emptyHistoryText}>No transactions yet.</Text>
          </View>
        ) : (
          transactions.map((row) => <TransactionRow key={row.id} row={row} />)
        )}

        <Text style={styles.footer}>
          Purchases are processed by Paystack. Coins are credited by the server after the payment is
          verified, never by the app.
        </Text>
      </ScrollView>

      <CoinTipSheet
        visible={tipOpen}
        onClose={() => setTipOpen(false)}
        balance={wallet?.balance ?? null}
        onDone={(next) => {
          if (typeof next === "number") setWallet((current) => (current ? { ...current, balance: next } : current));
          void load();
        }}
      />

      <ConfirmSheet
        visible={cancelNotice}
        title="Payment cancelled"
        message="Nothing was charged. You can try again whenever you like."
        confirmLabel="Close"
        onConfirm={() => {
          setCancelNotice(false);
          showToast("No coins were added", { variant: "subtle" });
        }}
        onCancel={() => setCancelNotice(false)}
      />
    </Screen>
  );
}

/* ---------------------------------------------------------------------------
 * Pieces
 * ------------------------------------------------------------------------ */

function PackageCard({
  pkg,
  busy,
  onBuy,
}: {
  pkg: CoinPackage;
  busy: boolean;
  onBuy: () => void;
}) {
  const press = useSharedValue(1);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  return (
    <Animated.View style={style}>
      <Pressable
        onPressIn={() => {
          press.value = withTiming(0.985, { duration: 90, easing: Easing.out(Easing.quad) });
        }}
        onPressOut={() => {
          press.value = withTiming(1, { duration: 140, easing: Easing.out(Easing.cubic) });
        }}
        accessibilityLabel={`${pkg.coins} coins for ${formatNaira(pkg.ngnAmount)}`}
      >
        <BlurView
          intensity={GLASS.blurIntensity}
          tint="dark"
          style={[styles.package, pkg.popular && styles.packagePopular]}
        >
          <View style={styles.packageInner}>
            <LinearGradient
              colors={pkg.popular ? GRADIENT_COLORS : ["rgba(34,211,238,0.18)", "rgba(168,85,247,0.18)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.packageIcon}
            >
              <Ionicons name="logo-bitcoin" size={20} color={pkg.popular ? "#0a0814" : COLORS.text} />
            </LinearGradient>

            <View style={styles.packageText}>
              <View style={styles.packageTop}>
                <Text style={styles.packageCoins}>{formatCoins(pkg.coins)} coins</Text>
                {pkg.popular && (
                  <View style={styles.popularTag}>
                    <Text style={styles.popularText}>POPULAR</Text>
                  </View>
                )}
              </View>
              <Text style={styles.packageLabel}>{pkg.label}</Text>
              <Text style={styles.packagePrice}>{formatNaira(pkg.ngnAmount)}</Text>
            </View>

            <GradientButton
              label={busy ? "Opening…" : "Buy"}
              size="sm"
              loading={busy}
              disabled={busy}
              onPress={onBuy}
            />
          </View>
        </BlurView>
      </Pressable>
    </Animated.View>
  );
}

function TransactionRow({ row }: { row: CoinTransaction }) {
  const incoming = row.amount > 0;
  const type = row.transaction_type;

  return (
    <View style={styles.transaction}>
      <View
        style={[
          styles.transactionIcon,
          { backgroundColor: incoming ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.12)" },
        ]}
      >
        <Ionicons
          name={incoming ? "arrow-down" : "arrow-up"}
          size={15}
          color={incoming ? COLORS.success : COLORS.danger}
        />
      </View>

      <View style={styles.transactionText}>
        <Text style={styles.transactionTitle} numberOfLines={1}>
          {row.description || TYPE_LABELS[type] || "Coin activity"}
        </Text>
        <Text style={styles.transactionWhen}>{timeAgo(row.created_at)}</Text>
      </View>

      <Text style={[styles.transactionAmount, { color: incoming ? COLORS.success : COLORS.muted }]}>
        {incoming ? "+" : "−"}
        {formatCoins(Math.abs(row.amount))}
      </Text>
    </View>
  );
}

const TYPE_LABELS: Record<string, string> = {
  purchase: "Coin purchase",
  spend: "Spent",
  refund: "Refunded",
  transfer_in: "Coins received",
  transfer_out: "Coins sent",
};

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },

  scroll: { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },

  hero: {
    borderRadius: RADIUS.xxl,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.55)",
    overflow: "hidden",
  },
  heroInner: { padding: 18, gap: 8 },
  heroTitle: { color: COLORS.text, fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  heroBody: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  priceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  priceChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: RADIUS.md,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    minWidth: 62,
  },
  priceValue: { color: COLORS.cyan, fontSize: 15, fontWeight: "900" },
  priceLabel: { color: COLORS.subtle, fontSize: 10, fontWeight: "700", marginTop: 1 },

  warning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: RADIUS.md,
    backgroundColor: "rgba(245,158,11,0.12)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.3)",
  },
  warningText: { color: COLORS.warning, fontSize: 12.5, flexShrink: 1, lineHeight: 18 },

  sectionTitle: {
    color: COLORS.muted,
    fontSize: 11.5,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    marginTop: 10,
  },

  package: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.5)",
    overflow: "hidden",
  },
  packagePopular: { borderColor: "rgba(34,211,238,0.45)" },
  packageInner: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  packageIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  packageText: { flex: 1 },
  packageTop: { flexDirection: "row", alignItems: "center", gap: 7 },
  packageCoins: { color: COLORS.text, fontSize: 16, fontWeight: "900" },
  popularTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(34,211,238,0.16)",
  },
  popularText: { color: COLORS.cyan, fontSize: 8.5, fontWeight: "900", letterSpacing: 0.5 },
  packageLabel: { color: COLORS.muted, fontSize: 12, marginTop: 3 },
  packagePrice: { color: COLORS.text, fontSize: 13.5, fontWeight: "800", marginTop: 3 },

  sendButton: { marginTop: 4 },

  emptyHistory: { alignItems: "center", gap: 8, paddingVertical: 24 },
  emptyHistoryText: { color: COLORS.muted, fontSize: 13 },

  transaction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GLASS.border,
  },
  transactionIcon: { width: 32, height: 32, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  transactionText: { flex: 1 },
  transactionTitle: { color: COLORS.text, fontSize: 13.5, fontWeight: "700" },
  transactionWhen: { color: COLORS.subtle, fontSize: 11, marginTop: 2 },
  transactionAmount: { fontSize: 14, fontWeight: "900", fontVariant: ["tabular-nums"] },

  footer: { color: COLORS.subtle, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 12 },
});
