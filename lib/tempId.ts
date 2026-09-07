/**
 * Ids for things that exist locally before the server has named them.
 *
 * Optimistic sends — a message in flight, a post being uploaded — need an id
 * immediately: it keys the row in the list, the flight metadata, and the
 * reconciliation that later swaps the real row in. So the id has to be minted on
 * the client, in the same tick as the tap.
 *
 * WHY NOT `crypto.randomUUID()` DIRECTLY
 *
 * It is not universally present. `components/wallet/TransferCoinsModal.tsx` has
 * guarded against this since the idempotency-key work, because Android WebViews
 * old enough to still be in the field ship a `crypto` object without
 * `randomUUID`, and it is also absent outside a secure context. A bare call
 * there throws a TypeError — which, in a send handler, means the composer
 * swallows the tap and nothing happens at all. Falling back costs one line.
 *
 * These ids are never persisted and never cross the wire as identity. The real
 * id arrives with the server's response and replaces them, so "unique enough
 * within this tab, right now" is the whole requirement.
 */
export function tempId(prefix = "pending"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  /* Timestamp plus a random tail. Collisions would need two sends in the same
     millisecond that also drew the same nine base-36 characters, and a
     collision here would only merge two rows the user can see — not lose data. */
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * True when an id is one of ours rather than the database's.
 *
 * The prefix is what makes this safe: a real Postgres uuid cannot start with
 * `pending-`, so a row carrying one is unambiguously still in flight. Every
 * "has this been reconciled yet?" test in the app goes through here instead of
 * re-checking the prefix, so the convention lives in exactly one place.
 */
export function isTempId(id: string, prefix = "pending"): boolean {
  return id.startsWith(`${prefix}-`);
}
