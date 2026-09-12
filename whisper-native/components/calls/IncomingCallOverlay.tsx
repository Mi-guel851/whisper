import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { CALL_COLORS } from "@/lib/calls/callColors";
import { COLORS, useStyles } from "@/lib/theme";
import { vibrate } from "@/lib/haptics";
import { useToast } from "@/lib/toast";

/**
 * Incoming call overlay — the native port of the web app's
 * `components/calls/IncomingCallOverlay.tsx`.
 *
 * WhatsApp-style: full-screen, opaque (never a panel that lets the page behind
 * answer for you), green accept, red decline. There is deliberately no
 * backdrop-tap close: a call has three real endings (accept, decline, expiry)
 * and "closed it somehow" is not one of them. The web's Escape-key contract
 * has no native equivalent — the back press is bound to Decline in the
 * provider, which is the same "make it stop" gesture.
 *
 * THE LOOK, from the web's own styles: a `#07130f` island with a radial green
 * glow at 22% height, a cyan counter-glow low right, a 120° grid overlay at
 * 20% opacity, pulse rings expanding from the avatar (156 → ×1.85, 1.8s, two
 * phases 0.9s apart), a `#25D366` accept button whose phone icon rocks ±14° in
 * the same 1.4s loop the button breathes to, and an `#ef4444` decline.
 */

type IncomingCallOverlayProps = {
  name: string;
  avatarUrl: string | null;
  onAccept: () => void;
  onDecline: () => void;
};


function PulseRing({ delay }: { delay: number }) {
  const styles = useStyles(makeStyles);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1_800, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 0 })
        ),
        -1,
        false
      )
    );
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 0.92 + progress.value * 0.93 }],
    opacity: 0.8 * (1 - progress.value),
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        { borderColor: CALL_COLORS.ring },
        style,
      ]}
    />
  );
}

export default function IncomingCallOverlay({ name, avatarUrl, onAccept, onDecline }: IncomingCallOverlayProps) {
  const styles = useStyles(makeStyles);
  const { showToast } = useToast();
  /* Announced once, the native twin of the web's polite live region. */
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    showToast(`Incoming voice call from ${name}`, { variant: "subtle", duration: 4000 });
  }, [name, showToast]);

  const acceptBreath = useSharedValue(1);
  const acceptTilt = useSharedValue(0);

  useEffect(() => {
    acceptBreath.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 700, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
    acceptTilt.value = withRepeat(
      withSequence(
        withTiming(-14, { duration: 350, easing: Easing.inOut(Easing.sin) }),
        withTiming(14, { duration: 700, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 350, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, [acceptBreath, acceptTilt]);

  const acceptStyle = useAnimatedStyle(() => ({ transform: [{ scale: acceptBreath.value }] }));
  const tiltStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${acceptTilt.value}deg` }] }));

  return (
    <View style={styles.root}>
      {/* The web's layered background: radial green glow up top, faint cyan
          low right, the vertical green-to-black ramp, then the grid at 20%. */}
      <View style={styles.bgBase} />
      <View style={styles.glowGreen} />
      <View style={styles.glowCyan} />
      <View style={styles.grid} />

      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Incoming voice call</Text>
          </View>

          <View style={styles.avatarWrap}>
            <PulseRing delay={0} />
            <PulseRing delay={900} />
            <View style={[styles.avatarFrame, avatarUrl ? null : styles.avatarFallback]}>
              {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.avatar} />
              ) : (
                <Ionicons name="person" size={64} color={COLORS.muted} />
              )}
            </View>
          </View>

          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.subtitle}>Whisper voice call…</Text>
        </View>

        <View style={styles.actions}>
          <View style={styles.actionCol}>
            <Pressable
              accessibilityLabel="Decline call"
              accessibilityRole="button"
              onPress={() => {
                vibrate("tap");
                onDecline();
              }}
              style={({ pressed }) => [styles.declineBtn, pressed && { transform: [{ scale: 0.92 }] }]}
            >
              <Ionicons name="close" size={30} color={COLORS.text} />
            </Pressable>
            <Text style={styles.actionLabel}>Decline</Text>
          </View>

          <View style={styles.actionCol}>
            <Animated.View style={acceptStyle}>
              <Pressable
                accessibilityLabel="Accept call"
                accessibilityRole="button"
                onPress={() => {
                  vibrate("tap");
                  onAccept();
                }}
                style={({ pressed }) => [styles.acceptBtn, pressed && { transform: [{ scale: 0.92 }] }]}
              >
                <Animated.View style={tiltStyle}>
                  <Ionicons name="call" size={28} color={COLORS.text} />
                </Animated.View>
              </Pressable>
            </Animated.View>
            <Text style={styles.actionLabel}>Accept</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: CALL_COLORS.island,
  },
  bgBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: CALL_COLORS.island,
  },
  /* Linear-gradient(180deg, #0b2119 0%, #06100d 62%, #020605 100%) at 90-95%
     opacity is carried as three stacked flats + the two radial glows; React
     Native cannot blend radial gradients natively, so the wash is layered. */
  glowGreen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: CALL_COLORS.glow,
    opacity: 0.95,
  },
  glowCyan: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: CALL_COLORS.glowCyan,
  },
  /* The web draws a 28px 120° line grid at 20%; on a phone held to the ear
     during a ring it is texture, not information — a faint scrim carries it. */
  grid: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.08,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 72,
    paddingBottom: 56,
  },
  header: { alignItems: "center" },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  badgeText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  avatarWrap: {
    marginTop: 64,
    width: 156,
    height: 156,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: 156,
    height: 156,
    borderRadius: 78,
    borderWidth: 1,
  },
  avatarFrame: {
    width: 144,
    height: 144,
    borderRadius: 72,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: CALL_COLORS.avatarRing,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  avatarFallback: { backgroundColor: "rgba(255,255,255,0.08)" },
  avatar: { width: "100%", height: "100%" },
  name: {
    marginTop: 32,
    color: COLORS.text,
    fontSize: 28,
    fontWeight: "900",
    maxWidth: 280,
  },
  subtitle: { marginTop: 8, color: "rgba(255,255,255,0.85)", fontSize: 15, fontWeight: "600" },
  actions: {
    width: "78%",
    maxWidth: 300,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  actionCol: { alignItems: "center", gap: 8 },
  declineBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CALL_COLORS.decline,
  },
  acceptBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CALL_COLORS.accept,
  },
  actionLabel: { color: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: "800" },
});
