import type { Session, User } from "@supabase/supabase-js";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { registerForPushNotifications } from "./push";
import { supabase } from "./supabase";

/**
 * Who is signed in.
 *
 * One provider, mounted above the navigator, and the auth state lives here
 * rather than on a screen because *three* things need it at once and they are
 * not on the same screen: the navigator (which picks the stack), the tab bar's
 * badges, and every query in the app.
 *
 * TWO DECISIONS WORTH SPELLING OUT
 *
 *  1. `getSession()` first, `onAuthStateChange` second, and the listener is
 *     registered inside the same effect. Supabase's client persists to
 *     AsyncStorage, so on a cold start there is a real session to find and it is
 *     found synchronously enough to skip the login screen entirely — which is
 *     what makes "open the app and you are already in" work.
 *
 *  2. The listener ignores `TOKEN_REFRESHED`. A refreshed token is the same user
 *     with a newer string; treating it as a state change re-runs every effect
 *     that depends on `session`, which on this app means the badges, the push
 *     registration and every screen's first query — every hour, for no reason.
 *     `refreshSession` covers the one case that genuinely needs the new token.
 *
 * Push registration is here because it must happen exactly once per signed-in
 * user: a screen would re-register on every mount, and the tab bar re-mounts on
 * every tab switch.
 */

export type SessionContextValue = {
  session: Session | null;
  user: User | null;
  userId: string | null;
  loading: boolean;
  /** Marks the app signed out: clears the session and every cached badge. */
  signOut: () => Promise<void>;
  /** Re-registers this device for push — used when the switch is turned back on. */
  refreshPush: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  /* The push registration is one-per-user; this is the guard that makes the
     effect idempotent under React's double-invoked effects in development. */
  const [pushedFor, setPushedFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      if (cancelled) return;

      if (event === "TOKEN_REFRESHED" && next?.user?.id === session?.user?.id) {
        /* A new string for the same user. Not a state change. */
        return;
      }

      setSession(next ?? null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      setPushedFor(null);
      return;
    }
    if (pushedFor === userId) return;

    setPushedFor(userId);
    void registerForPushNotifications(userId).catch((error) => {
      /* A refused permission or an FCM-less build is not a reason to block the
         app. The profile column is what actually gates delivery. */
      console.warn("[session] push registration skipped:", error);
    });
  }, [pushedFor, userId]);

  const signOut = useCallback(async () => {
    /* Local scope: the refresh token on the server is harmless once the device
       has forgotten it, and a failed network call must not trap somebody in an
       account they asked to leave. */
    await supabase.auth.signOut({ scope: "local" });
    setSession(null);
  }, []);

  const refreshPush = useCallback(async () => {
    if (!userId) return;
    await registerForPushNotifications(userId);
  }, [userId]);

  const refreshSession = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session ?? null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      userId,
      loading,
      signOut,
      refreshPush,
      refreshSession,
    }),
    [loading, refreshPush, refreshSession, session, signOut, userId]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside <SessionProvider>");
  return context;
}

/** The access token, or an empty string — the shape every authed fetch wants. */
export function useAccessToken(): string {
  const { session } = useSession();
  return session?.access_token ?? "";
}
