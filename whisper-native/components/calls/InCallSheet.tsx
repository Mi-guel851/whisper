import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { CALL_COLORS } from "@/lib/calls/callColors";
import { formatCallDuration } from "@/lib/calls/callFormat";
import type { CallStatus } from "@/lib/calls/callSession";
import { vibrate } from "@/lib/haptics";
import { COLORS, useStyles } from "@/lib/theme";

/**
 * Active call surface — the native port of the web app's
 * `components/calls/InCallSheet.tsx`.
 *
 * Takes over the screen while the call is ringing out, connecting or live,
 * keeps the anonymous identity centered, and puts the three controls along the
 * bottom — the mental model users already know from the phone's own call
 * screen. It is not a cage: the chevron collapses it into the pill and the
 * call carries on behind whatever the user goes to do.
 *
 * Same palette as the ring overlay: the `#07130f` island, the radial green
 * glow, the pulse rings while it is not yet connected, the `#ef4444` end
 * button, white/12 controls with active states in green.
 */

type InCallSheetProps = {
  name: string;
  avatarUrl: string | null;
  status: Exclude<CallStatus, "idle" | "incoming">;
  startedAt: number | null;
  muted: boolean;
  speakerSupported: boolean;
  speakerOn: boolean;
  remoteStreamUrl: string | null;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onHangUp: () => void;
  onMinimize?: () => void;
  /** When peer identity is still resolving, a skeleton instead of a blank frame. */
  isLoading?: boolean;
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
    transform: [{ scale: 0.92 + progress.value * 0.83 }],
    opacity: 0.8 * (1 - progress.value),
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ring, { borderColor: CALL_COLORS.ring }, style]}
    />
  );
}

function ControlButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.controlCol}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={() => {
          vibrate("tap");
          onPress();
        }}
        style={({ pressed }) => [
          styles.controlBtn,
          active && styles.controlBtnActive,
          pressed && { transform: [{ scale: 0.92 }] },
        ]}
      >
        <Ionicons name={icon} size={24} color={active ? CALL_COLORS.onAccept : COLORS.text} />
      </Pressable>
      <Text style={styles.controlLabel}>{label}</Text>
    </View>
  );
}

export default function InCallSheet({
  name,
  avatarUrl,
  status,
  startedAt,
  muted,
  speakerSupported,
  speakerOn,
  remoteStreamUrl,
  onToggleMute,
  onToggleSpeaker,
  onHangUp,
  onMinimize,
  isLoading = false,
}: InCallSheetProps) {
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
    <Animated.View entering={FadeIn.duration(220)} style={styles.root}>
      {/* React Native's WebRTC routes remote audio to the hardware only when
          the stream is attached to an RTCView — a 1×1 one, invisible but
          mounted, is the whole point of this element. */}
      {remoteStreamUrl ? (
        <RTCViewFallback uri={remoteStreamUrl} />
      ) : null}

      <View style={styles.bgBase} />
      <View style={styles.glowGreen} />
      <View style={styles.glowCyan} />

      {onMinimize ? (
        <Pressable
          accessibilityLabel="Minimize call"
          accessibilityRole="button"
          onPress={() => {
            vibrate("tap");
            onMinimize();
          }}
          style={({ pressed }) => [styles.minimize, pressed && { transform: [{ scale: 0.9 }] }]}
        >
          <Ionicons name="chevron-down" size={20} color={COLORS.text} />
        </Pressable>
      ) : null}

      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.badge}>
            <Ionicons name="call-outline" size={13} color="rgba(255,255,255,0.85)" />
            <Text style={styles.badgeText}>Whisper voice call</Text>
          </View>

          <View style={styles.avatarWrap}>
            {status !== "in_call" ? (
              <>
                <PulseRing delay={0} />
                <PulseRing delay={900} />
              </>
            ) : null}
            {isLoading ? (
              <View style={[styles.avatarFrame, styles.skeletonFrame]} />
            ) : (
              <View style={[styles.avatarFrame, avatarUrl ? null : styles.avatarFallback]}>
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.avatar} />
                ) : (
                  <Ionicons name="person" size={64} color={COLORS.muted} />
                )}
              </View>
            )}
          </View>

          {isLoading ? (
            <>
              <View style={styles.skeletonName} />
              <View style={styles.skeletonLabel} />
            </>
          ) : (
            <>
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.status}>{label}</Text>
            </>
          )}
        </View>

        <View style={styles.controls}>
          <ControlButton
            label={muted ? "Unmute" : "Mute"}
            icon={muted ? "mic-off" : "mic"}
            active={muted}
            onPress={onToggleMute}
          />
          <View style={styles.controlCol}>
            <Pressable
              accessibilityLabel="End call"
              accessibilityRole="button"
              onPress={() => {
                vibrate("tap");
                onHangUp();
              }}
              style={({ pressed }) => [styles.endBtn, pressed && { transform: [{ scale: 0.92 }] }]}
            >
              <Ionicons name="close" size={30} color={COLORS.text} />
            </Pressable>
            <Text style={styles.controlLabel}>End</Text>
          </View>
          {speakerSupported ? (
            <ControlButton
              label="Speaker"
              icon={speakerOn ? "volume-high" : "volume-mute"}
              active={speakerOn}
              onPress={onToggleSpeaker}
            />
          ) : (
            <View style={styles.controlSpacer} />
          )}
        </View>
      </View>
    </Animated.View>
  );
}

/**
 * The remote audio element. `react-native-webrtc`'s RTCView is registered by
 * the native module; requiring it through a lazy indirection keeps the module
 * reference in exactly one place and lets the surface render nothing when
 * there is no stream yet.
 */
function RTCViewFallback({ uri }: { uri: string }) {
  const styles = useStyles(makeStyles);
  const { RTCView } = require("react-native-webrtc") as { RTCView: React.ComponentType<{ streamURL: string; style: object }> };
  return <RTCView streamURL={uri} style={styles.remoteAudio} />;
}

const makeStyles = () => StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: CALL_COLORS.island,
  },
  remoteAudio: { width: 1, height: 1, opacity: 0.01 },
  bgBase: { ...StyleSheet.absoluteFillObject, backgroundColor: CALL_COLORS.island },
  glowGreen: { ...StyleSheet.absoluteFillObject, backgroundColor: CALL_COLORS.glow, opacity: 0.9 },
  glowCyan: { ...StyleSheet.absoluteFillObject, backgroundColor: CALL_COLORS.glowCyan },

  minimize: {
    position: "absolute",
    top: 54,
    left: 18,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },

  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 84,
    paddingBottom: 48,
  },
  header: { alignItems: "center" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
  avatarWrap: { marginTop: 56, width: 150, height: 150, alignItems: "center", justifyContent: "center" },
  ring: {
    position: "absolute",
    width: 150,
    height: 150,
    borderRadius: 75,
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
  skeletonFrame: { borderColor: CALL_COLORS.avatarRingFaint, backgroundColor: "rgba(255,255,255,0.10)" },
  avatar: { width: "100%", height: "100%" },
  skeletonName: {
    marginTop: 32,
    width: 160,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  skeletonLabel: {
    marginTop: 12,
    width: 112,
    height: 16,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  name: { marginTop: 32, color: COLORS.text, fontSize: 28, fontWeight: "900", maxWidth: 300 },
  status: { marginTop: 8, color: "rgba(255,255,255,0.85)", fontSize: 15, fontWeight: "600" },

  controls: {
    width: "88%",
    maxWidth: 360,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  controlCol: { alignItems: "center", gap: 8, width: 72 },
  controlSpacer: { width: 72 },
  controlBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  controlBtnActive: { backgroundColor: CALL_COLORS.accept },
  controlLabel: { color: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: "800" },
  endBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CALL_COLORS.decline,
  },
});
