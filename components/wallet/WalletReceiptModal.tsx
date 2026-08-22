"use client";

import { motion } from "framer-motion";
import { ArrowDownLeft, ArrowUpRight, Check, Copy, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal";
import { copyText } from "@/lib/clipboard";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { spring, tween } from "@/lib/motion";
import { WalletReceipt, formatTransferTimestamp } from "@/lib/wallet";

type WalletReceiptModalProps = {
  receipt: WalletReceipt | null;
  onClose: () => void;
  /** Reopens the transfer form with the same recipient after a failure. */
  onRetry?: () => void;
};

function Row({
  label,
  value,
  mono = false,
  emphasis = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span
        className="flex-none text-[0.8125rem]"
        style={{ color: "var(--theme-text-muted)" }}
      >
        {label}
      </span>
      <span
        className={`min-w-0 break-all text-right text-[0.8125rem] ${
          mono ? "font-mono" : ""
        } ${emphasis ? "font-black" : "font-semibold"}`}
        style={{ color: "var(--theme-text)" }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The confirmation a user keeps — for any wallet movement.
 *
 * Everything here is either a wallet address (masked by the database before it
 * reaches the client) or a number. No names, usernames, emails, or user ids —
 * a receipt is the most screenshotted surface in the app.
 *
 * WHY ONE COMPONENT FOR EVERY TRANSACTION TYPE
 *
 * This started as the transfer-only receipt, and the wallet history only made
 * transfer rows tappable because of it: purchases, spends, refunds, streak
 * rewards and admin grants were inert, which read as a list that was half
 * broken. The fix was not a second modal — a spend receipt and a transfer
 * receipt would drift apart the first time either was touched — but to notice
 * that a transfer receipt is a *superset*. Only transfers have a counterparty, a
 * fee and a failure state, and every one of those rows was already conditional.
 * So the three that were not — the hardcoded "Coin Transfer" type, the always-on
 * fee row, and the missing slot for the ledger's own wording — are the entire
 * difference. See `WalletReceipt` in `lib/wallet.ts`.
 */
export default function WalletReceiptModal({
  receipt,
  onClose,
  onRetry,
}: WalletReceiptModalProps) {
  const isMobile = useMediaQuery("(max-width: 640px)");
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const reference = receipt?.reference;

  /* Clear the copied flag when a different receipt is shown. Adjusted during
     render rather than in an effect so the check mark never lingers into the
     new receipt's first paint. */
  const [copiedFor, setCopiedFor] = useState(reference);
  if (copiedFor !== reference) {
    setCopiedFor(reference);
    setCopied(false);
  }

  const handleCopyReference = useCallback(async () => {
    if (!reference) return;
    if (!(await copyText(reference))) return;
    navigator.vibrate?.(15);
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 2000);
  }, [reference]);

  const success = receipt?.status === "completed";
  /* A transfer receipt fetched from history can be either side of the transfer,
     and a fresh one is always outgoing since only the sender initiates. A ledger
     receipt sets this from the sign of the amount — see `receiptFromTransaction`. */
  const incoming = receipt?.direction === "in";

  const accent = success ? "var(--theme-success)" : "var(--theme-error)";
  const StatusIcon = success ? Check : X;
  const DirectionIcon = incoming ? ArrowDownLeft : ArrowUpRight;

  /* Transfers only. A ledger row has no fee, and a "Fee: None" line on a streak
     reward is a question the user never asked. */
  const showFee = receipt ? receipt.has_fee !== false : false;

  return (
    <Modal
      open={Boolean(receipt)}
      onClose={onClose}
      variant={isMobile ? "sheet" : "center"}
      size="sm"
      showClose
    >
      {receipt && (
        <div className="px-5 pb-6 pt-6 sm:px-6">
          {/* Status seal */}
          <div className="flex flex-col items-center text-center">
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={spring.bouncy}
              className="grid h-16 w-16 place-items-center rounded-full"
              style={{
                background: `color-mix(in srgb, ${accent} 16%, transparent)`,
                border: `1px solid color-mix(in srgb, ${accent} 45%, transparent)`,
              }}
            >
              <StatusIcon size={30} strokeWidth={2.6} style={{ color: accent }} />
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...tween.base, delay: 0.07 }}
              className="eyebrow mt-4 tracking-[0.28em]"
              style={{ color: accent }}
            >
              {success ? "Successful" : "Failed"}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...tween.base, delay: 0.11 }}
              className="mt-2 flex items-center gap-2"
            >
              <DirectionIcon
                size={22}
                style={{ color: success ? accent : "var(--theme-text-muted)" }}
              />
              <span
                className="text-[2rem] font-black leading-none tabular-nums"
                style={{ color: success ? "var(--theme-text)" : "var(--theme-text-muted)" }}
              >
                {/* Absolute value: the arrow already carries the direction, and a
                    minus sign next to a downward arrow reads as a double negative. */}
                {Math.abs(receipt.amount).toLocaleString()}
              </span>
              <span
                className="self-end pb-1 text-[0.8125rem] font-bold"
                style={{ color: "var(--theme-text-muted)" }}
              >
                coins
              </span>
            </motion.div>

            {!success && receipt.failure_reason && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ ...tween.base, delay: 0.14 }}
                className="mt-3 rounded-xl px-3 py-2 text-[0.8125rem] font-medium"
                style={{
                  color: "var(--theme-error)",
                  background: "color-mix(in srgb, var(--theme-error) 10%, transparent)",
                }}
              >
                {receipt.failure_reason}
              </motion.p>
            )}
          </div>

          {/* Perforated tear line — the one overtly "receipt" flourish. */}
          <div className="relative my-5 flex items-center" aria-hidden>
            <span
              className="absolute -left-8 h-5 w-5 rounded-full"
              style={{ background: "var(--theme-surface)" }}
            />
            <span
              className="h-px w-full"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, var(--theme-glass-border) 0 6px, transparent 6px 12px)",
              }}
            />
            <span
              className="absolute -right-8 h-5 w-5 rounded-full"
              style={{ background: "var(--theme-surface)" }}
            />
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ...tween.base, delay: 0.16 }}
            className="divide-y"
            style={{ borderColor: "var(--theme-glass-border)" }}
          >
            <Row label="Transaction type" value={receipt.type_label || "Coin Transfer"} />
            {receipt.detail && <Row label="Details" value={receipt.detail} />}
            {receipt.sender_address && (
              <Row label="From" value={receipt.sender_address} mono />
            )}
            {receipt.recipient_address && (
              <Row label="To" value={receipt.recipient_address} mono />
            )}
            {showFee && (
              <Row
                label="Fee"
                value={receipt.fee > 0 ? `${receipt.fee.toLocaleString()} coins` : "None"}
              />
            )}
            <Row label="Date" value={formatTransferTimestamp(receipt.created_at)} />
            {typeof receipt.balance === "number" && success && !incoming && (
              <Row
                label="New balance"
                value={`${receipt.balance.toLocaleString()} coins`}
                emphasis
              />
            )}
          </motion.div>

          {/* Reference sits apart from the rows — it's the one value a user
              copies out, so it gets its own affordance. */}
          <button
            type="button"
            onClick={handleCopyReference}
            className="mt-4 flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition-colors"
            style={{
              background: "var(--fill-2)",
              border: "1px solid var(--theme-glass-border)",
            }}
          >
            <span className="min-w-0">
              <span
                className="block text-[0.6875rem] uppercase tracking-[0.18em]"
                style={{ color: "var(--theme-text-muted)" }}
              >
                Reference
              </span>
              <span
                className="mt-0.5 block truncate font-mono text-[0.8125rem] font-semibold"
                style={{ color: "var(--theme-text)" }}
              >
                {receipt.reference}
              </span>
            </span>
            {copied ? (
              <Check size={16} className="flex-none text-emerald-400" />
            ) : (
              <Copy
                size={16}
                className="flex-none"
                style={{ color: "var(--theme-text-muted)" }}
              />
            )}
          </button>
          <span className="sr-only" role="status" aria-live="polite">
            {copied ? "Reference copied to clipboard" : ""}
          </span>

          <div className="mt-5 flex gap-2.5">
            {!success && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="premium-button premium-button-secondary flex-1 justify-center py-2.5"
              >
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="premium-button premium-button-primary flex-1 justify-center py-2.5"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
