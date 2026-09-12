import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { vibrate } from "@/lib/haptics";
import { SPRINGS } from "@/lib/theme";

/**
 * The floating action button's behaviour, from the web app's
 * `components/feed/FeedFab.tsx`: it arrives at {opacity:0, scale:0.6} and
 * springs to full on `spring.snappy` (520/34/.7), dips to 0.92 under the
 * finger (`whileTap`), and shrinks to 0.85 when the surface it belongs to is
 * covered. The visuals stay with the caller — this carries only the motion.
 */
export function FabButton({
  children,
  onPress,
  style,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
}) {
  const press = useSharedValue(1);

  const styleAnim = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  return (
    <Animated.View entering={FadeIn.springify().stiffness(520).damping(34).mass(0.7)} style={style}>
      <Pressable
        onPress={() => {
          vibrate("select");
          onPress();
        }}
        onPressIn={() => {
          press.value = withSpring(0.92, SPRINGS.snappy);
        }}
        onPressOut={() => {
          press.value = withSpring(1, SPRINGS.snappy);
        }}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <Animated.View style={styleAnim}>{children}</Animated.View>
      </Pressable>
    </Animated.View>
  );
}
