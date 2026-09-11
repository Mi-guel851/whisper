"use client";

import { supabase } from "@/lib/supabase/client";

/**
 * Blocking, from the app's side.
 *
 * One RPC per direction (202609120002) for the reason that migration explains:
 * the delete half of `blocked_users` never had a policy, so a client-side
 * "unblock" would have removed zero rows and reported success. The RPCs run as
 * the table owner, are self-only (`auth.uid()` decides, never the argument) and
 * are idempotent, so a double-tap on a menu item is a no-op rather than an
 * error.
 *
 * The block is never a local flag anywhere: what the UI reads back is the
 * server's answer, because the consequence — no whispers, no calls, no pending
 * request — is enforced in the database, not in this file.
 */

export type BlockResult =
  | { ok: true; status: "blocked" | "already_blocked" | "unblocked" | "not_blocked" }
  | { ok: false; error: string };

/**
 * Block someone.
 *
 * Side effects, all of them intentional and all of them server-side: the block
 * row, the friendship in both directions, any pending friend request between
 * the two, and any call still ringing between them (a live call is left alone).
 */
export async function blockUser(userId: string): Promise<BlockResult> {
  if (!userId) return { ok: false, error: "No user to block." };
  try {
    const { data, error } = await supabase.rpc("block_user", { p_user_id: userId } as never);
    if (error) {
      /* An un-migrated database answers with "function not found"; saying so is
         more honest than a generic failure, because the fix is a migration. */
      const missing =
        error.code === "PGRST202" || error.code === "42883" || /function .* does not exist/i.test(error.message ?? "");
      return {
        ok: false,
        error: missing ? "Blocking isn't available on this server yet." : error.message || "Couldn't block them.",
      };
    }
    const payload = (data ?? {}) as { status?: string };
    return {
      ok: true,
      status: payload.status === "already_blocked" ? "already_blocked" : "blocked",
    };
  } catch {
    return { ok: false, error: "Couldn't block them. Check your connection and try again." };
  }
}

/** Lift a block this user placed. The friendship is not restored — that is a
    fresh request, deliberately. */
export async function unblockUser(userId: string): Promise<BlockResult> {
  if (!userId) return { ok: false, error: "No user to unblock." };
  try {
    const { data, error } = await supabase.rpc("unblock_user", { p_user_id: userId } as never);
    if (error) {
      const missing =
        error.code === "PGRST202" || error.code === "42883" || /function .* does not exist/i.test(error.message ?? "");
      return {
        ok: false,
        error: missing ? "Unblocking isn't available on this server yet." : error.message || "Couldn't unblock them.",
      };
    }
    const payload = (data ?? {}) as { status?: string };
    return {
      ok: true,
      status: payload.status === "not_blocked" ? "not_blocked" : "unblocked",
    };
  } catch {
    return { ok: false, error: "Couldn't unblock them. Check your connection and try again." };
  }
}

/**
 * The people this user has blocked, as ids.
 *
 * Only the rows this user placed (`user_id = me`) — the RLS SELECT policy also
 * exposes rows where the user is the *blocked* party, and using that to label a
 * menu item would tell someone they are blocked, which is exactly what a block
 * must not disclose.
 */
export async function fetchBlockedIds(myId: string): Promise<Set<string>> {
  if (!myId) return new Set();
  const { data, error } = await supabase
    .from("blocked_users")
    .select("blocked_user_id")
    .eq("user_id", myId);
  if (error) {
    console.error("Blocklist fetch error:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((row) => (row as { blocked_user_id: string }).blocked_user_id));
}
