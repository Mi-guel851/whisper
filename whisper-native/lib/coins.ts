import { supabase } from "./supabase";
import type { CoinTransaction, Wallet } from "./types";

/**
 * Coins: the wallet, the prices, and the transfer rules.
 *
 * The prices are copied from the web app's `lib/coins.ts` because they are not
 * purely display values — three of them are what the server's RPCs charge, and
 * a client showing a different number than it is about to be billed is the kind
 * of bug that reads as theft. The purchase packages matter for a different
 * reason: `/api/paystack/verify` derives the expected amount from the same
 * table and refuses a charge whose amount does not match the package it claims
 * to be, so these numbers are part of a security check.
 */

export const HINT_UNLOCK_COST = 5;
export const UNLOCK_CHAT_COST = 40;
export const SEND_IMAGE_COST = 10;
export const SEND_VOICE_COST = 5;
export const FEED_POST_COST = 2;
export const FEED_REPLY_COST = 0;

/** 100 coins = ₦1,000 in the NGN region, or $1 elsewhere. */
export const NGN_PER_100_COINS = 1000;
export const USD_PER_100_COINS = 1;

export type CoinPackage = {
  coins: number;
  label: string;
  ngnAmount: number;
  usdAmount: number;
  popular?: boolean;
};

export const COIN_PACKAGES: CoinPackage[] = [
  { coins: 100, label: "Starter Pack", ngnAmount: 1000, usdAmount: 1 },
  { coins: 300, label: "Whisper Bundle", ngnAmount: 3000, usdAmount: 3, popular: true },
  { coins: 500, label: "Whisper Vault", ngnAmount: 5000, usdAmount: 5 },
  { coins: 1000, label: "Whisper Fortune", ngnAmount: 10000, usdAmount: 10 },
];

/**
 * The email every charge is billed under.
 *
 * This Paystack account bills through one masked address rather than the
 * buyer's. `/api/paystack/verify` checks the gateway's transaction against this
 * exact string and refuses anything else, so it is not a display value either —
 * sending the user's own email here produces a charge the server rejects as
 * "Email mismatch" after the money has moved.
 */
export const MASKED_EMAIL = "whisper.anonymous.app@gmail.com";

/** The user's wallet row. */
export async function fetchWallet(userId: string): Promise<Wallet | null> {
  const { data, error } = await supabase
    .from("coins")
    .select("balance, wallet_address")
    .eq("user_id", userId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.warn("[coins] wallet fetch failed:", error.message);
  }
  return (data as Wallet | null) ?? null;
}

/**
 * Creates the wallet if it does not exist.
 *
 * Safe to call on every coin surface: the function inserts and does nothing on
 * conflict, and it also backfills a `wallet_address` when the row has none —
 * which is how every pre-existing user gets an address without a migration.
 */
export async function ensureWallet(userId: string): Promise<void> {
  const { error } = await supabase.rpc("ensure_coin_wallet", { target_user: userId });
  if (error) console.warn("[coins] ensure wallet failed:", error.message);
}

/** Recent ledger rows, newest first. */
export async function fetchTransactions(userId: string, limit = 40): Promise<CoinTransaction[]> {
  const { data, error } = await supabase
    .from("coin_transactions")
    .select("id,amount,description,transaction_type,created_at,reference")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("[coins] transaction fetch failed:", error.message);
    return [];
  }
  return (data || []) as CoinTransaction[];
}

/* ---------------------------------------------------------------------------
 * Transfers
 * ------------------------------------------------------------------------ */

/**
 * The canonical form of a Whispers address.
 *
 * Mirrors `normalize_wallet_address` in SQL: uppercase, strip separators,
 * translate the Crockford confusions (I/L → 1, O → 0), then re-group into
 * `WHISPERS-XXXX-XXXX-XXXX-XXXX`. A bare 16-character payload is accepted, so
 * somebody who copied only the code half still gets a working paste rather than
 * a format error.
 */
export function normalizeAddress(input: string): string | null {
  if (!input) return null;

  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const payload = cleaned.startsWith("WHISPERS") ? cleaned.slice(8) : cleaned;

  /* Applied to the payload only — the "WHISPERS" prefix legitimately contains
     both I and S. */
  const translated = payload.replace(/I/g, "1").replace(/L/g, "1").replace(/O/g, "0");

  if (!/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/.test(translated)) return null;

  return [
    "WHISPERS",
    translated.slice(0, 4),
    translated.slice(4, 8),
    translated.slice(8, 12),
    translated.slice(12, 16),
  ].join("-");
}

/** `WHISPERS-A1B2…X9Y8` — the form receipts and history rows use. */
export function maskAddress(address: string | null | undefined): string {
  if (!address) return "";
  if (address.length <= 18) return address;
  return `${address.slice(0, 13)}…${address.slice(-4)}`;
}

export type TransferResult = {
  ok: boolean;
  balance?: number;
  recipientMasked?: string;
  error?: string;
};

/**
 * Sends coins to an address.
 *
 * `transfer_whisper_coins` is the whole operation: it validates the address,
 * refuses a self-transfer, refuses an amount above the balance, writes both
 * ledger rows and the `coin_transfers` receipt, and is idempotent on the
 * idempotency key — so a retry after a timeout cannot pay twice. The client
 * does not touch `coins` directly for this; a read-modify-write from a phone is
 * exactly how a balance gets lost.
 */
export async function transferCoins(
  recipientAddress: string,
  coinAmount: number,
  idempotencyKey?: string
): Promise<TransferResult> {
  const address = normalizeAddress(recipientAddress);
  if (!address) return { ok: false, error: "That doesn't look like a Whispers address." };
  if (!Number.isFinite(coinAmount) || coinAmount <= 0) {
    return { ok: false, error: "Enter how many coins to send." };
  }

  const { data, error } = await supabase.rpc("transfer_whisper_coins", {
    recipient_address: address,
    coin_amount: Math.floor(coinAmount),
    idempotency_key: idempotencyKey ?? null,
  });

  if (error) return { ok: false, error: error.message };

  const payload = (data ?? {}) as {
    success?: boolean;
    balance?: number;
    recipient_address?: string;
    error?: string;
  };

  if (payload.success === false) {
    return { ok: false, error: payload.error ?? "The transfer didn't go through." };
  }

  return {
    ok: true,
    balance: Number(payload.balance ?? 0),
    recipientMasked: payload.recipient_address ?? maskAddress(address),
  };
}

/* ---------------------------------------------------------------------------
 * Spend paths with their own RPCs
 * ------------------------------------------------------------------------ */

/** Sends the 10-coin photo in a chat. */
export async function spendForImage(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc("spend_coins_for_image", {
    target_conversation_id: conversationId,
  });
  if (error) throw error;
}

/**
 * The PostgREST error codes that mean "this function isn't deployed here",
 * as opposed to "the call failed". The difference decides between telling the
 * user to update the app and asking them to try again.
 */
export const MISSING_FUNCTION_CODES = new Set(["PGRST202", "42883"]);
