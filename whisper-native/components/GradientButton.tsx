import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { vibrate } from "@/lib/haptics";
import { COLORS, GLASS, GRADIENT_COLORS, RADIUS, glow, useStyles } from "@/lib/theme";

/**
 * The primary button.
 *
 * `#22d3ee → #a855f7`, left to right, white bold text, fully rounded — the one
 * button in the app. Three variants, because the app needs exactly three and a
 * fourth would mean a screen had invented its own emphasis:
 *
 *   primary   the gradient. One per screen wherever possible.
 *   glass     a dark frosted pill for secondary actions ("Cancel", "Share").
 *   ghost     bare text for tertiary actions inside a card.
 *
 * Press state is a small scale plus a brightness shift, driven on the UI thread
 * by reanimated so it keeps up with the thumb even while the JS thread is busy
 * rendering a list.
 */

type Variant = "primary" | "glass" | "ghost";

export function GradientButton({
  label,
  onPress,
  variant = "primary",
  icon,
  iconRight,
  loading = false,
  disabled = false,
  size = "md",
  fullWidth = true,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: keyof typeof Ionicons.glyphMap;
  iconRight?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(makeStyles);
  const scale = useSharedValue(1);
  const pressed = useSharedValue(0);
  const inactive = disabled || loading;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: withTiming(inactive ? 0.55 : 1, { duration: 140 }),
  }));

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: pressed.value * 0.18,
  }));

  const heights = { sm: 40, md: 52, lg: 58 } as const;
  const fontSizes = { sm: 14, md: 16, lg: 17 } as const;

  const content = (
    <View style={[styles.content, { height: heights[size] }]}>
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? COLORS.contrast : COLORS.text} size="small" />
      ) : (
        <>
          {icon && (
            <Ionicons
              name={icon}
              size={fontSizes[size] + 2}
              color={variant === "primary" ? COLORS.contrast : COLORS.text}
            />
          )}
          <Text
            style={[
              styles.label,
              {
                fontSize: fontSizes[size],
                color: variant === "primary" ? COLORS.contrast : COLORS.text,
              },
            ]}
          >
            {label}
          </Text>
          {iconRight && (
            <Ionicons
              name={iconRight}
              size={fontSizes[size] + 2}
              color={variant === "primary" ? COLORS.contrast : COLORS.text}
            />
          )}
        </>
      )}
    </View>
  );

  return (
    <Animated.View
      style={[
        fullWidth && styles.fullWidth,
        style,
        animatedStyle,
        variant === "primary" && !inactive ? glow(COLORS.cyan, 16, 0.3) : undefined,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: inactive, busy: loading }}
        disabled={inactive}
        onPressIn={() => {
          scale.value = withSpring(0.97, { damping: 18, stiffness: 260 });
          pressed.value = withTiming(1, { duration: 120 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 16, stiffness: 220 });
          pressed.value = withTiming(0, { duration: 180 });
        }}
        onPress={() => {
          vibrate("tap");
          onPress();
        }}
      >
        {variant === "primary" ? (
          <LinearGradient
            colors={GRADIENT_COLORS}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.gradient}
          >
            <Animated.View style={[styles.overlay, overlayStyle]} />
            {content}
          </LinearGradient>
        ) : variant === "glass" ? (
          <BlurView intensity={GLASS.blurIntensity} tint="dark" style={styles.glass}>
            <Animated.View style={[styles.overlay, overlayStyle]} />
            {content}
          </BlurView>
        ) : (
          <View style={styles.ghost}>
            <Animated.View style={[styles.overlay, overlayStyle]} />
            {content}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

/**
 * A round icon button.
 *
 * Used for the header actions (back, bell, share) and the floating compose
 * button on the feed. `gradient` gives it the brand fill — which is what the
 * compose button uses, because creating a whisper is the app's primary action.
 */
export function IconButton({
  icon,
  onPress,
  gradient = false,
  size = 44,
  color,
  badge,
  disabled = false,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  gradient?: boolean;
  size?: number;
  color?: string;
  badge?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const styles = useStyles(makeStyles);
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const inner = (
    <View style={[styles.iconInner, { width: size, height: size, borderRadius: size / 2 }]}>
      <Ionicons
        name={icon}
        size={size * 0.45}
        color={gradient ? COLORS.contrast : color ?? COLORS.text}
      />
      {badge !== undefined && badge > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      )}
    </View>
  );

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label(icon)}
        disabled={disabled}
        onPressIn={() => {
          scale.value = withSpring(0.92, { damping: 16, stiffness: 300 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 14, stiffness: 240 });
        }}
        onPress={() => {
          vibrate("tap");
          onPress();
        }}
        style={disabled ? styles.disabled : undefined}
      >
        {gradient ? (
          <LinearGradient
            colors={GRADIENT_COLORS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: size / 2 }}
          >
            {inner}
          </LinearGradient>
        ) : (
          <BlurView intensity={GLASS.blurIntensity} tint="dark" style={{ borderRadius: size / 2 }}>
            {inner}
          </BlurView>
        )}
      </Pressable>
    </Animated.View>
  );
}

/** A readable accessibility label from an Ionicons name. */
function label(icon: keyof typeof Ionicons.glyphMap): string {
  return String(icon).replace(/-outline$/, "").replace(/-/g, " ");
}

const makeStyles = () => StyleSheet.create({
  fullWidth: { width: "100%" },
  gradient: {
    borderRadius: RADIUS.pill,
    overflow: "hidden",
    justifyContent: "center",
  },
  glass: {
    borderRadius: RADIUS.pill,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.55)",
    justifyContent: "center",
  },
  ghost: { justifyContent: "center" },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
  },
  label: { fontWeight: "800", letterSpacing: 0.2 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.text,
  },
  iconInner: { alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: COLORS.rose,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: COLORS.background,
  },
  badgeText: { color: COLORS.text, fontSize: 10, fontWeight: "900" },
  disabled: { opacity: 0.5 },
});

/** Motion helper for screens that need the same spring outside a button. */
export const pressSpring = { damping: 16, stiffness: 260, easing: Easing.out(Easing.cubic) };
