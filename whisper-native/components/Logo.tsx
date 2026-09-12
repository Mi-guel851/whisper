import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

import { GradientText } from "./GradientText";
import { COLORS } from "@/lib/theme";

/**
 * The wordmark.
 *
 * The same lockup as the website's `components/Logo.tsx`: the ghost, the word
 * "Whisper" — gradient here rather than solid white, which is the brief's
 * instruction and reads as the same material as every primary button — and the
 * "Anonymous Messaging" line under it.
 *
 * The ghost carries a cyan drop shadow, which on native is a tinted shadow on
 * iOS and nothing on Android (the platform has no coloured shadow). The mark is
 * legible either way; the glow is depth, not contrast.
 */
export function Logo({
  compact = false,
  showTagline = true,
}: {
  /** Header variant — smaller mark, tighter type. */
  compact?: boolean;
  showTagline?: boolean;
}) {
  const size = compact ? 32 : 48;

  return (
    <View style={styles.row}>
      <Image
        source={require("../assets/ghost-mark.png")}
        style={[
          { width: size, height: size },
          {
            shadowColor: COLORS.cyan,
            shadowOpacity: 0.55,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 0 },
          },
        ]}
        contentFit="contain"
      />

      <View style={styles.textColumn}>
        <GradientText
          style={[styles.wordmark, compact ? { fontSize: 19 } : { fontSize: 30 }]}
        >
          Whisper
        </GradientText>

        {showTagline && (
          <Text style={[styles.tagline, compact && { fontSize: 11 }]}>Anonymous Messaging</Text>
        )}
      </View>
    </View>
  );
}

/** The mark on its own — used in the tab bar and by the official avatar. */
export function GhostMark({ size = 26 }: { size?: number }) {
  return (
    <Image
      source={require("../assets/ghost-mark.png")}
      style={{ width: size, height: size }}
      contentFit="contain"
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  textColumn: { justifyContent: "center" },
  wordmark: { fontWeight: "800", letterSpacing: -0.8 },
  tagline: { color: COLORS.purple, fontSize: 13, fontWeight: "600", marginTop: 1 },
});
