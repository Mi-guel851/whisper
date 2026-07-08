export type ThemeId = "midnight" | "pinkBlack" | "ngl";

export type Theme = {
  id: ThemeId;
  name: string;
  bgFrom: string;
  bgVia: string;
  bgTo: string;
  blob1: string;
  blob2: string;
  blob3: string;
  accentFrom: string;
  accentTo: string;
  accentText: string;
  accentContrast: string;
  surface: string;
  surfaceStrong: string;
  surfaceMuted: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  divider: string;
  shadow: string;
  navBg: string;
  navBorder: string;
  navShadow: string;
  navInactive: string;
  navActiveText: string;
  navPress: string;
  swatch: [string, string, string];
};

export const themes: Record<ThemeId, Theme> = {
  midnight: {
    id: "midnight",
    name: "Aurora Midnight",
    bgFrom: "#15062d",
    bgVia: "#241052",
    bgTo: "#041d34",
    blob1: "rgba(34, 211, 238, 0.32)",
    blob2: "rgba(168, 85, 247, 0.34)",
    blob3: "rgba(244, 114, 182, 0.18)",
    accentFrom: "#c084fc",
    accentTo: "#22d3ee",
    accentText: "#f0e7ff",
    accentContrast: "#08111f",
    surface: "rgba(255, 255, 255, 0.10)",
    surfaceStrong: "rgba(255, 255, 255, 0.16)",
    surfaceMuted: "rgba(255, 255, 255, 0.07)",
    border: "rgba(255, 255, 255, 0.16)",
    borderStrong: "rgba(255, 255, 255, 0.32)",
    text: "#ffffff",
    textMuted: "#d8cdf7",
    textSubtle: "#a89bc5",
    divider: "rgba(255, 255, 255, 0.10)",
    shadow: "0 24px 70px rgba(4, 7, 31, 0.52)",
    navBg: "rgba(17, 9, 44, 0.82)",
    navBorder: "rgba(255, 255, 255, 0.18)",
    navShadow: "0 -18px 60px rgba(34, 211, 238, 0.16), 0 -8px 30px rgba(0, 0, 0, 0.42)",
    navInactive: "#b8acd5",
    navActiveText: "#ffffff",
    navPress: "rgba(255, 255, 255, 0.14)",
    swatch: ["#241052", "#c084fc", "#22d3ee"],
  },
  pinkBlack: {
    id: "pinkBlack",
    name: "Neon Rose",
    bgFrom: "#210313",
    bgVia: "#4a0d2f",
    bgTo: "#160719",
    blob1: "rgba(236, 72, 153, 0.36)",
    blob2: "rgba(251, 113, 133, 0.30)",
    blob3: "rgba(244, 114, 182, 0.20)",
    accentFrom: "#fb7185",
    accentTo: "#f9a8d4",
    accentText: "#ffe4f1",
    accentContrast: "#220411",
    surface: "rgba(255, 255, 255, 0.11)",
    surfaceStrong: "rgba(255, 255, 255, 0.17)",
    surfaceMuted: "rgba(255, 255, 255, 0.075)",
    border: "rgba(255, 228, 241, 0.18)",
    borderStrong: "rgba(255, 228, 241, 0.34)",
    text: "#ffffff",
    textMuted: "#ffd1e5",
    textSubtle: "#d9a3bd",
    divider: "rgba(255, 228, 241, 0.11)",
    shadow: "0 24px 70px rgba(74, 13, 47, 0.46)",
    navBg: "rgba(42, 5, 25, 0.84)",
    navBorder: "rgba(255, 228, 241, 0.20)",
    navShadow: "0 -18px 60px rgba(236, 72, 153, 0.20), 0 -8px 30px rgba(0, 0, 0, 0.42)",
    navInactive: "#e7b8cc",
    navActiveText: "#ffffff",
    navPress: "rgba(255, 228, 241, 0.15)",
    swatch: ["#4a0d2f", "#fb7185", "#f9a8d4"],
  },
  ngl: {
    id: "ngl",
    name: "Golden Glow",
    bgFrom: "#2b2100",
    bgVia: "#5a4200",
    bgTo: "#111407",
    blob1: "rgba(250, 204, 21, 0.38)",
    blob2: "rgba(251, 146, 60, 0.26)",
    blob3: "rgba(254, 240, 138, 0.18)",
    accentFrom: "#facc15",
    accentTo: "#fde68a",
    accentText: "#fff7c2",
    accentContrast: "#211900",
    surface: "rgba(255, 255, 255, 0.12)",
    surfaceStrong: "rgba(255, 255, 255, 0.18)",
    surfaceMuted: "rgba(255, 255, 255, 0.08)",
    border: "rgba(254, 240, 138, 0.20)",
    borderStrong: "rgba(254, 240, 138, 0.36)",
    text: "#ffffff",
    textMuted: "#fff0ad",
    textSubtle: "#dbc477",
    divider: "rgba(254, 240, 138, 0.12)",
    shadow: "0 24px 70px rgba(90, 66, 0, 0.42)",
    navBg: "rgba(45, 34, 3, 0.84)",
    navBorder: "rgba(254, 240, 138, 0.22)",
    navShadow: "0 -18px 60px rgba(250, 204, 21, 0.20), 0 -8px 30px rgba(0, 0, 0, 0.40)",
    navInactive: "#e9d68b",
    navActiveText: "#ffffff",
    navPress: "rgba(254, 240, 138, 0.16)",
    swatch: ["#5a4200", "#facc15", "#fde68a"],
  },
};

export const themeList = Object.values(themes);
