"use client";

import { useEffect } from "react";

import { supabase } from "@/lib/supabase/client";
import { isAdminEmail } from "@/lib/admin/emails";
import { setDebugErrors } from "@/lib/safeErrorMessage";

/**
 * Turns on real error text for the two allowlisted admin accounts, everywhere
 * the gate would otherwise replace it with a friendly sentence.
 *
 * Mounted once in the root layout (next to BanGate), so every page, toast and
 * the app-level error boundary inherit the same rule: signed in as one of the
 * admin accounts → toasts, page error states and the error screen show the
 * actual error; any other visitor → the gated message.
 *
 * What this is and isn't: a DISPLAY decision. It reads the session the browser
 * already holds and checks it against the client copy of the allowlist — both
 * ship in the bundle, so this is convenience for the two people debugging, not
 * an access boundary. What an admin is ALLOWED to see from the server is
 * decided per request in lib/safeErrorMessage.ts (errorTextFor) against the
 * server allowlist and the email GoTrue returns for the validated token.
 */
export default function AdminDebugGate() {
  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setDebugErrors(isAdminEmail(data.session?.user?.email, "client"));
    });

    /* Sign-in / sign-out / account switches flip the flag too, without a reload. */
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setDebugErrors(isAdminEmail(session?.user?.email, "client"));
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
