"use client";

import WhisperCoinIcon from "@/components/WhisperCoinIcon";
import Script from "next/script";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Coins, Gem, Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { COIN_PACKAGES, CoinPackage } from "@/lib/coins";
import { CountryInfo, convertForDisplay, formatLocalAmount, getCountryInfo } from "@/lib/currency";
import { TransferReceipt } from "@/lib/wallet";
import BottomNavigation from "@/components/BottomNavigation";
import BackButton from "@/components/BackButton";
import GlassPanel from "@/components/GlassPanel";
import { useToast } from "@/components/ToastProvider";
import WalletAddressCard from "@/components/wallet/WalletAddressCard";
import TransferCoinsModal from "@/components/wallet/TransferCoinsModal";
import TransferReceiptModal from "@/components/wallet/TransferReceiptModal";
import TransactionHistory, {
  CoinTransaction,
  HISTORY_PAGE_SIZE,
} from "@/components/wallet/TransactionHistory";

type PaystackSetupOptions = {
  key: string | undefined;
  email: string;
  amount: number;
  currency: "NGN";
  metadata: { coins: number; region: "ngn" | "usd_via_ngn" };
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

const PAYSTACK_MASKED_EMAIL = "whisper.anonymous.app@gmail.com";

const TX_COLUMNS = "id,amount,description,transaction_type,created_at,reference";
/* Rows fetched per round trip. Larger than the 4 shown initially so the first
   "Show more" is instant — the second page is already in memory. */
const FETCH_SIZE = 20;

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
  const [balance, setBalance] = useState(0);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [transferOpen, setTransferOpen] = useState(false);
  const [receipt, setReceipt] = useState<TransferReceipt | null>(null);

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

  const handleOpenReceipt = useCallback(
    async (reference: string) => {
      const { data, error } = await supabase.rpc("get_transfer_receipt", {
        transfer_reference: reference,
      });
      if (error || !data) {
        showToast("Couldn't open that receipt.", { variant: "error" });
        return;
      }
      setReceipt(data as TransferReceipt);
    },
    [showToast]
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

    const handler = window.PaystackPop.setup({
      key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
      email: PAYSTACK_MASKED_EMAIL,
      amount: chargeAmountKobo,
      currency: "NGN",
      metadata: { coins: pkg.coins, region },
      ref: reference,
      callback: (response: { reference: string }) => {
        (async () => {
          try {
            const verifyRes = await fetch("/api/paystack/verify", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ reference: response.reference }),
            });

            const result = await verifyRes.json();

            if (!verifyRes.ok) {
              showToast(result.error || "Verification failed.");
            } else {
              setBalance(result.balance || 0);
              showToast(`🎉 ${result.coins ?? pkg.coins} Whisper Coins added to your wallet!`);
              setVisibleCount(HISTORY_PAGE_SIZE);
              await refresh(userId);
            }
          } catch {
            showToast("Something went wrong verifying your payment.");
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

      <TransferReceiptModal
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
