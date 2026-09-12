/**
 * Double for @supabase/supabase-js: one in-memory ledger.
 *
 * It mirrors credit_verified_payment's replay semantics EXACTLY — a
 * reference credits at most one purchase row; a second settlement of the
 * same reference returns the current balance without moving it — so the
 * test asserts the real double-credit behaviour, not a convenient one.
 */

export const state = {
  /** access token -> user id */
  users: new Map(),
  /** user id -> coin balance */
  wallets: new Map(),
  /** one entry per REFERENCE that was ever credited (the DB's replay guard) */
  creditedReferences: new Set(),
  /** the credit calls the routes made, in order */
  credits: [],
  /** every rpc call, for assertions on what was asked for */
  rpcCalls: [],
  /** when set, every rpc resolves with this error (simulating a dead service role) */
  rpcError: null,
};

export function reset(ledger) {
  state.users = new Map(ledger?.users ?? []);
  state.wallets = new Map(ledger?.wallets ?? []);
  state.creditedReferences = new Set();
  state.credits = [];
  state.rpcCalls = [];
  state.rpcError = null;
}

export function seedUser(token, userId, balance = 0) {
  state.users.set(token, userId);
  state.wallets.set(userId, balance);
}

const ledger = {
  rpc(fn, args) {
    state.rpcCalls.push({ fn, args });
    if (state.rpcError) {
      return Promise.resolve({ data: null, error: { message: state.rpcError } });
    }
    if (fn === "credit_verified_payment") {
      const { target_user, payment_reference, coin_amount } = args;
      if (state.creditedReferences.has(payment_reference)) {
        /* The replay guard: same answer a second caller gets, no second row. */
        return Promise.resolve({ data: state.wallets.get(target_user) ?? 0, error: null });
      }
      const next = (state.wallets.get(target_user) ?? 0) + coin_amount;
      state.wallets.set(target_user, next);
      state.creditedReferences.add(payment_reference);
      state.credits.push({ ...args });
      return Promise.resolve({ data: next, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  },
  auth: {
    async getUser(token) {
      const userId = state.users.get(token);
      return userId
        ? { data: { user: { id: userId } }, error: null }
        : { data: { user: null }, error: { message: "invalid token" } };
    },
  },
};

export function createClient() {
  return ledger;
}

export default { createClient };
