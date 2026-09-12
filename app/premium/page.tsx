"use client";

import WhisperCoinIcon from "@/components/WhisperCoinIcon";
import Script from "next/script";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Coins, Gem, Sparkles, Loader2, ShieldCheck, Gift, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { COIN_PACKAGES, CoinPackage } from "@/lib/coins";
import { isAdminEmail } from "@/lib/admin/emails";
import { CountryInfo, convertForDisplay, formatLocalAmount, getCountryInfo } from "@/lib/currency";
import {
  CoinTransaction,
  TransferReceipt,
  WalletReceipt,
  isTransferTransaction,
  receiptFromTransaction,
} from "@/lib/wallet";
import BottomNavigation from "@/components/BottomNavigation";
import BackButton from "@/components/BackButton";
import GlassPanel from "@/components/GlassPanel";
import { useToast } from "@/components/ToastProvider";
import { MASKED_EMAIL } from "@/lib/paystack/shared";
import WalletAddressCard from "@/components/wallet/WalletAddressCard";
import TransferCoinsModal from "@/components/wallet/TransferCoinsModal";
import WalletReceiptModal from "@/components/wallet/WalletReceiptModal";
import TransactionHistory, {
  HISTORY_PAGE_SIZE,
} from "@/components/wallet/TransactionHistory";

type PaystackSetupOptions = {
  key: string | undefined;
  email: string;
  amount: number;
  currency: "NGN";
  metadata: { coins: number; region: "ngn" | "usd_via_ngn"; user_id: string };
  ref: string;
  callback: (response: { reference: string }) => void;
  onClose: () => void;
};

declare global {
  interface Window {
    PaystackPop?: {
      setup: (options: PaystackSetupOptions) => { openIframe: () => void };
    };
  }
}


/* Accounts allowed to grant coins. This list only decides whether the "Grant
   Coins" shortcut is even visible on the wallet page, so it is not a security
   boundary, just a convenience + access control for the UI — the grant itself
   checks the account and the admin PIN server-side on every request.

   It is the same list the admin panel enforces, imported rather than copied:
   see lib/admin/emails.ts. The server side is the boundary; this is the door
   that matches it. */

const TX_COLUMNS = "id,amount,description,transaction_type,created_at,reference";
/* Rows fetched per round trip. Larger than the 4 shown initially so the first
   "Show more" is instant — the second page is already in memory. */
const FETCH_SIZE = 20;

/* ---------------------------------------------------------------------------
 * Pending payments
 *
 * A payment that left this browser through the Paystack iframe is only as
 * settled as the verify round trip that follows it. If the app closes right
 * after the success screen, the network blips at that moment, or a bank
 * transfer is still settling, that round trip can be lost — and the user
 * paid without the coins moving. (The server-side webhook credits the same
 * transaction without this tab; this reconciliation is the second, honest
 * belt for deployments before the webhook is wired up, and the fast path
 * the user actually sees.)
 *
 * The pending entry is a reference + package, written the moment the
 * charge opens and cleared only when the credit is confirmed (verify is
 * idempotent — credit_verified_payment's reference guard makes every retry
 * a no-op after the first, so retrying a settled payment is free).
 * ------------------------------------------------------------------------- */
const PENDING_PAYMENT_KEY = "whisper:pending-payment";
/* A reference stays redeemable at the gateway far longer than this; a day is
   plenty for a transfer to settle and for the user to come back. */
const PENDING_PAYMENT_TTL_MS = 24 * 60 * 60 * 1000;

type PendingPayment = { reference: string; coins: number; at: number };

function stashPendingPayment(reference: string, coins: number) {
  try {
    const pending: PendingPayment = { reference, coins, at: Date.now() };
    sessionStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify(pending));
  } catch {
    /* Private mode: the callback path below still covers the live case. */
  }
}

function loadPendingPayment(): PendingPayment | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PAYMENT_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw) as PendingPayment;
    if (!pending?.reference || typeof pending.at !== "number" || !Number.isFinite(pending.coins)) return null;
    if (Date.now() - pending.at > PENDING_PAYMENT_TTL_MS) {
      sessionStorage.removeItem(PENDING_PAYMENT_KEY);
      return null;
    }
    return pending;
  } catch {
    return null;
  }
}

export type VerifyOutcome =
  | { kind: "credited"; balance: number; coins: number }
  /** The gateway has not confirmed it yet (bank transfer, USSD). */
  | { kind: "pending" }
  /** Settled, but the rules do not match — retrying will not change the verdict. */
  | { kind: "rejected"; error: string }
  /** The round trip itself failed; the payment may well be fine. */
  | { kind: "network" };

/** One verify round trip, shared by the Paystack callback and the
    pending-payment reconciliation, so they cannot drift apart. */
async function verifyReference(accessToken: string, reference: string): Promise<VerifyOutcome> {
  try {
    const verifyRes = await fetch("/api/paystack/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ reference }),
    });
    const result = await verifyRes.json();
    if (verifyRes.ok) {
      return { kind: "credited", balance: result.balance || 0, coins: result.coins ?? 0 };
    }
    if (verifyRes.status === 202 || result.pending) return { kind: "pending" };
    return { kind: "rejected", error: result.error || "Verification failed." };
  } catch {
    return { kind: "network" };
  }
}

function AnimatedBalance({ value }: { value: number }) {
  const count = useMotionValue(value);
  const rounded = useTransform(count, (latest) => Math.round(latest).toLocaleString());

  useEffect(() => {
    const controls = animate(count, value, { duration: 0.8, ease: "easeOut" });
    return controls.stop;
  }, [count, value]);

  return <motion.span>{rounded}</motion.span>;
}

export default function PremiumPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [userId, setUserId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [balance, setBalance] = useState(0);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [transferOpen, setTransferOpen] = useState(false);
  const [receipt, setReceipt] = useState<WalletReceipt | null>(null);
  /* Which row is waiting on `get_transfer_receipt`. Only the transfer path can
     be slow — every other receipt is built from a row already in memory and
     opens in the same frame as the tap — but without this a tapped transfer row
     gave no feedback at all while the round trip was in flight. */
  const [receiptLoadingId, setReceiptLoadingId] = useState<string | null>(null);

  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [ratesLoading, setRatesLoading] = useState(true);

  const country: CountryInfo = getCountryInfo(countryCode);

  /**
   * Reads one page of history.
   *
   * Ordered by `created_at desc, id desc` — the secondary key matters: two rows
   * written in the same transaction (both halves of a transfer, when a user
   * sends to themselves in testing, or a purchase and its refund) share a
   * timestamp, and without a tiebreaker Postgres is free to order them
   * differently between requests, which would let a row appear on two pages.
   */
  const fetchTransactions = useCallback(async (uid: string, offset: number) => {
    const { data, error } = await supabase
      .from("coin_transactions")
      .select(TX_COLUMNS)
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + FETCH_SIZE - 1);

    if (error) throw error;
    return (data ?? []) as CoinTransaction[];
  }, []);

  const refresh = useCallback(
    async (uid: string) => {
      await supabase.rpc("ensure_coin_wallet", { target_user: uid });

      const [walletResult, txRows] = await Promise.all([
        supabase
          .from("coins")
          .select("balance,wallet_address")
          .eq("user_id", uid)
          .maybeSingle(),
        fetchTransactions(uid, 0),
      ]);

      setBalance(walletResult.data?.balance ?? 0);
      setWalletAddress(walletResult.data?.wallet_address ?? null);
      setTransactions(txRows);
      setHasMore(txRows.length === FETCH_SIZE);
    },
    [fetchTransactions]
  );

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
        return;
      }
      setUserId(session.user.id);

      // Admin grant shortcut is only surfaced to the two allowed accounts.
      setIsAdmin(isAdminEmail(session.user.email, "client"));

      // Pricing is based on the country the user already gave us at signup
      // (profiles.country_code) — no IP guessing, no picker.
      const { data: profile } = await supabase
        .from("profiles")
        .select("country_code")
        .eq("id", session.user.id)
        .maybeSingle();
      setCountryCode(profile?.country_code || null);

      try {
        await refresh(session.user.id);
      } catch {
        showToast("Couldn't load your wallet.", { variant: "error" });
      }
      setLoading(false);
    }
    init();
  }, [router, refresh, showToast]);

  /* Coins can arrive while the page is open — someone transfers to this wallet,
     or a purchase settles on another device. Both write to `coins`, so one
     subscription covers every path. */
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`wallet:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "coins",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          refresh(userId).catch(() => {
            // A dropped refresh isn't worth a toast; the next one recovers.
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  // Live FX rates so the local-currency price shown is accurate. Falls back
  // to the hardcoded table in lib/currency.ts if the provider is unreachable.
  useEffect(() => {
    async function loadRates() {
      try {
        const ratesRes = await fetch("/api/currency/rates");
        const ratesData = await ratesRes.json();
        if (ratesData?.rates) setRates(ratesData.rates);
      } catch {
        // convertForDisplay falls back internally when rates is null
      } finally {
        setRatesLoading(false);
      }
    }
    loadRates();
  }, []);

  /**
   * Reveals the next batch, fetching another page only when the local buffer
   * would run dry. New rows are merged by id, so a transfer that landed via
   * realtime between pages can't be inserted twice.
   */
  const handleShowMore = useCallback(async () => {
    const next = visibleCount + HISTORY_PAGE_SIZE;

    if (next <= transactions.length || !hasMore) {
      setVisibleCount(Math.min(next, transactions.length));
      return;
    }

    setLoadingMore(true);
    try {
      const page = await fetchTransactions(userId, transactions.length);
      setTransactions((current) => {
        const seen = new Set(current.map((tx) => tx.id));
        return [...current, ...page.filter((tx) => !seen.has(tx.id))];
      });
      setHasMore(page.length === FETCH_SIZE);
      setVisibleCount(next);
    } catch {
      showToast("Couldn't load more transactions.", { variant: "error" });
    } finally {
      setLoadingMore(false);
    }
  }, [visibleCount, transactions.length, hasMore, userId, fetchTransactions, showToast]);

  const handleShowLess = useCallback(() => {
    setVisibleCount(HISTORY_PAGE_SIZE);
  }, []);

  /**
   * Opens the receipt for any history row.
   *
   * Two paths, and which one a row takes is not a style choice:
   *
   *   - A **transfer** has a counterparty, a fee and a server-issued reference,
   *     and the two masked wallet addresses on it are only ever produced by the
   *     database. `get_transfer_receipt` is the sole source for those, so a
   *     transfer costs one round trip.
   *   - **Everything else** — a purchase, a spend, a refund, a streak reward, an
   *     admin grant — is a settled single-sided fact whose ledger row already
   *     holds every field the receipt shows. Building it locally opens the modal
   *     in the same frame as the tap, and inventing a server call for it would
   *     add latency to fetch data we are already holding.
   *
   * The guard on `receiptLoadingId` makes a second tap on an in-flight row a
   * no-op rather than a duplicate request.
   */
  const handleOpenReceipt = useCallback(
    async (tx: CoinTransaction) => {
      if (!isTransferTransaction(tx)) {
        setReceipt(receiptFromTransaction(tx));
        return;
      }

      if (receiptLoadingId) return;
      setReceiptLoadingId(tx.id);
      try {
        const { data, error } = await supabase.rpc("get_transfer_receipt", {
          transfer_reference: tx.reference,
        });
        if (error || !data) {
          showToast("Couldn't open that receipt.", { variant: "error" });
          return;
        }
        setReceipt(data as WalletReceipt);
      } finally {
        setReceiptLoadingId(null);
      }
    },
    [receiptLoadingId, showToast]
  );

  /**
   * Hands the transfer to the database and shows whatever receipt comes back.
   *
   * Every rule — address validity, self-transfer, amount, sufficient balance —
   * is enforced inside `transfer_whisper_coins`, which settles both balances in
   * one transaction under row locks. The client-side checks in the modal only
   * save a round trip; they are not what makes this safe.
   */
  const handleTransfer = useCallback(
    async ({
      address,
      amount,
      idempotencyKey,
    }: {
      address: string;
      amount: number;
      idempotencyKey: string;
    }) => {
      try {
        const { data, error } = await supabase.rpc("transfer_whisper_coins", {
          recipient_address: address,
          coin_amount: amount,
          idempotency_key: idempotencyKey,
        });

        if (error) {
          // A thrown exception means nothing was committed — no coins moved.
          setTransferOpen(false);
          setReceipt({
            status: "failed",
            reference: "—",
            amount,
            fee: 0,
            sender_address: null,
            recipient_address: null,
            created_at: new Date().toISOString(),
            failure_reason:
              "We couldn't reach the wallet service. No coins have left your balance.",
          });
          return;
        }

        const result = data as TransferReceipt;
        setTransferOpen(false);
        setReceipt(result);

        if (result.status === "completed") {
          if (typeof result.balance === "number") setBalance(result.balance);
          navigator.vibrate?.(18);
        }

        // Pull the new ledger rows in either case; a failed attempt leaves the
        // balance alone but the refresh keeps history authoritative.
        setVisibleCount(HISTORY_PAGE_SIZE);
        await refresh(userId).catch(() => {});
      } catch {
        setTransferOpen(false);
        setReceipt({
          status: "failed",
          reference: "—",
          amount,
          fee: 0,
          sender_address: null,
          recipient_address: null,
          created_at: new Date().toISOString(),
          failure_reason:
            "Something went wrong. No coins have left your balance.",
        });
      }
    },
    [userId, refresh]
  );

  function localPriceFor(pkg: CoinPackage) {
    const baseAmount = country.ngnRegion ? pkg.ngnAmount : pkg.usdAmount;
    const baseCurrency = country.ngnRegion ? "NGN" : "USD";
    if (country.currency === baseCurrency) {
      return formatLocalAmount(baseAmount, country.symbol);
    }
    const effectiveRates = rates ?? {};
    const converted = convertForDisplay(baseAmount, baseCurrency, country.currency, effectiveRates);
    return formatLocalAmount(converted, country.symbol);
  }

  async function buyCoins(pkg: CoinPackage, eventTimeStamp: number) {
    if (!userId) return;
    await payWithPaystack(pkg, `whisper_${userId}_${pkg.coins}_${Math.round(eventTimeStamp)}`);
  }

  async function payWithPaystack(pkg: CoinPackage, reference: string) {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user.email) {
      showToast("You need to be logged in with an email to purchase.");
      return;
    }

    if (!window.PaystackPop) {
      showToast("Payment system still loading, try again in a second.");
      return;
    }

    // This Paystack account only has the NGN channel active (USD requires a
    // separate international-payments approval from Paystack), so every
    // charge goes out in NGN — Paystack still accepts international
    // Visa/Mastercard for NGN charges, the buyer's card network converts.
    // Foreign buyers' $ price is converted to NGN at the live rate so they
    // still pay the equivalent of $1/$3/$5/$10.
    const region: "ngn" | "usd_via_ngn" = country.ngnRegion ? "ngn" : "usd_via_ngn";
    const ngnPerUsd = rates?.NGN ?? 1550;
    const chargeAmountKobo = country.ngnRegion
      ? pkg.ngnAmount * 100
      : Math.round(pkg.usdAmount * ngnPerUsd * 100);

    setBusy(`buy-${pkg.coins}`);

    /* The charge is about to leave this browser; remember it so a lost
       confirm (closed app, network blip, transfer still settling) is
       reconciled on the next visit instead of paid-for coins that never
       show up. */
    stashPendingPayment(reference, pkg.coins);

    const handler = window.PaystackPop.setup({
      key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
      email: MASKED_EMAIL,
      amount: chargeAmountKobo,
      currency: "NGN",
      metadata: { coins: pkg.coins, region, user_id: session.user.id },
      ref: reference,
      callback: (response: { reference: string }) => {
        (async () => {
          try {
            const outcome = await verifyReference(session.access_token, response.reference);
            if (outcome.kind === "credited") {
              try { sessionStorage.removeItem(PENDING_PAYMENT_KEY); } catch {}
              setBalance(outcome.balance);
              showToast(`🎉 ${outcome.coins || pkg.coins} Whisper Coins added to your wallet!`);
              setVisibleCount(HISTORY_PAGE_SIZE);
              await refresh(userId);
            } else if (outcome.kind === "pending") {
              /* Keep the pending entry: the reconciliation re-checks on the
                 next visit/resume, and the webhook credits it the moment
                 the gateway confirms — coins are not lost either way. */
              showToast("Your payment is being confirmed — coins will be added automatically.");
            } else if (outcome.kind === "rejected") {
              try { sessionStorage.removeItem(PENDING_PAYMENT_KEY); } catch {}
              showToast(outcome.error);
            } else {
              /* Keep the pending entry; reconciliation retries it. */
              showToast("We couldn't confirm your payment yet — we'll keep checking.");
            }
          } finally {
            setBusy(null);
          }
        })();
      },
      onClose: () => {
        setBusy(null);
      },
    });

    handler.openIframe();
  }

  /* ------------------------------------------------------------------
   * Pending-payment reconciliation
   *
   * A payment that left this browser but whose confirm round trip did not
   * land — the tab closed right after the Paystack success screen, the app
   * was backgrounded mid-verify, a transfer was still settling — gets its
   * reference re-verified here: on mount, on window focus, and on app
   * resume. Re-verification is a no-op once the credit has happened
   * (credit_verified_payment's reference guard), so running it often costs
   * one gateway check and nothing else. `rejected` is final (the server
   * told us why — retrying cannot change it); `pending` and `network` keep
   * the entry for the next pass.
   * ------------------------------------------------------------------ */
  const reconcileInFlight = useRef(false);
  useEffect(() => {
    if (!userId) return;
    let active = true;

    const reconcile = async () => {
      if (reconcileInFlight.current) return;
      const pending = loadPendingPayment();
      if (!pending) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!active || !session) return;
      reconcileInFlight.current = true;
      try {
        const outcome = await verifyReference(session.access_token, pending.reference);
        if (!active) return;
        if (outcome.kind === "credited") {
          try { sessionStorage.removeItem(PENDING_PAYMENT_KEY); } catch {}
          setBalance(outcome.balance);
          showToast(`🎉 ${outcome.coins || pending.coins} Whisper Coins added to your wallet!`);
          setVisibleCount(HISTORY_PAGE_SIZE);
          await refresh(userId);
        } else if (outcome.kind === "rejected") {
          try { sessionStorage.removeItem(PENDING_PAYMENT_KEY); } catch {}
          showToast(outcome.error);
        }
        /* pending / network: keep the entry, try again on the next visit. */
      } finally {
        reconcileInFlight.current = false;
      }
    };

    void reconcile();
    const onFocus = () => void reconcile();
    window.addEventListener("focus", onFocus);

    /* The Android app resumes without a window focus: the same pass, from
       the native lifecycle. */
    let removeResume: (() => void) | null = null;
    void import("@capacitor/app")
      .then(({ App }) => {
        if (!active) return;
        App.addListener("resume", () => void reconcile()).then((listener) => {
          if (active) removeResume = () => void listener.remove();
        });
      })
      .catch(() => {});

    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      removeResume?.();
    };
  }, [userId, refresh, showToast]);

  if (loading) {
    return <main className="min-h-screen theme-bg-gradient flex items-center justify-center text-white"><Loader2 className="animate-spin text-purple-400" /></main>;
  }

  return (
    <main className="relative min-h-screen w-full overflow-x-clip theme-bg-gradient pb-32 text-white">
      {/* The one route that calls `window.PaystackPop`, so the one route that
          loads it. `lazyOnload` keeps it off the critical path — the SDK is only
          needed once the user picks a package, which is several taps away, and
          `buyCoins` already guards on `!window.PaystackPop` with a toast. */}
      <Script src="https://js.paystack.co/v1/inline.js" strategy="lazyOnload" />

      <div className="pointer-events-none absolute -top-24 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-purple-500/20 blur-[110px]" />
      <div className="pointer-events-none absolute right-[-80px] top-48 h-72 w-72 rounded-full bg-pink-500/20 blur-[110px]" />

      <div className="relative mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <BackButton />

        <motion.section initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
          <GlassPanel className="max-w-full overflow-hidden rounded-[2rem] p-6 shadow-2xl shadow-purple-600/10">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="eyebrow mb-3 inline-flex items-center gap-2 rounded-full border border-purple-400/30 bg-purple-400/10 px-3 py-1 tracking-[0.25em] text-purple-300"><Sparkles size={14} /> Premium Wallet</p>
                <h1 className="page-title flex items-center gap-3">
                  <WhisperCoinIcon size={36} />
                  Whisper Coins
                </h1>
                <p className="page-subtitle mt-3 max-w-xl">Buy coins for whisper hints, image sends, and one-time inbox chat access from one premium wallet.</p>
              </div>
              <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 4, repeat: Infinity }}>
                <GlassPanel strong className="rounded-[2rem] p-6 text-center">
                  <Coins className="mx-auto mb-3 h-14 w-14 text-yellow-200 drop-shadow-[0_0_18px_rgba(253,224,71,.65)]" />
                  <div className="stat-value"><AnimatedBalance value={balance} /></div>
                  <p className="eyebrow mt-1 tracking-[0.2em] text-yellow-100/80">Current balance</p>
                </GlassPanel>
              </motion.div>
            </div>
          </GlassPanel>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06 }}
          className="mt-6"
        >
          <WalletAddressCard
            address={walletAddress}
            loading={loading}
            onTransfer={() => setTransferOpen(true)}
          />
        </motion.section>

        {/* Admin-only shortcut to grant coins. Hidden from everyone else. */}
        {isAdmin && (
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-6"
          >
            <Link href="/admin/grant-coins" className="block">
              <GlassPanel strong interactive className="flex items-center gap-4 overflow-hidden rounded-3xl p-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-black shadow-lg shadow-amber-500/20">
                  <Gift size={22} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-black text-white">
                    Grant Coins
                    <ShieldCheck size={14} className="text-amber-300" />
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    Admin only — credit Whisper Coins to any user by username.
                  </p>
                </div>
                <ChevronRight size={20} className="shrink-0 text-gray-500" />
              </GlassPanel>
            </Link>
          </motion.section>
        )}

        <section className="mt-8">
          <h2 className="section-title mb-4 flex items-center gap-2"><Gem className="text-cyan-400" /> Buy Coins</h2>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {COIN_PACKAGES.map((pkg) => (
              <motion.div
                key={pkg.coins}
                whileHover={{ y: -6, scale: 1.01 }}
                className="relative min-w-0"
              >
                <GlassPanel className="overflow-hidden rounded-3xl p-6 text-center">
                  {pkg.popular && (
                    <span className="absolute right-4 top-4 rounded-full bg-gradient-to-r from-cyan-400 to-purple-400 px-3 py-1 text-[10px] font-black text-black">
                      MOST POPULAR
                    </span>
                  )}
                  <Coins className="mx-auto mb-4 h-10 w-10 text-yellow-200" />
                  <p className="stat-value">{pkg.coins.toLocaleString()}</p>
                  <p className="text-sm text-gray-300">Whisper Coins</p>
                  <p className="mt-3 text-lg font-black text-cyan-400">
                    {ratesLoading ? <Loader2 size={16} className="mx-auto animate-spin" /> : localPriceFor(pkg)}
                  </p>
                  <button
                    onClick={(event) => buyCoins(pkg, event.timeStamp)}
                    disabled={busy === `buy-${pkg.coins}` || ratesLoading}
                    className="mt-5 w-full rounded-2xl bg-gradient-to-r from-cyan-400 via-purple-300 to-purple-600 px-4 py-3 text-base font-black text-black shadow-lg shadow-cyan-500/20 transition active:scale-95 disabled:opacity-60"
                  >
                    {busy === `buy-${pkg.coins}` ? "Processing..." : "Buy"}
                  </button>
                </GlassPanel>
              </motion.div>
            ))}
          </div>
          <p className="mt-3 text-center text-xs text-gray-500">
            Charged securely via Paystack — your card network converts automatically, so the amount shown is your local equivalent.
          </p>
        </section>

        <div className="mt-8">
          <TransactionHistory
            transactions={transactions}
            visibleCount={visibleCount}
            loadingMore={loadingMore}
            hasMore={hasMore}
            onShowMore={handleShowMore}
            onShowLess={handleShowLess}
            onOpenReceipt={handleOpenReceipt}
            receiptLoadingId={receiptLoadingId}
          />
        </div>
      </div>

      <TransferCoinsModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        balance={balance}
        ownAddress={walletAddress}
        onSubmit={handleTransfer}
      />

      {/* `onRetry` can only ever surface on a failed *transfer*: the modal renders
          it behind `!success`, and a ledger-built receipt is always completed
          because the row exists only once the balance moved. */}
      <WalletReceiptModal
        receipt={receipt}
        onClose={() => setReceipt(null)}
        onRetry={() => {
          setReceipt(null);
          setTransferOpen(true);
        }}
      />

      <BottomNavigation />
    </main>
  );
}
