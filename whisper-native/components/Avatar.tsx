import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAnonName } from "@/lib/identity";
import { generatedAvatarUrl } from "@/lib/identity";
import { COLORS, GRADIENT_COLORS } from "@/lib/theme";

/**
 * The identity chip.
 *
 * Whisper identities are generated, not uploaded — except for the signed-in
 * user's own profile, where `profiles.avatar_url` is a real picture they chose.
 * The gradient ring is what makes a column of otherwise similar glyphs
 * scannable, and it is the same accent the rest of the app uses.
 *
 * `official` swaps the generated face for the Whisper ghost. Callers pass it
 * only from a trusted source — `author_role === 'whisper_creator'` on a row the
 * database wrote, or the creator check for the signed-in account. An ordinary
 * user cannot pick this: avatars here are a pure function of the user id and
 * there is no upload path into the feed at all.
 */
export function Avatar({
  authorId,
  size = 40,
  official = false,
  imageUrl,
  ring = true,
}: {
  authorId?: string | null;
  size?: number;
  official?: boolean;
  /** A real avatar (the signed-in user's own profile picture). */
  imageUrl?: string | null;
  ring?: boolean;
}) {
  const rounded = size / 2;

  const inner = official ? (
    <View
      style={[
        styles.officialInner,
        { width: size - 4, height: size - 4, borderRadius: rounded },
      ]}
    >
      <Image
        source={require("../assets/ghost-mark.png")}
        style={{ width: size - 10, height: size - 10 }}
        contentFit="contain"
      />
    </View>
  ) : imageUrl ? (
    <Image
      source={{ uri: imageUrl }}
      style={{ width: size - 4, height: size - 4, borderRadius: rounded }}
      contentFit="cover"
      transition={180}
    />
  ) : authorId ? (
    <Image
      source={{ uri: generatedAvatarUrl(authorId) }}
      style={{ width: size - 4, height: size - 4, borderRadius: rounded }}
      contentFit="cover"
      transition={180}
    />
  ) : (
    <View
      style={[
        styles.placeholder,
        { width: size - 4, height: size - 4, borderRadius: rounded },
      ]}
    >
      <Ionicons name="person" size={size * 0.45} color={COLORS.muted} />
    </View>
  );

  if (!ring) {
    return <View style={{ width: size, height: size }}>{inner}</View>;
  }

  return (
    <LinearGradient
      colors={GRADIENT_COLORS}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.ring, { width: size, height: size, borderRadius: rounded }]}
    >
      {inner}
    </LinearGradient>
  );
}

/**
 * The feed's author chip: avatar plus name, always rendered together.
 *
 * The name resolves synchronously to the deterministic handle and upgrades to
 * the stored one when it lands, so this never renders an empty line while a
 * query is in flight.
 */
export function AuthorRow({
  authorId,
  official = false,
  size = 34,
  trailing,
  compact = false,
}: {
  authorId: string;
  official?: boolean;
  size?: number;
  trailing?: React.ReactNode;
  compact?: boolean;
}) {
  const name = useAnonName(authorId);

  return (
    <View style={styles.authorRow}>
      <Avatar authorId={authorId} official={official} size={size} />
      <View style={styles.authorText}>
        <View style={styles.authorLine}>
          <Text style={[styles.authorName, compact && { fontSize: 14 }]} numberOfLines={1}>
            {official ? "Whisper" : name}
          </Text>
          {official && (
            <View style={styles.officialBadge}>
              <Ionicons name="checkmark" size={10} color="#0a0814" />
            </View>
          )}
        </View>
        {trailing}
      </View>
    </View>
  );
}

/** The small "official" tick used beside a creator's name. */
export function OfficialBadge() {
  return (
    <View style={styles.officialBadge}>
      <Ionicons name="checkmark" size={10} color="#0a0814" />
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
  },
  officialInner: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a0814",
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
  },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  authorText: { flexShrink: 1 },
  authorLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  authorName: { color: COLORS.text, fontSize: 15, fontWeight: "800" },
  officialBadge: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: "#22d3ee",
    alignItems: "center",
    justifyContent: "center",
  },
});
