import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";

import { GRADIENT_COLORS, useStyles } from "@/lib/theme";

/**
 * Gradient text — the wordmark, and the big numbers on the coin balance.
 *
 * `MaskedView` draws its children through its `maskElement`, so the trick is
 * simple: a gradient fills the space, and the text is the hole it shines
 * through. This is the same cyan→purple the buttons use, so the logo and the
 * primary action are visibly the same material.
 *
 * `AndroidRenderingMode="software"` is required: the hardware path on Android
 * cannot render the mask without a texture round trip, and the result on device
 * is text that is either invisible or one frame stale. The software path is
 * slower and entirely correct, which for a wordmark appearing once per screen is
 * the right trade.
 */
export function GradientText({
  children,
  style,
  colors = GRADIENT_COLORS,
  numberOfLines,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
  colors?: readonly [string, string];
  numberOfLines?: number;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View>
      <MaskedView
        maskElement={
          <Text style={[styles.text, style]} numberOfLines={numberOfLines}>
            {children}
          </Text>
        }
        androidRenderingMode="software"
      >
        {/* The gradient must cover the text's own measurements, so it inherits
            them from the mask rather than being sized independently. */}
        <LinearGradient
          colors={[colors[0], colors[1]]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
        >
          <Text style={[styles.text, style, styles.invisible]} numberOfLines={numberOfLines}>
            {children}
          </Text>
        </LinearGradient>
      </MaskedView>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  text: { fontWeight: "800", letterSpacing: -0.5 },
  /* Keeps the layout identical between mask and fill; the fill's own glyphs are
     never seen, only the gradient showing through the mask. */
  invisible: { opacity: 0 },
});
