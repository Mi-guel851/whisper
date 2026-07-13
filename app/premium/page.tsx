"use client";

import WhisperCoinIcon from "@/components/WhisperCoinIcon";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Coins, Gem, LockKeyhole, Sparkles, WalletCards, Eye, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { COIN_PACKAGES, REVEAL_SENDER_COST, CoinPackage } from "@/lib/coins";
import { CountryInfo, convertForDisplay, formatLocalAmount, getCountryInfo } from "@/lib/currency";
import BottomNavigation from "@/components/BottomNavigation";
import BackButton from "@/components/BackButton";
import GlassPanel from "@/components/GlassPanel";
import { useToast } from "@/components/ToastProvider";

declare global {
  interface Window {
    PaystackPop: any;
  }
}

const PAYSTACK_MASKED_EMAIL = "whisper.anonymous.app@gmail.com";

type Transaction = { id: string; amount: number; description: string; transaction_type: string; created_at: string };
type Whisper = { id: string; message: string | null; sender_username: string | null; sender_email_name: string | null; created_at: string };
type Reveal = { message_id: string };

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
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [whispers, setWhispers] = useState<Whisper[]>([]);
  const [reveals, setReveals] = useState<Reveal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [ratesLoading, setRatesLoading] = useState(true);

  const country: CountryInfo = getCountryInfo(countryCode);

  const revealedIds = useMemo(() => new Set(reveals.map((r) => r.message_id)), [reveals]);

  async function refresh(uid: string) {
    await supabase.rpc("ensure_coin_wallet", { target_user: uid });
    const [{ data: wallet }, { data: txs }, { data: msgs }, { data: unlocked }] = await Promise.all([
      supabase.from("coins").select("balance").eq("user_id", uid).maybeSingle(),
      supabase.from("coin_transactions").select("id,amount,description,transaction_type,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(12),
      supabase.from("messages").select("id,message,sender_username,sender_email_name,created_at").eq("recipient_id", uid).order("created_at", { ascending: false }).limit(6),
      supabase.from("anonymous_sender_reveals").select("message_id").eq("user_id", uid),
    ]);
    setBalance(wallet?.balance || 0);
    setTransactions(txs || []);
    setWhispers(msgs || []);
    setReveals(unlocked || []);
  }

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

      await refresh(session.user.id);
      setLoading(false);
    }
    init();
  }, [router]);

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

  async function buyCoins(pkg: CoinPackage) {
    if (!userId) return;
    await payWithPaystack(pkg);
  }

  async function payWithPaystack(pkg: CoinPackage) {
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
      ref: `whisper_${session.user.id}_${pkg.coins}_${Date.now()}`,
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

  async function revealSender(messageId: string) {
    if (!userId) return;
    setBusy(`reveal-${messageId}`);
    const { data, error } = await supabase.rpc("reveal_sender_with_coins", { target_message_id: messageId });
    if (error) showToast(error.message);
    else {
      setBalance(data || 0);
      showToast("Sender reveal unlocked.");
      await refresh(userId);
    }
    setBusy(null);
  }

  if (loading) {
    return <main className="min-h-screen theme-bg-gradient flex items-center justify-center text-white"><Loader2 className="animate-spin text-cyan-300" /></main>;
  }

  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient pb-32 text-white">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-cyan-400/20 blur-[110px]" />
      <div className="pointer-events-none absolute right-[-80px] top-48 h-72 w-72 rounded-full bg-pink-500/20 blur-[110px]" />

      <div className="relative mx-auto max-w-5xl px-6 py-8">
        <BackButton />

        <motion.section initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="mt-6 overflow-hidden rounded-[2rem] border border-white/15 bg-white/[0.08] p-6 shadow-2xl shadow-cyan-500/10 backdrop-blur-2xl">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-black uppercase tracking-[0.25em] text-cyan-200"><Sparkles size={14} /> Premium Wallet</p>
              <h1 className="flex items-center gap-3 text-5xl font-black tracking-tight">
  <WhisperCoinIcon size={44} />
  Whisper Coins
</h1>
              <p className="mt-3 max-w-xl text-sm text-gray-300">Unlock sender reveals and one-time inbox chat access from one premium wallet.</p>
            </div>
            <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 4, repeat: Infinity }} className="rounded-[2rem] border border-yellow-200/30 bg-gradient-to-br from-yellow-200/25 via-pink-400/15 to-cyan-400/20 p-6 text-center shadow-2xl shadow-yellow-300/10">
              <Coins className="mx-auto mb-3 h-14 w-14 text-yellow-200 drop-shadow-[0_0_18px_rgba(253,224,71,.65)]" />
              <div className="text-5xl font-black"><AnimatedBalance value={balance} /></div>
              <p className="mt-1 text-xs font-bold uppercase tracking-[0.2em] text-yellow-100/80">Current balance</p>
            </motion.div>
          </div>
        </motion.section>

        <section className="mt-8">
          <h2 className="mb-4 flex items-center gap-2 text-2xl font-black"><Gem className="text-pink-300" /> Buy Coins</h2>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {COIN_PACKAGES.map((pkg) => (
              <motion.div
                key={pkg.coins}
                whileHover={{ y: -6, scale: 1.01 }}
                className="relative overflow-hidden rounded-3xl border border-white/15 bg-white/[0.07] p-6 text-center shadow-xl backdrop-blur-xl"
              >
                {pkg.popular && (
                  <span className="absolute right-4 top-4 rounded-full bg-gradient-to-r from-cyan-300 to-pink-300 px-3 py-1 text-[10px] font-black text-black">
                    MOST POPULAR
                  </span>
                )}
                <Coins className="mx-auto mb-4 h-10 w-10 text-yellow-200" />
                <p className="text-3xl font-black">{pkg.coins.toLocaleString()}</p>
                <p className="text-sm text-gray-300">Whisper Coins</p>
                <p className="mt-3 text-lg font-black text-cyan-200">
                  {ratesLoading ? <Loader2 size={16} className="mx-auto animate-spin" /> : localPriceFor(pkg)}
                </p>
                <button
                  onClick={() => buyCoins(pkg)}
                  disabled={busy === `buy-${pkg.coins}` || ratesLoading}
                  className="mt-5 w-full rounded-2xl bg-gradient-to-r from-cyan-300 via-purple-300 to-pink-300 px-4 py-3 text-base font-black text-black shadow-lg shadow-cyan-400/20 transition active:scale-95 disabled:opacity-60"
                >
                  {busy === `buy-${pkg.coins}` ? "Processing..." : "Buy"}
                </button>
              </motion.div>
            ))}
          </div>
          <p className="mt-3 text-center text-xs text-gray-500">
            Charged securely via Paystack — your card network converts automatically, so the amount shown is your local equivalent.
          </p>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
          <GlassPanel className="rounded-3xl p-5">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-black"><Eye className="text-cyan-300" /> Reveal anonymous sender</h2>
            <p className="mb-4 text-sm text-gray-400">Costs {REVEAL_SENDER_COST} coins. Reveals only username and Gmail alphabetic name — never the full email or domain.</p>
            <div className="space-y-3">
              {whispers.length === 0 ? <p className="text-sm text-gray-400">No whispers yet.</p> : whispers.map((msg) => {
                const unlocked = revealedIds.has(msg.id);
                return <div key={msg.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="truncate text-sm text-gray-300">{msg.message || "📷 Image whisper"}</p>
                  {unlocked ? <div className="mt-3 grid gap-2 rounded-2xl bg-emerald-400/10 p-3 text-sm"><span>Username: <b>{msg.sender_username || "Unknown"}</b></span><span>Email name: <b>{msg.sender_email_name || "Unavailable"}</b></span></div> : <button onClick={() => revealSender(msg.id)} disabled={busy === `reveal-${msg.id}`} className="mt-3 rounded-xl bg-white/10 px-4 py-2 text-sm font-bold text-cyan-100 transition hover:bg-white/15 disabled:opacity-60"><LockKeyhole className="mr-2 inline h-4 w-4" /> Unlock for {REVEAL_SENDER_COST}</button>}
                </div>;
              })}
            </div>
          </GlassPanel>

          <GlassPanel className="rounded-3xl p-5">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-black"><WalletCards className="text-purple-300" /> Wallet History</h2>
            <div className="space-y-3">
              {transactions.length === 0 ? <p className="text-sm text-gray-400">No transactions yet.</p> : transactions.map((tx) => <div key={tx.id} className="flex items-center justify-between rounded-2xl bg-white/[0.05] p-3"><div><p className="font-bold">{tx.description}</p><p className="text-xs text-gray-500">{new Date(tx.created_at).toLocaleString()}</p></div><span className={tx.amount > 0 ? "font-black text-emerald-300" : "font-black text-pink-300"}>{tx.amount > 0 ? "+" : ""}{tx.amount}</span></div>)}
            </div>
          </GlassPanel>
        </div>
      </div>
      <BottomNavigation />
    </main>
  );
}