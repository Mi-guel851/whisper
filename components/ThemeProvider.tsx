"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { themes, type ResolvedThemeId, type Theme, type ThemeId } from "@/lib/themes";
import { supabase } from "@/lib/supabase/client";

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
  const [themeId, setThemeIdState] = useState<ThemeId>("dark");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedThemeId>("dark");

  useEffect(() => {
    let active = true;

    async function initTheme() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        let selected: ThemeId = "dark";

        if (session) {
          const { data, error } = await supabase
            .from("profiles")
            .select("theme_preference")
            .eq("id", session.user.id)
            .single();

          const profile = data as { theme_preference?: string } | null;
          const profileTheme = profile?.theme_preference;

          if (!error && typeof profileTheme === "string" && themes[profileTheme as ThemeId]) {
            selected = profileTheme as ThemeId;
          } else {
            const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
            if (saved && themes[saved]) selected = saved;
          }
        }

        if (!active) return;

        setThemeIdState(selected);
        setResolvedTheme(resolveTheme(selected));
        applyTheme(selected);
      } catch {
        setThemeIdState("dark");
        setResolvedTheme("dark");
        applyTheme("dark");
      }
    }

    initTheme();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia(MEDIA_QUERY);

    function handleSystemThemeChange() {
      if (themeId === "system") {
        setResolvedTheme(resolveTheme(themeId));
        applyTheme(themeId);
      }
    }

    handleSystemThemeChange();
    media.addEventListener("change", handleSystemThemeChange);
    return () => media.removeEventListener("change", handleSystemThemeChange);
  }, [themeId]);

  const setThemeId = useCallback(async (id: ThemeId) => {
    setThemeIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
    setResolvedTheme(resolveTheme(id));
    applyTheme(id);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    await supabase
      .from("profiles")
      .update({ theme_preference: id })
      .eq("id", session.user.id);
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
