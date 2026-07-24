"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  accentColors,
  backgroundThemes,
  createTheme,
  defaultAccentColorId,
  defaultBackgroundThemeId,
  type AccentColorId,
  type BackgroundThemeId,
  type Theme,
  type ThemeId,
} from "@/lib/themes";

type ThemeContextType = {
  backgroundThemeId: BackgroundThemeId;
  accentColorId: AccentColorId;
  themeId: ThemeId;
  theme: Theme;
  setBackgroundThemeId: (id: BackgroundThemeId) => void;
  setAccentColorId: (id: AccentColorId) => void;
  setThemeId: (id: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextType | null>(null);
const BACKGROUND_STORAGE_KEY = "whisper-background-theme";
const ACCENT_STORAGE_KEY = "whisper-accent-color";
const LEGACY_THEME_STORAGE_KEY = "whisper-theme";

function isBackgroundThemeId(value: string | null): value is BackgroundThemeId {
  return Boolean(value && value in backgroundThemes);
}

function isAccentColorId(value: string | null): value is AccentColorId {
  return Boolean(value && value in accentColors);
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const c = theme.colors;

  root.style.setProperty("--background", c.background);
  root.style.setProperty("--foreground", c.textPrimary);
  root.style.setProperty("--theme-bg", c.background);
  root.style.setProperty("--theme-bg-from", c.background);
  root.style.setProperty("--theme-bg-via", c.background);
  root.style.setProperty("--theme-bg-to", c.background);
  root.style.setProperty("--theme-surface", c.surface);
  root.style.setProperty("--theme-surface-secondary", c.surfaceSecondary);
  root.style.setProperty("--theme-surface-strong", c.card);
  root.style.setProperty("--theme-surface-muted", c.surfaceSecondary);
  root.style.setProperty("--theme-card", c.card);
  root.style.setProperty("--theme-border", c.border);
  root.style.setProperty("--theme-border-strong", c.inputBorder);
  root.style.setProperty("--theme-input", c.input);
  root.style.setProperty("--theme-input-border", c.inputBorder);
  root.style.setProperty("--theme-text", c.textPrimary);
  root.style.setProperty("--theme-text-primary", c.textPrimary);
  root.style.setProperty("--theme-text-muted", c.textSecondary);
  root.style.setProperty("--theme-text-secondary", c.textSecondary);
  root.style.setProperty("--theme-text-subtle", c.textMuted);
  root.style.setProperty("--theme-accent", c.accent);
  root.style.setProperty("--theme-accent-from", c.accent);
  root.style.setProperty("--theme-accent-to", c.accent);
  root.style.setProperty("--theme-accent-text", c.accent);
  root.style.setProperty("--theme-accent-soft", c.accentSoft);
  root.style.setProperty("--theme-accent-strong", c.accentStrong);
  root.style.setProperty("--theme-accent-contrast", c.accentContrast);
  root.style.setProperty("--theme-icon", c.icon);
  root.style.setProperty("--theme-success", c.success);
  root.style.setProperty("--theme-warning", c.warning);
  root.style.setProperty("--theme-error", c.error);
  root.style.setProperty("--theme-notification", c.notification);
  root.style.setProperty("--theme-divider", c.border);
  root.style.setProperty("--theme-shadow", c.shadow);
  root.style.setProperty("--theme-overlay", c.overlay);
  root.style.setProperty("--theme-nav-bg", c.card);
  root.style.setProperty("--theme-nav-border", c.border);
  root.style.setProperty("--theme-nav-shadow", c.shadow);
  root.style.setProperty("--theme-nav-inactive", c.textMuted);
  root.style.setProperty("--theme-nav-active-text", c.accentContrast);
  root.style.setProperty("--theme-nav-press", c.accentSoft);

  root.dataset.theme = theme.id;
  root.dataset.accent = theme.accent.id;
  root.dataset.themeEngine = "true";
}

function getInitialBackgroundThemeId(): BackgroundThemeId {
  if (typeof window === "undefined") return defaultBackgroundThemeId;
  const savedBackground = window.localStorage.getItem(BACKGROUND_STORAGE_KEY);
  const legacyTheme = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
  if (isBackgroundThemeId(savedBackground)) return savedBackground;
  if (isBackgroundThemeId(legacyTheme)) return legacyTheme;
  return defaultBackgroundThemeId;
}

function getInitialAccentColorId(): AccentColorId {
  if (typeof window === "undefined") return defaultAccentColorId;
  const savedAccent = window.localStorage.getItem(ACCENT_STORAGE_KEY);
  if (isAccentColorId(savedAccent)) return savedAccent;
  return defaultAccentColorId;
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [backgroundThemeId, setBackgroundThemeIdState] = useState<BackgroundThemeId>(getInitialBackgroundThemeId);
  const [accentColorId, setAccentColorIdState] = useState<AccentColorId>(getInitialAccentColorId);
  const theme = useMemo(() => createTheme(backgroundThemeId, accentColorId), [backgroundThemeId, accentColorId]);


  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function setBackgroundThemeId(id: BackgroundThemeId) {
    setBackgroundThemeIdState(id);
    localStorage.setItem(BACKGROUND_STORAGE_KEY, id);
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, id);
  }

  function setAccentColorId(id: AccentColorId) {
    setAccentColorIdState(id);
    localStorage.setItem(ACCENT_STORAGE_KEY, id);
  }

  function setThemeId(id: ThemeId) {
    setBackgroundThemeId(id);
  }

  return (
    <ThemeContext.Provider value={{ backgroundThemeId, accentColorId, themeId: backgroundThemeId, theme, setBackgroundThemeId, setAccentColorId, setThemeId }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
