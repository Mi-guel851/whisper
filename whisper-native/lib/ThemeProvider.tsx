import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { supabase } from "@/lib/supabase";
import { applyPalette, DARK, LIGHT, type Palette } from "@/lib/theme";

/**
 * The theme provider — the native port of the web app's
 * `components/ThemeProvider.tsx`, decision for decision:
 *
 *   - three preferences: `system` / `light` / `dark`, default `dark`;
 *   - the choice persists in storage (`localStorage` there,
 *     AsyncStorage here, same `whisper-theme` key);
 *   - when the account has a `profiles.theme_preference`, THAT wins —
 *     following the user across devices is the reason it is stored
 *     server-side at all — and is mirrored back into storage so the next
 *     launch is right without waiting on the network;
 *   - `system` follows the OS live (their `matchMedia` listener is this
 *     platform's `useColorScheme`);
 *   - switching applies instantly (this file points the live palette
 *     exports at the new set; `useStyles` re-renders every mounted screen).
 *
 * The one native addition: the first palette must be applied BEFORE the
 * first screen paints, so `ready` gates the navigator in the root layout —
 * the native equivalent of the web's pre-paint inline script.
 */

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "whisper-theme";

type ThemeContextValue = {
  themeId: ThemePreference;
  resolvedTheme: ResolvedTheme;
  palette: Palette;
  setThemeId: (id: ThemePreference) => void;
  toggleTheme: () => void;
  /** False until the stored preference has been read and applied once. */
  ready: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function paletteFor(resolved: ResolvedTheme): Palette {
  return resolved === "light" ? LIGHT : DARK;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemePreference>("dark");
  const [ready, setReady] = useState(false);
  const systemScheme = useColorScheme();

  const resolvedTheme: ResolvedTheme = themeId === "system" ? (systemScheme === "light" ? "light" : "dark") : themeId;

  /* The stored preference, then the account's. Runs once, before the gate
     in the root layout lets any screen paint. */
  useEffect(() => {
    let active = true;

    async function initTheme() {
      let selected: ThemePreference = "dark";
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored === "system" || stored === "light" || stored === "dark") {
          selected = stored;
        }
      } catch {
        /* Storage can throw outright in private mode; the default stands. */
      }

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
          const profileTheme = (data as { theme_preference?: string } | null)?.theme_preference;
          if (!error && (profileTheme === "system" || profileTheme === "light" || profileTheme === "dark")) {
            selected = profileTheme;
            try {
              await AsyncStorage.setItem(STORAGE_KEY, selected);
            } catch {
              /* private mode */
            }
          }
        }
      } catch {
        /* Offline, or auth is unreachable: the stored preference stands — it
           is a better answer than forcing dark on someone who chose light. */
      }

      if (!active) return;
      applyPalette(paletteFor(selected === "system" ? (systemScheme === "light" ? "light" : "dark") : selected));
      setThemeIdState(selected);
      setReady(true);
    }

    void initTheme();
    return () => {
      active = false;
    };
    // The system scheme at mount is the right seed for a `system` preference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* `system` follows the OS live — the web's matchMedia listener. */
  useEffect(() => {
    if (themeId === "system") {
      applyPalette(paletteFor(systemScheme === "light" ? "light" : "dark"));
    }
  }, [systemScheme, themeId]);

  const setThemeId = useCallback((id: ThemePreference) => {
    setThemeIdState(id);
    const resolved = id === "system" ? undefined : id;
    if (resolved) applyPalette(paletteFor(resolved));

    /* Persist after the visual change, not before — storage throws in private
       mode, and an unguarded write here meant the theme silently refused to
       switch (the web provider's own comment). */
    void AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});

    /* And to the account, so it follows the user across devices. */
    void (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;
        await supabase.from("profiles").update({ theme_preference: id }).eq("id", session.user.id);
      } catch {
        /* The visual switch already happened; the sync can wait. */
      }
    })();
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeId(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setThemeId]);

  const value = useMemo(
    () => ({
      themeId,
      resolvedTheme,
      palette: paletteFor(resolvedTheme),
      setThemeId,
      toggleTheme,
      ready,
    }),
    [ready, resolvedTheme, setThemeId, themeId, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
