import { BlurView } from "expo-blur";
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { GLASS, RADIUS } from "@/lib/theme";

/**
 * The glass card.
 *
 * `BlurView` with `tint="dark"` and `intensity={40}` — the brief's numbers, and
 * also the combination that reads as glass rather than as a translucent slab:
 * the frost does the work, the alpha only tints it.
 *
 * WHY THERE IS ALWAYS A FILL UNDER THE BLUR
 *
 * A BlurView with no background is legible on a busy screen and invisible on a
 * flat one — and this app's screens are flat dark by design. The translucent
 * purple fill is what gives the panel its body; the blur is what makes content
 * scrolling behind it (the feed, a sheet's backdrop) register as depth. On
 * Android, where `BlurView`'s experimental blur can be unsupported on older
 * devices, the fill alone still produces a correct card rather than a hole.
 */
export function GlassCard({
  children,
  style,
  strong = false,
  radius = RADIUS.xl,
  padded = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Higher-opacity variant — use when text sits directly on the panel. */
  strong?: boolean;
  radius?: number;
  padded?: boolean;
}) {
  return (
    <View style={[styles.shadow, { borderRadius: radius }, style]}>
      <BlurView
        intensity={GLASS.blurIntensity}
        tint="dark"
        style={[
          styles.blur,
          {
            borderRadius: radius,
            backgroundColor: strong ? GLASS.backgroundStrong : GLASS.background,
            borderColor: strong ? GLASS.borderStrong : GLASS.border,
          },
        ]}
      >
        <View style={padded ? styles.padded : undefined}>{children}</View>
      </BlurView>
    </View>
  );
}

/** A lighter-weight glass strip for rows, inputs and chrome. */
export function GlassRow({
  children,
  style,
  radius = RADIUS.lg,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
}) {
  return (
    <BlurView
      intensity={GLASS.blurIntensity}
      tint="dark"
      style={[
        styles.blur,
        {
          borderRadius: radius,
          backgroundColor: "rgba(23,18,42,0.5)",
          borderColor: GLASS.border,
        },
        style,
      ]}
    >
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: "#000000",
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  blur: {
    borderWidth: 1,
    overflow: "hidden",
  },
  padded: { padding: 16 },
});
