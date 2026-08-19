"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import GlassPanel from "@/components/GlassPanel";
import BackButton from "@/components/BackButton";
import { Gift, Loader2, ShieldCheck } from "lucide-react";

export default function GrantCoinsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [checking, setChecking] = useState(true);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [pinVerified, setPinVerified] = useState(false);
  const [pin, setPin] = useState("");
  const [verifyingPin, setVerifyingPin] = useState(false);

  const [username, setUsername] = useState("");
  const [coinAmount, setCoinAmount] = useState("");
  const [note, setNote] = useState("Premium Grant");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
        return;
      }

      /* No `profiles.is_admin` lookup any more. That check is what bounced this
         page to /dashboard: the column has to be set by hand per account, and an
         account without it was indistinguishable from a database that never had
         the column at all. The PIN is the credential now, and it is verified
         server-side on every grant — see app/api/admin/grant-coins/route.ts. */
      setChecking(false);
    }
    init();
  }, [router]);

  async function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setVerifyingPin(true);
    try {
      const res = await fetch("/api/admin/verify-pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();

      if (!res.ok) {
        /* A 500 here is a server misconfiguration, not a typo — ADMIN_GRANT_PIN
           missing from the deploy environment. Retyping the PIN can never fix it,
           so it goes to the blocking panel instead of a toast the user would
           dismiss and try again against. */
        if (res.status === 500) {
          setBlocked(data.error || "The server is not configured for coin grants.");
          return;
        }
        showToast(data.error || "Incorrect PIN.");
        return;
      }
      setPinVerified(true);
    } catch (err) {
      console.error("PIN verify error:", err);
      showToast("Something went wrong verifying the PIN. Check console.");
    } finally {
      setVerifyingPin(false);
    }
  }

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    const cleanUsername = username.trim().toLowerCase();
    const amount = parseInt(coinAmount, 10);

    if (!cleanUsername) {
      showToast("Enter a username.");
      return;
    }
    if (!amount || amount <= 0) {
      showToast("Enter a valid coin amount.");
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push("/login");
      return;
    }

    setBusy(true);
    try {
      /* Posted to our own server rather than calling supabase.rpc directly. The
         RPC is revoked from `authenticated` by 202608190004 and refuses any caller
         with a user JWT, so the service role key — which only exists server-side —
         is the sole way to reach it. The PIN travels with the request because the
         server re-checks it here; the unlocked form is a rendering state and
         proves nothing on its own. */
      const res = await fetch("/api/admin/grant-coins", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ pin, username: cleanUsername, amount, note: note.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || "Could not grant coins.");
        return;
      }

      showToast(`✅ Granted ${amount} coins to @${cleanUsername}. New balance: ${data.balance}`);
      setUsername("");
      setCoinAmount("");
    } catch (err) {
      console.error("Grant error:", err);
      showToast("Something went wrong granting coins. Check console.");
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <main className="min-h-screen theme-bg-gradient flex items-center justify-center text-white">
        <Loader2 className="animate-spin text-purple-400" />
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient text-white px-4 py-8">
      <div className="mx-auto max-w-md">
        <BackButton />

        {blocked ? (
          <GlassPanel strong className="mt-6 rounded-3xl p-8">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15">
              <ShieldCheck size={26} className="text-amber-300" />
            </div>
            <h1 className="page-title text-center">Setup Incomplete</h1>
            <p className="mt-2 text-center text-sm text-gray-400">{blocked}</p>
          </GlassPanel>
        ) : !pinVerified ? (
          <GlassPanel strong className="mt-6 rounded-3xl p-8">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-purple-600/15">
              <ShieldCheck size={26} className="text-purple-400" />
            </div>
            <h1 className="page-title text-center">Admin PIN Required</h1>
            <p className="mt-2 mb-6 text-center text-sm text-gray-400">
              Enter your admin PIN to access coin granting.
            </p>

            <form onSubmit={handlePinSubmit} className="space-y-4">
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter PIN"
                autoFocus
                className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 text-center tracking-widest outline-none focus:border-purple-500"
              />
              <button
                type="submit"
                disabled={verifyingPin}
                className="w-full rounded-2xl bg-gradient-to-r from-purple-600 to-purple-500 p-4 font-bold text-black disabled:opacity-60"
              >
                {verifyingPin ? "Verifying..." : "Unlock"}
              </button>
            </form>
          </GlassPanel>
        ) : (
          <GlassPanel strong className="mt-6 rounded-3xl p-8">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-purple-500/15">
              <Gift size={26} className="text-purple-300" />
            </div>
            <h1 className="page-title text-center">Grant Beta Coins</h1>
            <p className="mt-2 mb-6 text-center text-sm text-gray-400">
              Instantly credits Whisper Coins to any user by username.
            </p>

            <form onSubmit={handleGrant} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-gray-400">Username</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. frozenfox7057"
                  className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Coin amount</label>
                <input
                  type="number"
                  min={1}
                  value={coinAmount}
                  onChange={(e) => setCoinAmount(e.target.value)}
                  placeholder="e.g. 500"
                  className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Note (optional, shows in their wallet history)</label>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Premium Grant"
                  className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none focus:border-purple-500"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-2xl bg-gradient-to-r from-purple-600 to-purple-500 p-4 font-bold text-black disabled:opacity-60"
              >
                {busy ? "Granting.." : "Grant Coins"}
              </button>
            </form>
          </GlassPanel>
        )}
      </div>
    </main>
  );
}