import { Platform } from "react-native";

/**
 * The design system, in one place.
 *
 * Every screen background is `#0a0814`; every primary button is the cyan→purple
 * gradient; every card is a dark translucent pane over a blur. Those three
 * rules are the whole visual identity, so they are constants rather than values
 * typed into forty files.
 *
 * Numbers come from the web app's tokens (app/globals.css) where they exist —
 * the radii, the easings and the glass alphas are the same values, because the
 * two clients are supposed to look like one product.
 */

export const COLORS = {
  /** Every screen. No white screens anywhere in this app. */
  background: "#0a0814",
  /** A raised surface that is not glass (menus, inputs on top of glass). */
  surface: "#120e20",
  card: "#17122a",
  border: "#2a2340",

  text: "#ffffff",
  /** Secondary copy — the muted slate the web app uses for body text. */
  muted: "#94a3b8",
  /** Tertiary labels, timestamps, placeholders. */
  subtle: "#64748b",

  cyan: "#22d3ee",
  purple: "#a855f7",

  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
  rose: "#f43f5e",
} as const;

/** The only gradient in the app. Left → right, cyan → purple. */
export const GRADIENT = ["#22d3ee", "#a855f7"] as const;

/** Same gradient as `[start, end]` for callers that want the raw tuple. */
export const GRADIENT_COLORS: [string, string] = ["#22d3ee", "#a855f7"];

/** HORIZONTAL is `start={{x:0,y:0}} end={{x:1,y:0}}`. */
export const GRADIENT_START = { x: 0, y: 0.5 } as const;
export const GRADIENT_END = { x: 1, y: 0.5 } as const;

/**
 * Glass surfaces.
 *
 * `blurIntensity` is passed to expo-blur's BlurView. 40 is the value the brief
 * specifies and it is also the point where a dark pane still reads as glass
 * rather than as a solid card: high enough to frost what is behind it, low
 * enough that the gradient wash underneath still shows through.
 */
export const GLASS = {
  blurIntensity: 40,
  tint: "dark" as const,
  /** Fill over the blur. */
  background: "rgba(23,18,42,0.55)",
  backgroundStrong: "rgba(23,18,42,0.78)",
  border: "rgba(255,255,255,0.12)",
  borderStrong: "rgba(255,255,255,0.18)",
} as const;

/** Corner radii. The brief's 16–24px range, extended for sheets and pills. */
export const RADIUS = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 28,
  pill: 999,
} as const;

/** Motion. Mirrors lib/motion.ts on the web side. */
export const MOTION = {
  instant: 110,
  fast: 170,
  base: 260,
  slow: 420,
  slower: 640,
} as const;

/**
 * A soft glow for gradient elements.
 *
 * React Native has no coloured box-shadow on Android below API 28 and no
 * `color-mix`, so the glow is expressed as elevation-plus-shadow on iOS and as
 * a plain elevation on Android. Screens never depend on it for legibility —
 * it is depth, not contrast.
 */
export function glow(color: string = COLORS.cyan, radius = 18, opacity = 0.35) {
  return Platform.select({
    ios: {
      shadowColor: color,
      shadowOpacity: opacity,
      shadowRadius: radius,
      shadowOffset: { width: 0, height: 8 },
    },
    android: { elevation: 6 },
    default: {},
  });
}

/** The standard card shadow for non-glass surfaces. */
export const CARD_SHADOW = Platform.select({
  ios: {
    shadowColor: "#000000",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  android: { elevation: 4 },
  default: {},
});
