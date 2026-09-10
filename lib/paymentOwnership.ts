/** Only pass a transaction returned by Paystack's authenticated verification API.
 * Never trust client-supplied metadata or use a shared billing email as ownership.
 */
export function paymentBelongsToUser(
  tx: { reference?: unknown; metadata?: { user_id?: unknown; coins?: unknown } | null },
  reference: string,
  userId: string
): boolean {
  if (tx.reference !== reference) return false;
  if (tx.metadata?.user_id != null) return tx.metadata.user_id === userId;

  // Older checkouts already encode the owner in the gateway's immutable reference.
  // Keep those paid transactions redeemable; arbitrary legacy references fail closed.
  const legacy = /^whisper_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(\d+)_(\d+)$/.exec(reference);
  return Boolean(legacy && legacy[1] === userId && Number(legacy[2]) === Number(tx.metadata?.coins));
}
