import { supabase } from "./supabase";

/**
 * Inbox blocking — the native copy of the web app's `lib/blocks.ts`.
 *
 * One RPC per direction (migration `202609120002`) for the reason that
 * migration explains: a block is a relationship both clients must read the
 * same way, and the function is the only writer. An un-migrated database
 * answers "function not found" — reported honestly, because the fix is a
 * migration, not a retry.
 */

export type BlockResult =
  | { ok: true; status: "blocked" | "already_blocked" | "unblocked" | "not_blocked" }
  | { ok: false; error: string };

const MISSING = (message?: string | null) =>
  Boolean(
    message &&
      (message.includes("PGRST202") ||
        message.includes("42883") ||
        /function .* does not exist/i.test(message))
  );

/** Block an account. Kills DMs both ways; the friendship is not restored by
    an unblock — that is a fresh request, deliberately. */
export async function blockUser(userId: string): Promise<BlockResult> {
  if (!userId) return { ok: false, error: "No user to block." };
  try {
    const { data, error } = await supabase.rpc("block_user", { p_user_id: userId } as never);
    if (error) {
      if (MISSING(error.code) || MISSING(error.message)) {
        return { ok: false, error: "Blocking isn't available on this server yet." };
      }
      return { ok: false, error: error.message || "Couldn't block them." };
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

/** Lift a block this user placed. */
export async function unblockUser(userId: string): Promise<BlockResult> {
  if (!userId) return { ok: false, error: "No user to unblock." };
  try {
    const { data, error } = await supabase.rpc("unblock_user", { p_user_id: userId } as never);
    if (error) {
      if (MISSING(error.code) || MISSING(error.message)) {
        return { ok: false, error: "Blocking isn't available on this server yet." };
      }
      return { ok: false, error: error.message || "Couldn't unblock them." };
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

/** Every account this user has blocked (the web's exact query — the table
    lists one direction per row: `user_id` → `blocked_user_id`). The menu has
    to say Block or Unblock, and guessing either way is a lie with
    consequences. */
export async function fetchBlockedIds(myId: string): Promise<Set<string>> {
  if (!myId) return new Set();
  const { data, error } = await supabase
    .from("blocked_users")
    .select("blocked_user_id")
    .eq("user_id", myId);
  if (error) {
    console.warn("[blocks] list fetch failed:", error.message);
    return new Set();
  }
  return new Set(((data ?? []) as { blocked_user_id: string }[]).map((row) => row.blocked_user_id));
}
