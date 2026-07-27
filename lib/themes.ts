export type ThemeId = "system" | "light" | "dark";
export type ResolvedThemeId = "light" | "dark";

export type Theme = {
  id: ThemeId;
  name: string;
  swatch: [string, string, string];
};

export const themes: Record<ThemeId, Theme> = {
  system: {
    id: "system",
    name: "System",
    swatch: ["#FFFFFF", "#8B5CF6", "#000000"],
  },
  light: {
    id: "light",
    name: "Light",
    swatch: ["#FFFFFF", "#F5F5F5", "#EC4899"],
  },
  dark: {
    id: "dark",
    name: "Dark",
    swatch: ["#000000", "#111111", "#8B5CF6"],
  },
};

export const themeList = Object.values(themes);
