import Svg, { Circle, Defs, G, Line, Path, Pattern, Rect } from "react-native-svg";
import { StyleSheet, View } from "react-native";

import { DOODLES, useStyles } from "@/lib/theme";

/**
 * The tiled doodle wallpaper behind the chat thread — the native port of the
 * web app's `components/ChatDoodleBackground.tsx`, path for path.
 *
 * The web renders an inline SVG `<pattern>` (240×240, `userSpaceOnUse`) so the
 * strokes inherit `currentColor`; this port draws the same eight motifs —
 * ghost, heart, star, chat bubble, moon, diamond, sparkle, butterfly — with
 * the same transforms inside the same tile, repeated across the canvas. Stroke
 * colour and opacity come from the active theme's doodle palette (the web's
 * `.chat-doodles`: white @ 0.2 in dark, accent purple @ 0.13 in light), and
 * the two soft glows sit over the tile so the wallpaper is not a flat repeat.
 *
 * It is `pointerEvents="none"` and absolute behind the list: decoration that
 * can never intercept a touch or compete with message text.
 */
export default function ChatDoodleBackground() {
  const styles = useStyles(makeStyles);

  return (
    <View
      pointerEvents="none"
      style={styles.root}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg style={styles.tile}>
        <Defs>
          <Pattern id="chat-doodles" patternUnits="userSpaceOnUse" width={240} height={240}>
            <G fill="none" stroke={DOODLES.color} strokeWidth={2}>
              {/* Ghost */}
              <Path
                transform="translate(10,10) rotate(-12) scale(0.8)"
                d="M20 4C12.268 4 6 10.268 6 18v14l4-3 4 3 4-3 4 3 4-3 4 3V18C30 10.268 23.732 4 20 4z"
              />
              <Circle cx="23" cy="21.5" r="1.6" fill={DOODLES.color} />
              <Circle cx="33" cy="21.5" r="1.6" fill={DOODLES.color} />

              {/* Heart */}
              <Path
                transform="translate(150,20) rotate(10) scale(0.8)"
                d="M20 34s-14-9-14-19a8 8 0 0116 0 8 8 0 0116 0c0 10-14 19-14 19l-4-3z"
              />

              {/* Star */}
              <Path
                transform="translate(40,120) rotate(-18) scale(0.75)"
                d="M20 4l4 12h12l-10 7 4 12-10-7-10 7 4-12L4 16h12z"
              />

              {/* Chat bubble */}
              <G transform="translate(150,130) rotate(8) scale(0.75)">
                <Rect x="4" y="6" width="32" height="22" rx="6" />
                <Path d="M12 28l-6 6V28" />
                <Line x1="12" y1="15" x2="28" y2="15" strokeLinecap="round" />
                <Line x1="12" y1="21" x2="22" y2="21" strokeLinecap="round" />
              </G>

              {/* Moon */}
              <Path
                transform="translate(90,70) rotate(-8) scale(0.7)"
                d="M28 20a12 12 0 01-16-16 14 14 0 1016 16z"
              />

              {/* Diamond */}
              <Path
                transform="translate(190,180) rotate(15) scale(0.7)"
                d="M20 4l16 14-16 18L4 18z M4 18h32"
              />

              {/* Sparkle */}
              <Path
                transform="translate(10,180) rotate(20) scale(0.65)"
                d="M20 4v32M4 20h32M8 8l24 24M32 8L8 32"
                strokeLinecap="round"
              />

              {/* Butterfly */}
              <G transform="translate(90,190) rotate(-10) scale(0.65)">
                <Path d="M20 20C14 14 4 8 4 16c0 6 8 8 16 4" strokeLinecap="round" />
                <Path d="M20 20c6-6 16-12 16-4 0 6-8 8-16 4" strokeLinecap="round" />
                <Path d="M20 20C14 26 4 32 4 24c0-6 8-8 16-4" strokeLinecap="round" />
                <Path d="M20 20c6 6 16 12 16 4 0-6-8-8-16-4" strokeLinecap="round" />
              </G>
            </G>
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#chat-doodles)" />
      </Svg>

      {/* Soft accents over the tile — `.chat-doodles-glow`, per theme. */}
      <View pointerEvents="none" style={[styles.glowA, { backgroundColor: DOODLES.glowA }]} />
      <View pointerEvents="none" style={[styles.glowB, { backgroundColor: DOODLES.glowB }]} />
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    root: {
      ...StyleSheet.absoluteFillObject,
      opacity: DOODLES.opacity,
    },
    tile: { ...StyleSheet.absoluteFillObject },
    glowA: {
      position: "absolute",
      top: 0,
      left: 0,
      width: "55%",
      height: "40%",
    },
    glowB: {
      position: "absolute",
      bottom: 0,
      right: 0,
      width: "45%",
      height: "35%",
    },
  });
