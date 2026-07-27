"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { themes, type ResolvedThemeId, type Theme, type ThemeId } from "@/lib/themes";

type ThemeContextType = {
  themeId: ThemeId;
  theme: Theme;
  resolvedTheme: ResolvedThemeId;
  setThemeId: (id: ThemeId) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextType | null>(null);
const STORAGE_KEY = "whisper-theme";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

function getSystemTheme(): ResolvedThemeId {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light";
}

function resolveTheme(themeId: ThemeId): ResolvedThemeId {
  return themeId === "system" ? getSystemTheme() : themeId;
}

function applyTheme(themeId: ThemeId) {
  const resolved = resolveTheme(themeId);
  const root = document.documentElement;
  root.dataset.themePreference = themeId;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>(() => {
    if (typeof window === "undefined") return "system";
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    return saved && themes[saved] ? saved : "system";
  });
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedThemeId>(() => resolveTheme(themeId));

  useEffect(() => {
    const media = window.matchMedia(MEDIA_QUERY);

    function handleSystemThemeChange() {
      setResolvedTheme(resolveTheme(themeId));
      applyTheme(themeId);
    }

    handleSystemThemeChange();
    media.addEventListener("change", handleSystemThemeChange);
    return () => media.removeEventListener("change", handleSystemThemeChange);
  }, [themeId]);

  const setThemeId = useCallback((id: ThemeId) => {
    setThemeIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
    setResolvedTheme(resolveTheme(id));
    applyTheme(id);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeId(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setThemeId]);

  const value = useMemo(
    () => ({ themeId, theme: themes[themeId], resolvedTheme, setThemeId, toggleTheme }),
    [themeId, resolvedTheme, setThemeId, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
