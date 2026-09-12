import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { SlideInUp, SlideOutUp } from "react-native-reanimated";

import { CALL_COLORS } from "@/lib/calls/callColors";
import { formatCallDuration } from "@/lib/calls/callFormat";
import type { CallStatus } from "@/lib/calls/callSession";
import { vibrate } from "@/lib/haptics";
import { COLORS, useStyles } from "@/lib/theme";

/**
 * The minimized call: a pill parked at the top of the screen — the native
 * port of the web app's `components/calls/InCallPill.tsx`.
 *
 * Answering a call should not confiscate the app. The moment the call is
 * accepted it collapses into this, which keeps the three things a live call
 * needs on screen — who, how long, and the two controls you reach for — while
 * handing the rest of the viewport back. Tapping the pill expands to the
 * full in-call sheet again.
 *
 * MOUNTED BY THE PROVIDER, NOT THE CHAT SCREEN — that is the whole reason the
 * call engine is a singleton: the pill survives navigating anywhere, still
 * counting, still on.
 */

type InCallPillProps = {
  name: string;
  avatarUrl: string | null;
  status: Exclude<CallStatus, "idle" | "incoming">;
  startedAt: number | null;
  muted: boolean;
  onExpand: () => void;
  onToggleMute: () => void;
  onHangUp: () => void;
};

export default function InCallPill({
  name,
  avatarUrl,
  status,
  startedAt,
  muted,
  onExpand,
  onToggleMute,
  onHangUp,
}: InCallPillProps) {
  const styles = useStyles(makeStyles);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const label =
    status === "in_call"
      ? startedAt !== null
        ? formatCallDuration(now - startedAt)
        : "0:00"
      : status === "outgoing"
        ? "Ringing…"
        : "Connecting…";

  return (
    <Animated.View entering={SlideInUp.springify().damping(17)} exiting={SlideOutUp.duration(180)} style={styles.layer}>
      <View style={styles.pill}>
        <Pressable
          accessibilityLabel={`Voice call with ${name}`}
          accessibilityRole="button"
          onPress={() => {
            vibrate("tap");
            onExpand();
          }}
          style={styles.pillMain}
        >
          <View style={[styles.avatarWrap, avatarUrl ? null : styles.avatarFallback]}>
            {avatarUrl ? <Image source={{ uri: avatarUrl }} style={styles.avatar} /> : <Ionicons name="person" size={20} color="rgba(255,255,255,0.8)" />}
          </View>
          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.status}>{label}</Text>
          </View>
          <Ionicons name="chevron-up" size={16} color={COLORS.muted} />
        </Pressable>

        <View style={styles.divider} />

        <Pressable
          accessibilityLabel={muted ? "Unmute" : "Mute"}
          accessibilityRole="button"
          onPress={() => {
            vibrate("tap");
            onToggleMute();
          }}
          style={({ pressed }) => [styles.pillAction, muted && styles.pillActionOn, pressed && { transform: [{ scale: 0.9 }] }]}
        >
          <Ionicons name={muted ? "mic-off" : "mic"} size={16} color={muted ? CALL_COLORS.onAccept : COLORS.text} />
        </Pressable>

        <Pressable
          accessibilityLabel="End call"
          accessibilityRole="button"
          onPress={() => {
            vibrate("tap");
            onHangUp();
          }}
          style={({ pressed }) => [styles.pillAction, styles.pillActionEnd, pressed && { transform: [{ scale: 0.9 }] }]}
        >
          <Ionicons name="call" size={16} color={COLORS.text} style={{ transform: [{ rotate: "135deg" }] }} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const makeStyles = () => StyleSheet.create({
  layer: {
    position: "absolute",
    top: 54,
    left: 14,
    right: 14,
    zIndex: 60,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 6,
    borderRadius: 999,
    backgroundColor: CALL_COLORS.islandRaised,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    shadowColor: COLORS.background,
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  pillMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 4 },
  avatarWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  avatarFallback: {},
  avatar: { width: "100%", height: "100%" },
  text: { flex: 1, gap: 1 },
  name: { color: COLORS.text, fontSize: 13, fontWeight: "800" },
  status: { color: "rgba(255,255,255,0.72)", fontSize: 11.5, fontWeight: "700" },
  divider: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: "rgba(255,255,255,0.16)" },
  pillAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  pillActionOn: { backgroundColor: CALL_COLORS.accept },
  pillActionEnd: { backgroundColor: CALL_COLORS.decline },
});
