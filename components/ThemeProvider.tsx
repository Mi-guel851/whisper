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

/**
 * Whatever the pre-paint script in app/layout.tsx already read. Reading it
 * again here rather than defaulting to "dark" is what stops React state from
 * disagreeing with the DOM for the length of a session fetch — the old code
 * only consulted storage for signed-in users, so a logged-out user's choice
 * was applied at paint and then thrown away a moment later.
 */
function readStoredTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in themes) return stored as ThemeId;
  } catch {
    /* Storage can throw outright in private mode. Fall through to the default. */
  }
  return "dark";
}

/** Matches --dur-base in globals.css, plus a little slack for the last frame. */
const THEME_TRANSITION_MS = 320;
let themeChangeTimer: ReturnType<typeof setTimeout> | null = null;

function applyTheme(themeId: ThemeId, options: { animate?: boolean } = {}) {
  const { animate = true } = options;
  const resolved = resolveTheme(themeId);
  const root = document.documentElement;

  /* globals.css transitions colours only while this attribute is present. It's
     scoped this way because the alternative — a standing transition on `*` —
     is paid on every style recalculation in the app for the sake of about
     200ms twice a session, and it fights Framer Motion for transform.
     Skipped on the first apply: there is nothing to cross-fade from, and
     animating the initial paint would reintroduce the flash it's meant to
     prevent. */
  if (animate && root.dataset.theme !== resolved) {
    root.dataset.themeChanging = "";
    if (themeChangeTimer) clearTimeout(themeChangeTimer);
    themeChangeTimer = setTimeout(() => {
      delete root.dataset.themeChanging;
      themeChangeTimer = null;
    }, THEME_TRANSITION_MS);
  }

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
      /* Start from what the pre-paint script already applied, so the common
         case is a no-op rather than a visible correction. */
      let selected: ThemeId = readStoredTheme();

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session) {
          const { data, error } = await supabase
            .from("profiles")
            .select("theme_preference")
            .eq("id", session.user.id)
            .single();

          const profile = data as { theme_preference?: string } | null;
          const profileTheme = profile?.theme_preference;

          /* The account's preference wins when it has one — following the user
             across devices is the reason it's stored server-side at all. Mirror
             it back into storage so the *next* first paint is right without
             waiting on the network. */
          if (!error && typeof profileTheme === "string" && themes[profileTheme as ThemeId]) {
            selected = profileTheme as ThemeId;
            try { localStorage.setItem(STORAGE_KEY, selected); } catch { /* private mode */ }
          }
        }
      } catch {
        /* Offline, or auth is unreachable. The stored preference stands — it is
           a better answer than forcing dark on someone who chose light. */
      }

      if (!active) return;

      setThemeIdState(selected);
      setResolvedTheme(resolveTheme(selected));
      applyTheme(selected, { animate: false });
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
    setResolvedTheme(resolveTheme(id));
    applyTheme(id);
    /* After the visual change, not before: storage throws in private mode, and
       an unguarded write here meant the theme silently refused to switch. */
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode */ }

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
