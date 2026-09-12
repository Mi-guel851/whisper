import { Ionicons } from "@expo/vector-icons";
import { LinearGradient as ExpoLinearGradient } from "expo-linear-gradient";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { GlassCard } from "./GlassCard";
import { timeAgo } from "@/lib/format";
import { HINT_UNLOCK_COST } from "@/lib/coins";
import { COLORS, GLASS, GRADIENT_COLORS, RADIUS } from "@/lib/theme";
import type { Whisper, WhisperHint } from "@/lib/types";

/**
 * A received anonymous whisper.
 *
 * The card is the whole inbox row: the message, when it arrived, whether it is
 * read, and the two things worth doing with it — the paid hint and deleting it.
 *
 * THE HINT
 *
 * `anonymous_sender_reveals` is the receipt and `whisper_hints_for` is the only
 * reader; the sender's city and device are unreadable from the client until a
 * receipt exists. So the card has three states, and they are genuinely
 * different rather than a styling variation:
 *
 *   paid + data in hand   the reveal, expanded
 *   paid, no data yet     still a tappable row — re-reading costs nothing, so
 *                         tapping fetches instead of charging again
 *   unpaid                the locked row, with its price
 *
 * If the message was deleted or the row revoked, the third state is what shows
 * and the tap re-attempts the read. That is the `202609070001` contract.
 */
export function WhisperCard({
  whisper,
  hint,
  unlocked,
  expanded,
  unlocking,
  onPress,
  onToggleHint,
  onDelete,
  onReply,
}: {
  whisper: Whisper;
  hint?: WhisperHint;
  unlocked: boolean;
  expanded: boolean;
  unlocking: boolean;
  onPress: () => void;
  onToggleHint: () => void;
  onDelete: () => void;
  onReply: () => void;
}) {
  const tone = useSharedValue(whisper.is_read ? 0 : 1);

  React.useEffect(() => {
    tone.value = withTiming(whisper.is_read ? 0 : 1, { duration: 240, easing: Easing.out(Easing.cubic) });
  }, [tone, whisper.is_read]);

  /* The unread accent bar. An unread whisper in a list of forty has to be
     findable by shape, not by reading forty timestamps. */
  const barStyle = useAnimatedStyle(() => ({ opacity: tone.value }));

  return (
    <GlassCard style={styles.card} radius={RADIUS.xl}>
      <Animated.View style={[styles.unreadBar, barStyle]}>
        <ExpoLinearGradient
          colors={GRADIENT_COLORS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Open whisper">
        <View style={styles.head}>
          <View style={styles.avatar}>
            <Ionicons name="help" size={17} color={COLORS.text} />
          </View>

          <View style={styles.headText}>
            <Text style={styles.who}>Anonymous</Text>
            <Text style={styles.when}>{timeAgo(whisper.created_at)}</Text>
          </View>

          {!whisper.is_read && <View style={styles.dot} />}

          <Pressable onPress={onDelete} hitSlop={12} style={styles.delete} accessibilityLabel="Delete whisper">
            <Ionicons name="trash-outline" size={16} color={COLORS.subtle} />
          </Pressable>
        </View>

        <Text style={styles.message}>{whisper.message || "Sent you a photo"}</Text>

        {whisper.image_url ? (
          <View style={styles.attachment}>
            <Ionicons name="image-outline" size={14} color={COLORS.cyan} />
            <Text style={styles.attachmentText}>Photo attached</Text>
          </View>
        ) : null}
      </Pressable>

      {expanded && unlocked && hint ? (
        <View style={styles.reveal}>
          <RevealRow icon="location-outline" label="From" value={formatPlace(hint)} />
          <RevealRow icon="phone-portrait-outline" label="Device" value={hint.sender_device ?? "Unknown"} />
          {hint.sent_at && <RevealRow icon="time-outline" label="Sent" value={timeAgo(hint.sent_at)} />}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable onPress={onReply} style={styles.action} accessibilityLabel="Reply with a whisper">
          <Ionicons name="chatbubble-ellipses-outline" size={15} color={COLORS.muted} />
          <Text style={styles.actionText}>Reply</Text>
        </Pressable>

        <Pressable
          onPress={onToggleHint}
          style={[styles.hintButton, unlocked && styles.hintButtonUnlocked]}
          disabled={unlocking}
          accessibilityLabel={unlocked ? "Show sender hint" : `Unlock sender hint for ${HINT_UNLOCK_COST} coins`}
        >
          {unlocking ? (
            <Ionicons name="hourglass-outline" size={14} color={COLORS.cyan} />
          ) : (
            <Ionicons
              name={unlocked ? (expanded ? "chevron-up" : "chevron-down") : "lock-closed"}
              size={13}
              color={unlocked ? COLORS.cyan : COLORS.purple}
            />
          )}
          <Text style={[styles.hintText, unlocked && { color: COLORS.cyan }]}>
            {unlocked ? (expanded ? "Hide hint" : "Show hint") : `Hint · ${HINT_UNLOCK_COST} coins`}
          </Text>
        </Pressable>
      </View>
    </GlassCard>
  );
}

/** One line of the paid reveal. */
function RevealRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.revealRow}>
      <Ionicons name={icon} size={14} color={COLORS.cyan} />
      <Text style={styles.revealLabel}>{label}</Text>
      <Text style={styles.revealValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** `Lagos, Nigeria` — however much of it the sender's client actually reported. */
export function formatPlace(hint: WhisperHint): string {
  const parts = [hint.sender_city, hint.sender_state, hint.sender_country].filter(
    (value): value is string => Boolean(value)
  );
  return parts.length > 0 ? parts.join(", ") : "Somewhere on Earth";
}

const styles = StyleSheet.create({
  card: { marginBottom: 10, overflow: "hidden" },
  unreadBar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(168,85,247,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  headText: { flex: 1 },
  who: { color: COLORS.text, fontSize: 13.5, fontWeight: "800" },
  when: { color: COLORS.subtle, fontSize: 11.5, fontWeight: "600", marginTop: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.cyan },
  delete: { padding: 4 },
  message: { color: COLORS.text, fontSize: 15, lineHeight: 21, marginTop: 10 },
  attachment: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  attachmentText: { color: COLORS.cyan, fontSize: 12, fontWeight: "700" },
  reveal: {
    marginTop: 12,
    padding: 11,
    borderRadius: RADIUS.md,
    backgroundColor: "rgba(34,211,238,0.07)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.2)",
    gap: 7,
  },
  revealRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  revealLabel: { color: COLORS.muted, fontSize: 12, fontWeight: "700", width: 54 },
  revealValue: { color: COLORS.text, fontSize: 12.5, fontWeight: "600", flexShrink: 1 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GLASS.border,
  },
  action: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 },
  actionText: { color: COLORS.muted, fontSize: 12.5, fontWeight: "700" },
  hintButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(168,85,247,0.14)",
    borderWidth: 1,
    borderColor: "rgba(168,85,247,0.3)",
  },
  hintButtonUnlocked: {
    backgroundColor: "rgba(34,211,238,0.1)",
    borderColor: "rgba(34,211,238,0.3)",
  },
  hintText: { color: COLORS.purple, fontSize: 11.5, fontWeight: "800" },
});
