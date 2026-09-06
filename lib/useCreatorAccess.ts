"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { getCachedSession, onSessionChange } from "@/lib/supabase/session";

/**
 * Whether the signed-in account is an official Whisper creator.
 *
 * This is a *display* decision — it shows or hides the creator entry points and
 * the dashboard. It is answered by the database (`is_whisper_creator()` runs as
 * the caller and reads the confirmed email off `auth.users`), never by comparing
 * an email string in the browser, and it is never cached in localStorage or a
 * cookie: a fresh session means a fresh answer, and signing out resets it to
 * `false` on the same tick.
 *
 * Even if this returned `true` for the wrong person, they would gain nothing:
 * /api/creator/post and the table trigger re-check on every write.
 */
export type CreatorAccess = {
  /** `null` while the answer is still in flight. */
  isCreator: boolean | null;
  /** The signed-in user's id, or "" when signed out. */
  userId: string;
  /** True when the server lacks the creator migration entirely. */
  unavailable: boolean;
};

export function useCreatorAccess(): CreatorAccess {
  const [state, setState] = useState<CreatorAccess>({
    isCreator: null,
    userId: "",
    unavailable: false,
  });

  useEffect(() => {
    let cancelled = false;
    let generation = 0;

    async function resolve() {
      const mine = ++generation;
      const session = await getCachedSession();
      if (cancelled || mine !== generation) return;

      if (!session) {
        setState({ isCreator: false, userId: "", unavailable: false });
        return;
      }

      setState((current) => ({ ...current, userId: session.user.id, isCreator: null }));

      const { data, error } = await supabase.rpc("is_whisper_creator");
      if (cancelled || mine !== generation) return;

      if (error) {
        const missing =
          error.code === "42883" ||
          error.code === "PGRST202" ||
          /could not find the function|does not exist/i.test(error.message ?? "");
        setState({ isCreator: false, userId: session.user.id, unavailable: missing });
        return;
      }

      setState({ isCreator: data === true, userId: session.user.id, unavailable: false });
    }

    void resolve();
    /* Sign-in, sign-out and account switches all re-ask. Nothing is carried
       from one user to the next. */
    const unsubscribe = onSessionChange(() => void resolve());

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return state;
}
