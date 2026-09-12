import { supabase } from "./supabase";

/**
 * Consent.
 *
 * The web app's `lib/consent.ts`, same doc, same version, same RPC. The
 * profiles trigger refuses to complete an account with no consent row, so the
 * complete-profile step writes one through `record_consent` — the same
 * idempotent server call the site makes (unique `(user_id, doc)` + upsert
 * inside the RPC, so re-ticking refreshes rather than duplicates).
 */

export const CONSENT_DOC = "privacy_terms";
export const CONSENT_DOC_VERSION = 1;

/** Whether the user already has a consent row for the current document version. */
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
 * Writes the consent row server-side. Idempotent: re-ticking refreshes the row
 * rather than duplicating it.
 */
export async function grantConsent(): Promise<boolean> {
  const { error } = await supabase.rpc("record_consent", {
    p_doc: CONSENT_DOC,
    p_doc_version: CONSENT_DOC_VERSION,
  });
  return !error;
}
