export type BackgroundThemeId = "darkAsh" | "milkyWhite";
export type AccentColorId = "lightPurple" | "peach" | "lightGold";

export type ThemeId = BackgroundThemeId;

export type BackgroundTheme = {
  id: BackgroundThemeId;
  name: string;
  colors: {
    background: string;
    surface: string;
    surfaceSecondary: string;
    card: string;
    border: string;
    input: string;
    inputBorder: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    shadow: string;
    overlay: string;
  };
  swatch: [string, string, string];
};

export type AccentColor = {
  id: AccentColorId;
  name: string;
  color: string;
  contrast: string;
};

export type Theme = BackgroundTheme & {
  accent: AccentColor;
  colors: BackgroundTheme["colors"] & {
    accent: string;
    accentSoft: string;
    accentStrong: string;
    accentContrast: string;
    icon: string;
    success: string;
    warning: string;
    error: string;
    notification: string;
  };
};

export const backgroundThemes: Record<BackgroundThemeId, BackgroundTheme> = {
  darkAsh: {
    id: "darkAsh",
    name: "Dark Ash",
    colors: {
      background: "#161616",
      surface: "#202020",
      surfaceSecondary: "#242424",
      card: "#2A2A2A",
      border: "#363636",
      input: "#303030",
      inputBorder: "#464646",
      textPrimary: "#FFFFFF",
      textSecondary: "#D8D8D8",
      textMuted: "#9A9A9A",
      shadow: "0 24px 70px rgba(0, 0, 0, 0.45)",
      overlay: "rgba(0, 0, 0, 0.72)",
    },
    swatch: ["#161616", "#202020", "#2A2A2A"],
  },
  milkyWhite: {
    id: "milkyWhite",
    name: "Milky White",
    colors: {
      background: "#F7F6F4",
      surface: "#ECE9E5",
      surfaceSecondary: "#F0EEEA",
      card: "#FFFFFF",
      border: "#D6D2CC",
      input: "#EFECE7",
      inputBorder: "#C9C3BA",
      textPrimary: "#191817",
      textSecondary: "#4C4945",
      textMuted: "#77716A",
      shadow: "0 24px 70px rgba(60, 48, 36, 0.14)",
      overlay: "rgba(25, 24, 23, 0.42)",
    },
    swatch: ["#F7F6F4", "#FFFFFF", "#ECE9E5"],
  },
};

export const accentColors: Record<AccentColorId, AccentColor> = {
  lightPurple: { id: "lightPurple", name: "Light Purple", color: "#B38CFF", contrast: "#160A2C" },
  peach: { id: "peach", name: "Peach", color: "#FFB58C", contrast: "#2B1306" },
  lightGold: { id: "lightGold", name: "Light Gold", color: "#F2D16B", contrast: "#241B00" },
};

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  const bigint = Number.parseInt(value, 16);
  return `${(bigint >> 16) & 255} ${(bigint >> 8) & 255} ${bigint & 255}`;
}

export function createTheme(backgroundId: BackgroundThemeId, accentId: AccentColorId): Theme {
  const background = backgroundThemes[backgroundId];
  const accent = accentColors[accentId];
  const accentRgb = hexToRgb(accent.color);

  return {
    ...background,
    accent,
    colors: {
      ...background.colors,
      accent: accent.color,
      accentSoft: `rgb(${accentRgb} / 0.16)`,
      accentStrong: `rgb(${accentRgb} / 0.28)`,
      accentContrast: accent.contrast,
      icon: accent.color,
      success: "#3DDC97",
      warning: "#F2D16B",
      error: "#FF6B7A",
      notification: accent.color,
    },
  };
}

export const defaultBackgroundThemeId: BackgroundThemeId = "darkAsh";
export const defaultAccentColorId: AccentColorId = "lightPurple";
export const backgroundThemeList = Object.values(backgroundThemes);
export const accentColorList = Object.values(accentColors);
export const themes = backgroundThemes;
export const themeList = backgroundThemeList;
