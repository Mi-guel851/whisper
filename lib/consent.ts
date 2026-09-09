"use client";

import { supabase } from "@/lib/supabase/client";

/**
 * The privacy/terms consent gate, client half.
 *
 * The server half is the database (202609090001): a `public.consents` row and
 * a trigger on `profiles` that refuses the profile_completed transition
 * without one. Everything in this file exists only to get that row written at
 * the right moment — the UI checkbox is a convenience, and this module must
 * stay honest even in a build where the UI drifted, because the trigger is
 * what actually stops an un-consented account from completing onboarding.
 *
 * The two constants below mirror the SQL (`current_consent_doc_version()`,
 * the closed-vocabulary check in `record_consent`). Bumping either means
 * editing both in the same change — the guard test in tests/whisper-guards.test.mjs
 * fails if the mirror value stops matching the migration.
 */

export const CONSENT_DOC = "privacy_terms";
export const CONSENT_DOC_VERSION = 1;

/**
 * The web sign-in flow (OAuth) leaves this device before it returns: the
 * browser redirects to Google and back to /complete-profile, and any React
 * state is gone with the navigation. The checkbox tick on /signup therefore
 * cannot "remember" the consent by holding it in memory — sessionStorage
 * survives the redirect round trip, and only for this tab, so a consent tick
 * in one tab cannot silently unblock onboarding in another.
 *
 * The flag is a hint, not the consent: consuming it writes the consent row
 * (below), and the profiles trigger independently verifies the row exists. A
 * user who clears storage before onboarding simply sees the checkbox again —
 * the worst case is friction, never an un-consented account.
 */
const PENDING_FLAG_KEY = "whisper:consent-pending";

export function markConsentPending() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PENDING_FLAG_KEY, String(CONSENT_DOC_VERSION));
  } catch {
    /* Private mode — the checkbox on /complete-profile covers the gap. */
  }
}

/** Reads and clears the pending flag. Returns whether one was present. */
export function consumePendingConsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.sessionStorage.getItem(PENDING_FLAG_KEY);
    if (raw !== null) window.sessionStorage.removeItem(PENDING_FLAG_KEY);
    return raw !== null;
  } catch {
    return false;
  }
}

/**
 * Whether the user already has a consent row for the current document version.
 * Used to pre-tick the checkbox on /complete-profile for anyone who consented
 * moments ago (the native Google path writes the row on /signup itself).
 */
export async function hasCurrentConsent(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("consents")
    .select("doc_version")
    .eq("user_id", userId)
    .eq("doc", CONSENT_DOC)
    .maybeSingle();
  if (error) return false;
  return data?.doc_version === CONSENT_DOC_VERSION;
}

/**
 * Writes the consent row server-side. Idempotent: re-ticking refreshes the
 * row rather than duplicating it (unique (user_id, doc) + upsert inside the
 * RPC).
 */
export async function grantConsent(): Promise<boolean> {
  const { error } = await supabase.rpc("record_consent", {
    p_doc: CONSENT_DOC,
    p_doc_version: CONSENT_DOC_VERSION,
  });
  return !error;
}
