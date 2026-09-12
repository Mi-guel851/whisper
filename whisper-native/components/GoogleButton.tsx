import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { COLORS, FILLS, RADIUS, useStyles } from "@/lib/theme";

/**
 * "Continue with Google" — the web app's auth button, mark and copy.
 *
 * The `G` is drawn with four Views, the same four brand colours the web's
 * `components/auth/GoogleMark.tsx` paints — there is no brand asset in the
 * repo to bundle, so the mark is geometry, not a file, on both platforms.
 *
 * Sits under the primary submit button on the auth screens; loading swaps it
 * for "Connecting…" exactly as the web's does.
 */

const GOOGLE_BLUE = "#4285F4";
const GOOGLE_GREEN = "#34A853";
const GOOGLE_YELLOW = "#FBBC05";
const GOOGLE_RED = "#EA4335";

/** The Google `G`, as four stroked arcs around an open right side. */
function GoogleMark({ size = 20 }: { size?: number }) {
  const styles = useStyles(makeStyles);
  const bar = Math.round(size * 0.13);
  const arm = Math.round(size * 0.3);

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* Blue top arm */}
      <View style={[styles.abs, { width: arm, height: bar, top: 0, left: size / 2 - bar / 2 - arm / 2 + bar * 0.6, backgroundColor: GOOGLE_BLUE }]} />
      {/* Green bottom arm */}
      <View style={[styles.abs, { width: arm, height: bar, bottom: 0, left: size / 2 - bar / 2 - arm / 2 + bar * 0.6, backgroundColor: GOOGLE_GREEN }]} />
      {/* Yellow left arm */}
      <View style={[styles.abs, { width: bar, height: arm, left: 0, top: size / 2 - bar / 2 - arm / 2 + bar * 0.6, backgroundColor: GOOGLE_YELLOW }]} />
      {/* Red: the bridge that folds over the top */}
      <View style={[styles.abs, { width: bar * 2.2, height: bar, top: size * 0.185, right: size * 0.06, backgroundColor: GOOGLE_RED, borderRadius: bar / 2 }]} />
      {/* White notch reopening the G on the right */}
      <View style={[styles.abs, { width: bar * 1.6, height: bar * 2.4, right: -bar * 0.2, top: size / 2 - bar * 1.2, backgroundColor: COLORS.card }]} />
    </View>
  );
}

type GoogleButtonProps = {
  loading: boolean;
  disabled?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

export function GoogleButton({ loading, disabled = false, onPress, style }: GoogleButtonProps) {
  const styles = useStyles(makeStyles);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      accessibilityState={{ busy: loading, disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, (disabled || loading) && styles.disabled, pressed && styles.pressed, style]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={COLORS.text} />
      ) : (
        <GoogleMark />
      )}
      <Text style={styles.label} numberOfLines={1}>
        {loading ? "Connecting..." : "Continue with Google"}
      </Text>
    </Pressable>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    button: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      height: 52,
      borderRadius: RADIUS.pill,
      borderWidth: 1,
      borderColor: COLORS.borderStrong,
      backgroundColor: FILLS[1],
      paddingHorizontal: 18,
    },
    pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
    disabled: { opacity: 0.55 },
    abs: { position: "absolute" },
    label: { color: COLORS.text, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  });
