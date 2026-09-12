import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { formatCount } from "@/lib/format";
import { COLORS, RADIUS } from "@/lib/theme";

/**
 * A poll on a feed post.
 *
 * The bar for each option is a width transition rather than a jump, because a
 * poll's whole pleasure is watching the numbers move when you vote — and on a
 * phone the vote and the bar landing in the same frame is what makes it feel
 * like it registered.
 *
 * Before voting, every option is an outlined row of equal weight: the tally is
 * hidden, exactly as the web client hides it, so the first voter is not steered
 * by a leading option. After voting, the bars appear and the chosen one is
 * filled with the brand gradient.
 */
export function Poll({
  options,
  counts,
  choice,
  pending,
  onVote,
}: {
  options: string[];
  counts: number[];
  /** This viewer's chosen option, 0-based, or null. */
  choice: number | null;
  pending: boolean;
  onVote: (index: number) => void;
}) {
  const total = counts.reduce((sum, value) => sum + (Number(value) || 0), 0);
  const voted = choice !== null && choice !== undefined;

  return (
    <View style={styles.wrap}>
      {options.map((option, index) => {
        const count = Number(counts[index] ?? 0) || 0;
        const share = total > 0 ? count / total : 0;
        const selected = choice === index;

        return (
          <PollOption
            key={`${option}-${index}`}
            label={option}
            count={count}
            share={share}
            selected={selected}
            showResults={voted}
            disabled={pending}
            onPress={() => onVote(index)}
          />
        );
      })}

      <Text style={styles.total}>
        {total === 0
          ? "No votes yet"
          : `${formatCount(total)} ${total === 1 ? "vote" : "votes"}${pending ? " · sending…" : ""}`}
      </Text>
    </View>
  );
}

function PollOption({
  label,
  count,
  share,
  selected,
  showResults,
  disabled,
  onPress,
}: {
  label: string;
  count: number;
  share: number;
  selected: boolean;
  showResults: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const progress = useSharedValue(showResults ? share : 0);

  React.useEffect(() => {
    progress.value = withTiming(showResults ? share : 0, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
  }, [share, showResults, progress]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || selected}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: disabled || selected }}
      accessibilityLabel={`${label}${showResults ? `, ${count} votes` : ""}`}
      style={[
        styles.option,
        selected && { borderColor: COLORS.cyan },
        disabled && styles.optionDisabled,
      ]}
    >
      {showResults && (
        <Animated.View style={[styles.fillWrap, fillStyle]}>
          <View
            style={[
              styles.fill,
              { backgroundColor: selected ? "rgba(34,211,238,0.28)" : "rgba(168,85,247,0.18)" },
            ]}
          />
        </Animated.View>
      )}

      <View style={styles.optionRow}>
        <Text style={[styles.label, selected && { fontWeight: "800" }]} numberOfLines={2}>
          {label}
        </Text>
        {showResults && <Text style={styles.percent}>{Math.round(share * 100)}%</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, gap: 8 },
  option: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: RADIUS.md,
    overflow: "hidden",
    minHeight: 42,
    justifyContent: "center",
  },
  optionDisabled: { opacity: 0.7 },
  fillWrap: { ...StyleSheet.absoluteFillObject },
  fill: { flex: 1 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  label: { color: COLORS.text, fontSize: 14, flexShrink: 1 },
  percent: { color: COLORS.muted, fontSize: 13, fontWeight: "800", fontVariant: ["tabular-nums"] },
  total: { color: COLORS.subtle, fontSize: 11.5, fontWeight: "600" },
});
