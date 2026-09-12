import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { VoiceNotePlayer } from "./VoiceNotePlayer";
import { Waveform } from "./Waveform";
import { formatElapsed } from "@/lib/format";
import { vibrate } from "@/lib/haptics";
import { COLORS, GLASS, GRADIENT_COLORS, RADIUS } from "@/lib/theme";
import type { VoiceRecording } from "@/lib/types";
import type { Recorder } from "@/lib/useVoiceRecorder";

/**
 * The recording panel.
 *
 * One component, three states — recording, reviewing, and idle — because the
 * web app's composer does exactly that and because a voice note is a sequence
 * of decisions the user makes in one place: record it, listen to it, send it or
 * throw it away.
 *
 * The live waveform is drawn from the recorder's own metering, so what the user
 * sees while speaking is the shape that will be stored with the message.
 */
export function VoiceRecorderPanel({
  recorder,
  pending,
  onSend,
  onDiscard,
  sending = false,
}: {
  recorder: Recorder;
  /** A finished recording awaiting a decision. */
  pending: VoiceRecording | null;
  onSend: () => void;
  onDiscard: () => void;
  sending?: boolean;
}) {
  if (pending) {
    return (
      <BlurView intensity={GLASS.blurIntensity} tint="dark" style={styles.panel}>
        <View style={styles.reviewRow}>
          <VoiceNotePlayer
            uri={pending.uri}
            durationMs={pending.durationMs}
            peaks={pending.waveform}
            tone="incoming"
          />

          <View style={styles.reviewActions}>
            <Pressable
              onPress={() => {
                vibrate("warning");
                onDiscard();
              }}
              style={[styles.circle, styles.discard]}
              accessibilityLabel="Discard voice note"
            >
              <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
            </Pressable>

            <Pressable
              onPress={() => {
                vibrate("success");
                onSend();
              }}
              disabled={sending}
              accessibilityLabel="Send voice note"
            >
              <LinearGradient
                colors={GRADIENT_COLORS}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.circle}
              >
                {sending ? (
                  <Ionicons name="hourglass-outline" size={18} color="#0a0814" />
                ) : (
                  <Ionicons name="arrow-up" size={20} color="#0a0814" />
                )}
              </LinearGradient>
            </Pressable>
          </View>
        </View>

        <Text style={styles.hint}>Voice notes can only be played once by the person who receives them.</Text>
      </BlurView>
    );
  }

  return (
    <BlurView intensity={GLASS.blurIntensity} tint="dark" style={styles.panel}>
      <View style={styles.liveRow}>
        <RecordingPulse active={recorder.status === "recording"} />

        <View style={styles.liveBody}>
          <Text style={styles.timer}>{formatElapsed(recorder.elapsedMs)}</Text>
          <Waveform peaks={recorder.peaks} bars={26} height={22} />
        </View>

        <View style={styles.liveActions}>
          <Pressable
            onPress={() => void recorder.cancel()}
            style={[styles.circle, styles.discard]}
            accessibilityLabel="Cancel recording"
          >
            <Ionicons name="close" size={18} color={COLORS.danger} />
          </Pressable>

          {recorder.status === "paused" ? (
            <Pressable
              onPress={() => void recorder.resume()}
              style={[styles.circle, styles.secondary]}
              accessibilityLabel="Resume recording"
            >
              <Ionicons name="play" size={17} color={COLORS.text} />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void recorder.pause()}
              style={[styles.circle, styles.secondary]}
              accessibilityLabel="Pause recording"
            >
              <Ionicons name="pause" size={17} color={COLORS.text} />
            </Pressable>
          )}

          <Pressable
            onPress={() => {
              vibrate("success");
              void recorder.stop();
            }}
            accessibilityLabel="Stop recording"
          >
            <LinearGradient
              colors={GRADIENT_COLORS}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.circle}
            >
              <Ionicons name="checkmark" size={20} color="#0a0814" />
            </LinearGradient>
          </Pressable>
        </View>
      </View>

      <Text style={styles.hint}>
        {recorder.status === "paused" ? "Paused — tap play to keep recording." : "Recording your voice note…"}
      </Text>
    </BlurView>
  );
}

/** The blinking red dot, so the panel is unambiguous about being live. */
function RecordingPulse({ active }: { active: boolean }) {
  const opacity = useSharedValue(1);

  React.useEffect(() => {
    opacity.value = active
      ? withRepeat(withTiming(0.25, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true)
      : withTiming(1, { duration: 150 });
  }, [active, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.pulse, { backgroundColor: active ? COLORS.danger : COLORS.subtle }, style]} />
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.6)",
    padding: 12,
    gap: 8,
    overflow: "hidden",
  },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  liveBody: { flex: 1, gap: 6 },
  liveActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  reviewRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  reviewActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  discard: { backgroundColor: "rgba(239,68,68,0.14)" },
  secondary: { backgroundColor: "rgba(255,255,255,0.08)" },
  pulse: { width: 10, height: 10, borderRadius: 5 },
  timer: { color: COLORS.text, fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"] },
  hint: { color: COLORS.subtle, fontSize: 11.5 },
});
