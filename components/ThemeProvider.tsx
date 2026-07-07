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

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.style.setProperty("--theme-bg-from", theme.bgFrom);
  root.style.setProperty("--theme-bg-via", theme.bgVia);
  root.style.setProperty("--theme-bg-to", theme.bgTo);
  root.style.setProperty("--theme-blob-1", theme.blob1);
  root.style.setProperty("--theme-blob-2", theme.blob2);
  root.style.setProperty("--theme-blob-3", theme.blob3);
  root.style.setProperty("--theme-accent-from", theme.accentFrom);
  root.style.setProperty("--theme-accent-to", theme.accentTo);
  root.style.setProperty("--theme-accent-text", theme.accentText);
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
