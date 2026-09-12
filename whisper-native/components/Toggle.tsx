import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { vibrate } from "@/lib/haptics";
import { COLORS, GRADIENT_COLORS } from "@/lib/theme";

/**
 * The switch.
 *
 * The settings screen has six of these and the create screen has one, so it is
 * worth a component rather than a styling decision per screen. When on, the
 * track is the brand gradient — the same material as the primary button — and
 * the knob slides with the platform's own easing curve rather than a spring,
 * because a spring on a switch reads as a bounce that was not asked for.
 */
export function Toggle({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, { duration: 180, easing: Easing.inOut(Easing.cubic) });
  }, [value, progress]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ["rgba(255,255,255,0.12)", "rgba(34,211,238,0.35)"]
    ),
  }));

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * 18 }],
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => {
        vibrate("select");
        onChange(!value);
      }}
      style={disabled && styles.disabled}
    >
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.gradient, { opacity: value ? 1 : 0 }]}>
          <LinearGradient
            colors={GRADIENT_COLORS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <Animated.View style={[styles.knob, knobStyle]}>
          <View style={styles.knobInner} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 46,
    height: 28,
    borderRadius: 14,
    padding: 3,
    justifyContent: "center",
    overflow: "hidden",
  },
  gradient: { ...StyleSheet.absoluteFillObject },
  knob: { width: 22, height: 22, borderRadius: 11 },
  knobInner: {
    flex: 1,
    borderRadius: 11,
    backgroundColor: COLORS.text,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  disabled: { opacity: 0.5 },
});
