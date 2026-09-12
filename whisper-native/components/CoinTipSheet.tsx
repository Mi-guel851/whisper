import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { CoinBadge } from "./CoinBadge";
import { GradientButton } from "./GradientButton";
import { Field } from "./Input";
import { Sheet } from "./Sheet";
import { normalizeAddress, transferCoins } from "@/lib/coins";
import { formatCoins } from "@/lib/format";
import { vibrate } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { COLORS, GLASS, RADIUS } from "@/lib/theme";

/**
 * The coin tip.
 *
 * WHAT THIS IS, AND WHY IT LOOKS THE WAY IT DOES
 *
 * There is no "tip the author of post X" endpoint. Coins move by one route and
 * one route only: `transfer_whisper_coins(recipient_address, …)`, and wallet
 * addresses are visible to their owner alone — row-level security on `coins`
 * gives a signed-in user their own row and nobody else's, which is the right
 * call for a product where every identity in the feed is anonymous and an
 * address is the one thing that could de-anonymise someone.
 *
 * So the tip sheet is the transfer itself, with the address typed or pasted in.
 * It is the same operation the web app's coin store performs, in a sheet the
 * feed can open without leaving the post, and it is honest about what it does:
 * the coins go to a Whispers address, not to "this post's author" by magic.
 *
 * The idempotency key is generated once per attempt, so a double tap on a
 * flaky connection cannot pay twice — the second call returns the first
 * receipt. The balance shown is the server's, read back from the RPC's own
 * return value; the client never computes a new balance locally.
 */
export function CoinTipSheet({
  visible,
  onClose,
  balance,
  onDone,
  presetAddress,
  presetAmount,
}: {
  visible: boolean;
  onClose: () => void;
  /** The live balance, so the sheet can refuse an impossible amount early. */
  balance: number | null;
  onDone?: (balance?: number) => void;
  /** Pre-filled when the sheet was opened from a wallet card. */
  presetAddress?: string;
  presetAmount?: number;
}) {
  const { userId } = useSession();
  const { showToast } = useToast();

  const [address, setAddress] = useState(presetAddress ?? "");
  const [amount, setAmount] = useState(presetAmount ? String(presetAmount) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* A fresh key per sheet-open. Reused across retries *inside* one open, which
     is the case the key exists for. */
  const [idempotencyKey] = useState(() => `tip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  React.useEffect(() => {
    if (!visible) return;
    setAddress(presetAddress ?? "");
    setAmount(presetAmount ? String(presetAmount) : "");
    setError(null);
  }, [visible, presetAddress, presetAmount]);

  const parsed = Number.parseInt(amount.replace(/[^0-9]/g, ""), 10);
  const coins = Number.isFinite(parsed) ? parsed : 0;
  const normalized = normalizeAddress(address);
  const tooMuch = balance !== null && coins > balance;

  const paste = async () => {
    const value = await Clipboard.getStringAsync();
    if (value) {
      setAddress(value.trim());
      setError(null);
    }
  };

  const send = async () => {
    if (!userId) return;

    if (!normalized) {
      setError("That doesn't look like a Whispers address.");
      return;
    }
    if (coins <= 0) {
      setError("Enter how many coins to send.");
      return;
    }
    if (tooMuch) {
      setError(`You only have ${formatCoins(balance ?? 0)} coins.`);
      return;
    }

    setBusy(true);
    setError(null);

    const result = await transferCoins(normalized, coins, idempotencyKey);
    setBusy(false);

    if (!result.ok) {
      vibrate("warning");
      setError(result.error ?? "The transfer didn't go through.");
      return;
    }

    vibrate("success");
    showToast(`Sent ${formatCoins(coins)} coins`, { variant: "success" });
    onDone?.(result.balance);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Send coins">
      <View style={styles.body}>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceLabel}>Your balance</Text>
          <CoinBadge balance={balance} />
        </View>

        <Field
          label="Recipient address"
          icon="wallet-outline"
          value={address}
          onChangeText={(value) => {
            setAddress(value);
            setError(null);
          }}
          placeholder="WHISPERS-XXXX-XXXX-XXXX-XXXX"
          autoCapitalize="characters"
          style={styles.field}
        />

        <Pressable onPress={() => void paste()} style={styles.paste} accessibilityLabel="Paste address">
          <Ionicons name="clipboard-outline" size={14} color={COLORS.cyan} />
          <Text style={styles.pasteText}>Paste from clipboard</Text>
        </Pressable>

        <Field
          label="Amount"
          icon="logo-bitcoin"
          value={amount}
          onChangeText={(value) => {
            setAmount(value);
            setError(null);
          }}
          placeholder="0"
          keyboardType="number-pad"
          style={styles.field}
        />

        <View style={styles.quickRow}>
          {[5, 10, 25, 50].map((value) => (
            <Pressable
              key={value}
              onPress={() => {
                vibrate("tap");
                setAmount(String(value));
                setError(null);
              }}
              style={[styles.quick, coins === value && styles.quickActive]}
              accessibilityLabel={`Send ${value} coins`}
            >
              <Text style={[styles.quickText, coins === value && styles.quickTextActive]}>{value}</Text>
            </Pressable>
          ))}
        </View>

        {error ? (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle" size={15} color={COLORS.danger} />
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        <GradientButton
          label={busy ? "Sending…" : coins > 0 ? `Send ${coins} coins` : "Send coins"}
          icon="paper-plane"
          fullWidth
          loading={busy}
          disabled={busy || !normalized || coins <= 0 || tooMuch}
          onPress={() => void send()}
        />

        <Text style={styles.note}>
          Coins move between Whispers addresses. The transfer settles both balances in one database
          transaction, so a failed send leaves neither side changed.
        </Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10, paddingBottom: 10 },
  balanceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  balanceLabel: { color: COLORS.muted, fontSize: 13, fontWeight: "700" },
  field: { marginTop: 2 },
  paste: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2, marginLeft: 4 },
  pasteText: { color: COLORS.cyan, fontSize: 12.5, fontWeight: "700" },
  quickRow: { flexDirection: "row", gap: 8 },
  quick: {
    flex: 1,
    height: 38,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: GLASS.border,
  },
  quickActive: { backgroundColor: "rgba(34,211,238,0.16)", borderColor: COLORS.cyan },
  quickText: { color: COLORS.muted, fontSize: 13.5, fontWeight: "800" },
  quickTextActive: { color: COLORS.text },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  error: { color: COLORS.danger, fontSize: 13, flexShrink: 1 },
  note: { color: COLORS.subtle, fontSize: 11.5, lineHeight: 16, marginTop: 4 },
});
