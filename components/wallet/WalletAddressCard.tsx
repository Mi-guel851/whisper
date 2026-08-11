"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Copy, QrCode, Send, Wallet } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { maskWalletAddress, walletAddressGroups } from "@/lib/wallet";
import { spring, tween } from "@/lib/motion";
import GlassPanel from "@/components/GlassPanel";

type WalletAddressCardProps = {
  address: string | null;
  loading?: boolean;
  onTransfer: () => void;
};

/**
 * The user's receiving address.
 *
 * Shown in full — this is the one surface where the owner sees their own
 * address unmasked, because the whole point is to hand it to someone else.
 * History and receipts use `maskWalletAddress` instead.
 */
export default function WalletAddressCard({
  address,
  loading = false,
  onTransfer,
}: WalletAddressCardProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!address) return;
    const ok = await copyText(address);
    if (!ok) return;

    navigator.vibrate?.(15);
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 2000);
  }, [address]);

  const groups = walletAddressGroups(address);

  return (
    <GlassPanel className="relative overflow-hidden rounded-[1.75rem] p-5 sm:p-6">
      {/* Faint ledger grid — reads as "wallet" without tipping into fake-crypto. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.055]"
        style={{
          backgroundImage:
            "linear-gradient(var(--theme-text) 1px, transparent 1px), linear-gradient(90deg, var(--theme-text) 1px, transparent 1px)",
          backgroundSize: "34px 34px",
          maskImage: "radial-gradient(120% 90% at 85% 0%, #000 0%, transparent 72%)",
          WebkitMaskImage:
            "radial-gradient(120% 90% at 85% 0%, #000 0%, transparent 72%)",
        }}
      />

      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 tracking-[0.22em] text-cyan-200">
            <Wallet size={13} /> Wallet Address
          </p>
          <p
            className="mt-3 text-[0.8125rem] leading-snug"
            style={{ color: "var(--theme-text-secondary)" }}
          >
            Share this to receive Whisper Coins from anyone in the app.
          </p>
        </div>

        <QrCode
          size={30}
          aria-hidden
          className="hidden flex-none text-purple-300/40 sm:block"
        />
      </div>

      {/* The address itself. Monospace + per-group chunks so it stays readable
          on a phone, where the full string would otherwise wrap mid-token. */}
      <div
        className="relative mt-4 rounded-2xl px-3 py-3 sm:px-4"
        style={{
          background: "var(--fill-2)",
          border: "1px solid var(--theme-glass-border)",
        }}
      >
        {loading || !address ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="skeleton h-5 w-[5.5rem] rounded-md" />
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="skeleton h-5 w-11 rounded-md" />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[0.8125rem] font-semibold tracking-wider sm:text-[0.9375rem]">
            <span className="text-purple-300">WHISPERS</span>
            {groups.map((group, index) => (
              <span key={index} className="flex items-center gap-1.5">
                <span style={{ color: "var(--theme-text-muted)" }}>-</span>
                <span style={{ color: "var(--theme-text)" }}>{group}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="relative mt-4 flex flex-col gap-2.5 sm:flex-row">
        <button
          type="button"
          onClick={handleCopy}
          disabled={!address || loading}
          aria-label={copied ? "Address copied" : "Copy wallet address"}
          className="premium-button premium-button-secondary flex-1 justify-center gap-2 px-5 py-2.5 disabled:opacity-50"
        >
          {/* Both labels are laid out in the same grid cell so the button keeps
              its width when the icon swaps — a resize here reads as a glitch. */}
          <span className="grid place-items-center">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={copied ? "copied" : "copy"}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={spring.snappy}
                className="col-start-1 row-start-1 inline-flex items-center gap-2"
              >
                {copied ? (
                  <>
                    <Check size={15} className="text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={15} />
                    Copy address
                  </>
                )}
              </motion.span>
            </AnimatePresence>
          </span>
        </button>

        <button
          type="button"
          onClick={onTransfer}
          disabled={!address || loading}
          className="premium-button premium-button-primary flex-1 justify-center gap-2 px-5 py-2.5 disabled:opacity-50"
        >
          <Send size={15} />
          Transfer coins
        </button>
      </div>

      {/* Screen-reader announcement for the copy, which is otherwise silent. */}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Wallet address copied to clipboard" : ""}
      </span>

      {address && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={tween.base}
          className="relative mt-3 text-center text-[0.6875rem] sm:text-left"
          style={{ color: "var(--theme-text-muted)" }}
        >
          Short form: <span className="font-mono">{maskWalletAddress(address)}</span>
        </motion.p>
      )}
    </GlassPanel>
  );
}
