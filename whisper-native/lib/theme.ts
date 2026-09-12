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

/**
 * The palette, taken value-for-value from the site's dark token set.
 *
 * `app/globals.css` declares the dark palette on `:root` (and re-declares it on
 * `[data-surface="dark"]`); every name below maps onto one of those variables, so
 * a change there is a one-line change here. The site also ships a light palette —
 * this app deliberately has only the dark one, which is what the brief asks for.
 */
export const COLORS = {
  /**
   * Every screen. This is the one value that is NOT the site's: its `--theme-bg`
   * is `#000000`, and the brief pins this app to `#0a0814`. The two read
   * identically as "black" on a phone panel, and the darker-navy value is what
   * the whole app was built and checked against, so it stays.
   */
  background: "#0a0814",
  /** `--theme-surface` — a raised surface that is not glass. */
  surface: "#0a0a0c",
  /** `--theme-surface-solid` — the opaque counterpart, for menus over glass. */
  surfaceSolid: "#17171e",
  /** `--theme-card` — the card fill behind the glass. */
  card: "#111114",
  /** `--theme-elevated` — one step above the card. */
  elevated: "#17171c",
  /** `--theme-border`. */
  border: "#242429",
  /** `--theme-border-strong` — separators that need to be seen. */
  borderStrong: "#33333a",

  text: "#ffffff",
  /** `--theme-text-secondary` — body copy under a title. */
  muted: "#b3b3c0",
  /** `--theme-text-muted` — timestamps, action icons, placeholders. */
  subtle: "#7a7a8a",

  /** `--theme-accent-from`: the gradient's start. */
  cyan: "#22d3ee",
  /** `--theme-hover-purple` and `--theme-accent-to`: the gradient's end. */
  purple: "#a855f7",
  /** `--theme-accent-purple`: the flat accent (links, active chips). */
  violet: "#8b5cf6",
  /** `--theme-accent-pink`: the second accent, and the like's active colour. */
  pink: "#ec4899",
  /** `--theme-info`: the reply's active colour. */
  info: "#38bdf8",

  /** `--theme-success` / `--theme-warning` / `--theme-error`. */
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
  /**
   * The like's active colour. The site calls it `--theme-accent-pink`; the name
   * here is historical and the value is the site's.
   */
  rose: "#ec4899",
} as const;

/**
 * Text on a gradient control.
 *
 * The site uses `--theme-accent-contrast` (`#05050a`) on cyan→purple surfaces and
 * white on its purple→pink "premium" buttons. The brief asks for white, bold text
 * on every primary button, and white is also what keeps one rule true everywhere
 * — so the deviation is deliberate and this is where it is recorded.
 */
export const ON_GRADIENT = "#ffffff";

/** The purple→pink gradient the site reserves for its premium controls. */
export const GRADIENT_PREMIUM = ["#8b5cf6", "#ec4899"] as const;

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
  /**
   * The site builds glass out of a 155° white gradient over a translucent base:
   * `linear-gradient(155deg, rgba(255,255,255,.12), rgba(255,255,255,.04)),
   * rgba(15,15,21,.72)`. React Native cannot stack a gradient inside a BlurView's
   * own fill, so the base is what is carried here and the highlight is applied by
   * `GlassCard` as a top-edge sheen — the same two ingredients, in the two layers
   * the platform allows.
   */
  background: "rgba(15,15,21,0.72)",
  backgroundStrong: "rgba(17,17,24,0.82)",
  /** `--theme-glass-border`. */
  border: "rgba(255,255,255,0.14)",
  borderStrong: "rgba(255,255,255,0.18)",
  /** `--theme-glass-sheen`: the 1px highlight along the top edge. */
  sheen: "rgba(255,255,255,0.09)",
} as const;

/**
 * Corner radii — the site's `--radius-*` scale, one for one.
 *
 * The names line up (`md` is `--radius-md`), so a card that uses `RADIUS.xl`
 * here has the same 20px corner as a card using `--radius-xl` there.
 */
export const RADIUS = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
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

/**
 * Room to leave at the bottom of every scrollable tab screen.
 *
 * The tab bar floats over content rather than displacing it (see the tabs
 * layout), so a list that ends flush with the screen would end *under* the
 * glass. The bar is 68 points tall plus its insets padding, and 96 covers both
 * with room for the FABs that sit above it.
 */
export const TAB_BAR_SPACE = 96;
