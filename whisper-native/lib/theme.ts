import { useMemo, useSyncExternalStore } from "react";
import { Platform } from "react-native";

/**
 * The design system, in one place.
 *
 * Every screen background is `#000000` in dark — the web's own `--theme-bg`,
 * value for value — and `#f2f4fb` in light, the web's tinted canvas. Every
 * primary button is the accent gradient; every card is a dark translucent pane
 * over a blur. Those three rules are the whole visual identity, so they are
 * constants rather than values typed into forty files.
 *
 * THE TWO PALETTES
 *
 * The web declares the dark palette on `:root` and re-declares every token
 * under `:root[data-theme="light"]` (globals.css). This file is the same
 * arrangement, translated: one `Palette` interface, two exact copies of the
 * web's values, and exports that always point at the active one. Components
 * read `COLORS.text`, `FILLS[1]`, `CHAT.canvas` exactly as before — the theme
 * provider swaps what those names resolve to, re-renders every mounted screen
 * through `useStyles`, and the app changes clothes in one frame, like the site.
 *
 * StyleSheet constants are therefore NOT module-level snapshots: a style block
 * is built by a `makeStyles()` factory and read through `useStyles(makeStyles)`
 * (below), which re-runs the factory only when the palette version changes.
 */

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

/** The colour tokens — the web's `--theme-*` variables, camelCased. */
export interface ThemeColors {
  background: string;
  surface: string;
  surfaceSolid: string;
  card: string;
  elevated: string;
  border: string;
  borderStrong: string;

  text: string;
  muted: string;
  subtle: string;

  cyan: string;
  purple: string;
  violet: string;
  pink: string;
  info: string;

  success: string;
  warning: string;
  danger: string;
  rose: string;
  hoverPink: string;
  contrast: string;

  /* Tailwind-standard colours the web's components reach for directly. */
  green400: string;
  emerald500: string;
  teal300: string;
  amber400: string;
  sky500: string;
  indigo500: string;
}

/** The chat surface tokens — `--chat-*` in globals.css, per theme. */
export interface ChatColors {
  canvas: string;
  bubbleIn: string;
  bubbleInBorder: string;
  bubbleOut: string;
  bubbleOutBorder: string;
  bubbleText: string;
  meta: string;
  chrome: string;
  chromeBorder: string;
  field: string;
  recordingBg: string;
  ctrl: string;
  ctrlText: string;
  danger: string;
  dangerSoft: string;
  icon: string;
  iconHover: string;
  chip: string;
  chipText: string;
  quoteBg: string;
  quoteText: string;
}

export interface Palette {
  id: "dark" | "light";
  colors: ThemeColors;
  chat: ChatColors;
  /** `--fill-1` … `--fill-4`, the site's stepped overlays. */
  fills: Record<1 | 2 | 3 | 4, string>;
  /** `--hairline`. */
  hairline: string;
  /** The tab bar / nav surface (`--theme-nav-*`). */
  nav: { gloss: string; solid: string; border: string; inactive: string };
  /** The glass film (`--theme-glass*`). */
  glass: {
    background: string;
    backgroundStrong: string;
    border: string;
    borderStrong: string;
    sheen: string;
    /** expo-blur intensity and tint — how the film is rendered natively. */
    blurIntensity: number;
    tint: "dark" | "light";
  };
  /** The hero's ambient blobs (`--theme-blob-*` + `--grid-line`). */
  blobs: { 1: string; 2: string; 3: string; gridLine: string; alpha: number };
  /** The accent gradient (`--theme-accent-from` → `--theme-accent-to`). */
  gradient: [string, string];
  /** The premium gradient (`accent-purple` → `accent-pink`). */
  gradientPremium: [string, string];
  /** The doodle wallpaper behind chat threads (`.chat-doodles*`). */
  doodles: { color: string; opacity: number; glowA: string; glowB: string };
}

/* ------------------------------------------------------------------ */
/* DARK — `:root` in globals.css, value for value                     */
/* ------------------------------------------------------------------ */

export const DARK: Palette = {
  id: "dark",
  colors: {
    background: "#000000",
    surface: "#0a0a0c",
    surfaceSolid: "#17171e",
    card: "#111114",
    elevated: "#17171c",
    border: "#242429",
    borderStrong: "#33333a",

    text: "#ffffff",
    muted: "#b3b3c0",
    subtle: "#7a7a8a",

    cyan: "#22d3ee",
    purple: "#a855f7",
    violet: "#8b5cf6",
    pink: "#ec4899",
    info: "#38bdf8",

    success: "#22c55e",
    warning: "#f59e0b",
    danger: "#ef4444",
    rose: "#ec4899",
    hoverPink: "#f472b6",
    contrast: "#05050a",

    green400: "#4ade80",
    emerald500: "#10b981",
    teal300: "#6ee7b7",
    amber400: "#fbbf24",
    sky500: "#0ea5e9",
    indigo500: "#6366f1",
  },
  chat: {
    canvas: "#08080f",
    bubbleIn: "#191922",
    bubbleInBorder: "rgba(255,255,255,0.07)",
    bubbleOut: "#2a2142",
    bubbleOutBorder: "rgba(168,85,247,0.22)",
    bubbleText: "#f1f1f6",
    meta: "#8b8b9c",
    chrome: "rgba(13,13,19,0.82)",
    chromeBorder: "rgba(255,255,255,0.08)",
    field: "rgba(255,255,255,0.05)",
    recordingBg: "#1a1a24",
    ctrl: "rgba(255,255,255,0.07)",
    ctrlText: "#d8d8e4",
    danger: "#f4566d",
    dangerSoft: "rgba(244,63,94,0.16)",
    icon: "#9797aa",
    iconHover: "rgba(255,255,255,0.09)",
    chip: "rgba(18,18,26,0.88)",
    chipText: "#b6b6c6",
    quoteBg: "rgba(255,255,255,0.06)",
    quoteText: "#b3b3c0",
  },
  fills: {
    1: "rgba(255,255,255,0.04)",
    2: "rgba(255,255,255,0.07)",
    3: "rgba(255,255,255,0.11)",
    4: "rgba(255,255,255,0.16)",
  },
  hairline: "rgba(255,255,255,0.1)",
  nav: {
    gloss: "rgba(13,13,19,0.86)",
    solid: "#0b0b11",
    border: "rgba(255,255,255,0.13)",
    inactive: "#7a7a8a",
  },
  glass: {
    background: "rgba(15,15,21,0.72)",
    backgroundStrong: "rgba(17,17,24,0.82)",
    border: "rgba(255,255,255,0.14)",
    borderStrong: "rgba(255,255,255,0.18)",
    sheen: "rgba(255,255,255,0.09)",
    blurIntensity: 40,
    tint: "dark",
  },
  blobs: {
    1: "rgba(139,92,246,0.5)",
    2: "rgba(34,211,238,0.34)",
    3: "rgba(236,72,153,0.32)",
    gridLine: "rgba(255,255,255,0.16)",
    alpha: 0.55,
  },
  gradient: ["#22d3ee", "#a855f7"],
  gradientPremium: ["#8b5cf6", "#ec4899"],
  doodles: {
    color: "#ffffff",
    opacity: 0.2,
    glowA: "rgba(255,255,255,0.04)",
    glowB: "rgba(34,211,238,0.05)",
  },
};

/* ------------------------------------------------------------------ */
/* LIGHT — `:root[data-theme="light"]` in globals.css, value for value */
/* ------------------------------------------------------------------ */

export const LIGHT: Palette = {
  id: "light",
  colors: {
    background: "#f2f4fb",
    surface: "#f8f9fd",
    surfaceSolid: "#ffffff",
    card: "#ffffff",
    elevated: "#ffffff",
    border: "#e3e6f2",
    borderStrong: "#cfd4e8",

    text: "#16172c",
    muted: "#4b5273",
    subtle: "#767d9d",

    cyan: "#6d3fe0",
    purple: "#2563eb",
    violet: "#6d3fe0",
    pink: "#d33d92",
    info: "#0d74d4",

    success: "#12a150",
    warning: "#c2620a",
    danger: "#d92d20",
    rose: "#d33d92",
    hoverPink: "#bd2f7f",
    contrast: "#ffffff",

    green400: "#12a150",
    emerald500: "#12a150",
    teal300: "#0d74d4",
    amber400: "#c2620a",
    sky500: "#0d74d4",
    indigo500: "#6d3fe0",
  },
  chat: {
    canvas: "#ebe9f5",
    bubbleIn: "#ffffff",
    bubbleInBorder: "rgba(22,23,44,0.05)",
    bubbleOut: "#e5ddfb",
    bubbleOutBorder: "rgba(109,63,224,0.14)",
    bubbleText: "#16172c",
    meta: "#767d9d",
    chrome: "rgba(255,255,255,0.86)",
    chromeBorder: "rgba(22,23,44,0.08)",
    field: "#ffffff",
    recordingBg: "#ffffff",
    ctrl: "rgba(22,23,44,0.055)",
    ctrlText: "#3c4262",
    danger: "#e11d48",
    dangerSoft: "rgba(225,29,72,0.10)",
    icon: "#5f6684",
    iconHover: "rgba(22,23,44,0.06)",
    chip: "rgba(255,255,255,0.92)",
    chipText: "#5f6684",
    quoteBg: "rgba(109,63,224,0.07)",
    quoteText: "#4b5273",
  },
  fills: {
    1: "rgba(22,23,44,0.035)",
    2: "rgba(22,23,44,0.06)",
    3: "rgba(22,23,44,0.09)",
    4: "rgba(22,23,44,0.13)",
  },
  hairline: "rgba(22,23,44,0.1)",
  nav: {
    gloss: "rgba(255,255,255,0.91)",
    solid: "#f8f9fd",
    border: "rgba(22,23,44,0.1)",
    inactive: "#6a7192",
  },
  glass: {
    background: "rgba(255,255,255,0.72)",
    backgroundStrong: "rgba(255,255,255,0.84)",
    border: "rgba(22,23,44,0.11)",
    borderStrong: "rgba(22,23,44,0.15)",
    sheen: "rgba(255,255,255,0.95)",
    blurIntensity: 40,
    tint: "light",
  },
  blobs: {
    1: "rgba(124,82,232,0.2)",
    2: "rgba(56,160,235,0.16)",
    3: "rgba(224,108,176,0.15)",
    gridLine: "rgba(38,43,90,0.1)",
    alpha: 0.55,
  },
  gradient: ["#6d3fe0", "#2563eb"],
  gradientPremium: ["#6d3fe0", "#d33d92"],
  doodles: {
    color: "#6d3fe0",
    opacity: 0.13,
    glowA: "rgba(109,63,224,0.08)",
    glowB: "rgba(211,61,146,0.07)",
  },
};

/* ------------------------------------------------------------------ */
/* The live exports                                                   */
/* ------------------------------------------------------------------ */

/**
 * The active palette. Do not snapshot these exports at module scope — read
 * them at render time (directly in JSX props, or inside a `makeStyles`
 * factory invoked through `useStyles`), so a theme switch is picked up.
 */
export let COLORS: ThemeColors = DARK.colors;
export let CHAT: ChatColors = DARK.chat;
export let FILLS: Palette["fills"] = DARK.fills;
export let HAIRLINE: string = DARK.hairline;
export let NAV: Palette["nav"] = DARK.nav;
export let GLASS: Palette["glass"] = { ...DARK.glass, blurIntensity: 40, tint: "dark" };
export let BLOBS: Palette["blobs"] = DARK.blobs;
/** The chat thread's doodle wallpaper (`.chat-doodles` in globals.css). */
export let DOODLES: Palette["doodles"] = DARK.doodles;

/** The accent gradient, `[from, to]`. */
export let GRADIENT_COLORS: [string, string] = DARK.gradient;
/** Same gradient as a plain tuple for `expo-linear-gradient`'s `colors`. */
export let GRADIENT: readonly [string, string] = DARK.gradient;
/** HORIZONTAL is `start={{x:0,y:0.5}} end={{x:1,y:0.5}}` — left to right, as the site's. */
export const GRADIENT_START = { x: 0, y: 0.5 } as const;
export const GRADIENT_END = { x: 1, y: 0.5 } as const;
/** The purple→pink gradient the site reserves for its premium controls. */
export let GRADIENT_PREMIUM: readonly [string, string] = DARK.gradientPremium;

/**
 * Text on a gradient control. White, bold — which is also the site's own
 * choice: `.premium-button-primary` sets `color: #ffffff` in both themes.
 */
export const ON_GRADIENT = "#ffffff";

/* ------------------------------------------------------------------ */
/* Palette switching                                                  */
/* ------------------------------------------------------------------ */

type Listener = () => void;
const listeners = new Set<Listener>();

/** Monotonic version of the active palette; the `useStyles` dependency. */
let paletteVersion = 0;

export function subscribePalette(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPaletteVersion(): number {
  return paletteVersion;
}

/** Point every live export at `palette` and re-render the subscribers. */
export function applyPalette(palette: Palette): void {
  COLORS = palette.colors;
  CHAT = palette.chat;
  FILLS = palette.fills;
  HAIRLINE = palette.hairline;
  NAV = palette.nav;
  GLASS = { ...palette.glass, blurIntensity: 40, tint: palette.id === "dark" ? "dark" : "light" };
  BLOBS = palette.blobs;
  DOODLES = palette.doodles;
  GRADIENT_COLORS = palette.gradient;
  GRADIENT = palette.gradient;
  GRADIENT_PREMIUM = palette.gradientPremium;
  CARD_SHADOW = Platform.select({
    ios: {
      shadowColor: palette.id === "dark" ? "#000000" : "#262b5a",
      shadowOpacity: 0.45,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
    },
    android: { elevation: 4 },
    default: {},
  });
  paletteVersion += 1;
  for (const listener of [...listeners]) listener();
}

/* ------------------------------------------------------------------ */
/* Hooks                                                              */
/* ------------------------------------------------------------------ */

/**
 * Themed styles: `const styles = useStyles(makeStyles);`
 *
 * Subscribes the component to palette changes and memoises the built sheet
 * per version, so a factory runs once per theme, not once per render.
 */
export function useStyles<T>(make: () => T): T {
  const version = useSyncExternalStore(subscribePalette, getPaletteVersion, getPaletteVersion);
  return useMemo(() => make(), [make, version]);
}

/* ------------------------------------------------------------------ */
/* Theme-independent constants                                        */
/* ------------------------------------------------------------------ */

/**
 * Corner radii — the site's `--radius-*` scale, one for one.
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
  /** The stagger step between items in an entering group. */
  stagger: 55,
  /** The hero's slower per-word stagger. */
  staggerHero: 75,
} as const;

/** CSS easing curves from lib/motion.ts, as Reanimated beziers. */
export const EASINGS = {
  /** `--ease-out-quint` — the default enter. */
  outQuint: [0.22, 1, 0.36, 1] as [number, number, number, number],
  /** `--ease-out-expo` — headings, hero lines. */
  outExpo: [0.16, 1, 0.3, 1] as [number, number, number, number],
  /** `--ease-soft` — exits and crossfades. */
  soft: [0.65, 0, 0.35, 1] as [number, number, number, number],
} as const;

/** Springs from lib/motion.ts (`stiffness / damping / mass`). */
export const SPRINGS = {
  snappy: { stiffness: 520, damping: 34, mass: 0.7 },
  smooth: { stiffness: 320, damping: 32, mass: 0.9 },
  gentle: { stiffness: 220, damping: 30, mass: 1 },
  bouncy: { stiffness: 480, damping: 18, mass: 0.8 },
  gesture: { stiffness: 500, damping: 40, mass: 0.8 },
} as const;

/**
 * A soft glow for gradient elements — read at call time, so it follows the
 * active palette's accent.
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

/**
 * The standard card shadow for non-glass surfaces. The web tints light-theme
 * shadows cool (`rgba(38,43,90,…)`, "neutral grey on a tinted canvas reads as
 * dirt") — this carries that rule.
 */
export let CARD_SHADOW = Platform.select({
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
 */
export const TAB_BAR_SPACE = 96;
