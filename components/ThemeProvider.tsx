"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { themes, type ThemeId, type Theme } from "@/lib/themes";

type ThemeContextType = {
  themeId: ThemeId;
  theme: Theme;
  setThemeId: (id: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextType | null>(null);
const STORAGE_KEY = "whisper-theme";

const cssVariableMap: Record<keyof Omit<Theme, "id" | "name" | "swatch">, string> = {
  bgFrom: "--theme-bg-from",
  bgVia: "--theme-bg-via",
  bgTo: "--theme-bg-to",
  blob1: "--theme-blob-1",
  blob2: "--theme-blob-2",
  blob3: "--theme-blob-3",
  accentFrom: "--theme-accent-from",
  accentTo: "--theme-accent-to",
  accentText: "--theme-accent-text",
  accentContrast: "--theme-accent-contrast",
  surface: "--theme-surface",
  surfaceStrong: "--theme-surface-strong",
  surfaceMuted: "--theme-surface-muted",
  border: "--theme-border",
  borderStrong: "--theme-border-strong",
  text: "--theme-text",
  textMuted: "--theme-text-muted",
  textSubtle: "--theme-text-subtle",
  divider: "--theme-divider",
  shadow: "--theme-shadow",
  navBg: "--theme-nav-bg",
  navBorder: "--theme-nav-border",
  navShadow: "--theme-nav-shadow",
  navInactive: "--theme-nav-inactive",
  navActiveText: "--theme-nav-active-text",
  navPress: "--theme-nav-press",
};

function applyTheme(theme: Theme) {
  const root = document.documentElement;

  for (const [themeKey, cssVariable] of Object.entries(cssVariableMap) as [keyof typeof cssVariableMap, string][]) {
    root.style.setProperty(cssVariable, theme[themeKey]);
  }

  root.dataset.theme = theme.id;
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>(() => {
    if (typeof window === "undefined") return "midnight";

    const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    return saved && themes[saved] ? saved : "midnight";
  });

  useEffect(() => {
    applyTheme(themes[themeId]);
  }, [themeId]);

  function setThemeId(id: ThemeId) {
    setThemeIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  }

  return (
    <ThemeContext.Provider value={{ themeId, theme: themes[themeId], setThemeId }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
