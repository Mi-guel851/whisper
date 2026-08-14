"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, ArrowRight, ClipboardPaste, Coins, Wallet } from "lucide-react";
import Modal from "@/components/Modal";
import { canPasteFromClipboard, readText } from "@/lib/clipboard";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { tween } from "@/lib/motion";
import {
  TRANSFER_FEE,
  WALLET_ADDRESS_EXAMPLE,
  normalizeWalletAddress,
  validateTransferAmount,
} from "@/lib/wallet";

type TransferCoinsModalProps = {
  open: boolean;
  onClose: () => void;
  balance: number;
  ownAddress: string | null;
  /**
   * Resolves once the transfer has been settled or rejected by the database.
   * `idempotencyKey` is stable across retries of the same attempt, so a
   * double-submit can never move coins twice.
   */
  onSubmit: (input: {
    address: string;
    amount: number;
    idempotencyKey: string;
  }) => Promise<void>;
};

function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // Older WebViews without randomUUID — still unique enough to key one attempt.
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export default function TransferCoinsModal({
  open,
  onClose,
  balance,
  ownAddress,
  onSubmit,
}: TransferCoinsModalProps) {
  const isMobile = useMediaQuery("(max-width: 640px)");

  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState({ address: false, amount: false });

  /* One key per attempt, minted when the sheet opens. The database treats a
     repeat of the same key as a replay and returns the original receipt, so a
     retry can never move coins twice. */
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  /* Belt to the `submitting` braces: state updates are async, so two taps in
     the same tick can both read `submitting === false` before either render
     lands. Storing the key rather than a boolean means the guard re-arms by
     itself on the next attempt — nothing has to reset it. */
  const inFlightKey = useRef<string | null>(null);

  const canPaste = useMemo(() => canPasteFromClipboard(), []);

  /* Reset for the next transfer once the sheet is dismissed.
     Adjusting state during render rather than in an effect: this is a reset in
     response to a prop change, so React re-renders with the new values before
     committing anything to the DOM — an effect would paint the stale form for
     a frame and cascade an extra render.
     https://react.dev/learn/you-might-not-need-an-effect */
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setAddress("");
      setAmount("");
      setTouched({ address: false, amount: false });
      setSubmitting(false);
      setIdempotencyKey(newIdempotencyKey());
    }
  }

  const normalized = normalizeWalletAddress(address);
  const isSelf = Boolean(normalized && ownAddress && normalized === ownAddress);

  const addressError = !address.trim()
    ? null
    : !normalized
      ? "That doesn't look like a Whispers wallet address."
      : isSelf
        ? "That's your own wallet — pick someone else's address."
        : null;

  const amountCheck = validateTransferAmount(amount, balance);
  const amountError = amountCheck.error;

  const ready = Boolean(normalized) && !isSelf && amountCheck.valid;

  const handlePaste = useCallback(async () => {
    const text = await readText();
    if (text === null) return;
    setAddress(text.trim());
    setTouched((t) => ({ ...t, address: true }));
  }, []);

  const handleSubmit = useCallback(async () => {
    setTouched({ address: true, amount: true });
    if (!ready || !normalized) return;
    // Already submitting this exact attempt — ignore the repeat tap.
    if (inFlightKey.current === idempotencyKey) return;

    inFlightKey.current = idempotencyKey;
    setSubmitting(true);
    try {
      await onSubmit({
        address: normalized,
        amount: Number(amount),
        idempotencyKey,
      });
    } finally {
      setSubmitting(false);
    }
  }, [ready, normalized, amount, idempotencyKey, onSubmit]);

  const showAddressError = touched.address && addressError;
  const showAmountError = touched.amount && amountError;

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      variant={isMobile ? "sheet" : "center"}
      size="md"
      showClose={!submitting}
      dismissOnBackdrop={!submitting}
      title="Transfer Whisper Coins"
      description="Send coins straight to another Whispers wallet."
    >
      <div className="px-5 pb-6 pt-2 sm:px-6">
        {/* Available balance — the number every other field is judged against,
            so it sits above them rather than as a hint underneath. */}
        <div
          className="flex items-center justify-between rounded-2xl px-4 py-3"
          style={{
            background: "var(--fill-2)",
            border: "1px solid var(--theme-glass-border)",
          }}
        >
          <span
            className="text-[0.8125rem] font-semibold"
            style={{ color: "var(--theme-text-secondary)" }}
          >
            Available balance
          </span>
          <span className="inline-flex items-center gap-1.5 font-black text-yellow-200">
            <Coins size={15} />
            {balance.toLocaleString()}
          </span>
        </div>

        {/* Recipient ------------------------------------------------------ */}
        <label
          htmlFor="transfer-address"
          className="mt-5 block text-[0.8125rem] font-semibold"
          style={{ color: "var(--theme-text-secondary)" }}
        >
          Recipient wallet address
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="transfer-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, address: true }))}
            disabled={submitting}
            spellCheck={false}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder={WALLET_ADDRESS_EXAMPLE}
            aria-invalid={Boolean(showAddressError)}
            aria-describedby="transfer-address-msg"
            className="premium-input min-w-0 flex-1 font-mono text-[0.8125rem] tracking-wide"
          />
          {canPaste && (
            <button
              type="button"
              onClick={handlePaste}
              disabled={submitting}
              aria-label="Paste wallet address"
              className="premium-button premium-button-secondary flex-none gap-1.5 px-3.5 py-2.5 text-[0.8125rem] disabled:opacity-50"
            >
              <ClipboardPaste size={15} />
              <span className="hidden sm:inline">Paste</span>
            </button>
          )}
        </div>

        <div id="transfer-address-msg" className="min-h-[1.25rem] pt-1.5">
          <AnimatePresence mode="wait" initial={false}>
            {showAddressError ? (
              <motion.p
                key="err"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={tween.fast}
                className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium"
                style={{ color: "var(--theme-error)" }}
              >
                <AlertCircle size={13} />
                {addressError}
              </motion.p>
            ) : normalized && !isSelf ? (
              <motion.p
                key="ok"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={tween.fast}
                className="inline-flex items-center gap-1.5 font-mono text-[0.75rem]"
                style={{ color: "var(--theme-success)" }}
              >
                <Wallet size={13} />
                {normalized}
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Amount -------------------------------------------------------- */}
        <div className="mt-3 flex items-baseline justify-between">
          <label
            htmlFor="transfer-amount"
            className="text-[0.8125rem] font-semibold"
            style={{ color: "var(--theme-text-secondary)" }}
          >
            Amount
          </label>
          <button
            type="button"
            onClick={() => {
              setAmount(String(balance));
              setTouched((t) => ({ ...t, amount: true }));
            }}
            disabled={submitting || balance <= 0}
            className="text-[0.75rem] font-bold text-cyan-300 transition-opacity disabled:opacity-40"
          >
            Send max
          </button>
        </div>
        <input
          id="transfer-amount"
          value={amount}
          /* `inputMode="numeric"` rather than `type="number"`: coins are whole
             numbers, and a number input would let the spinner and locale
             decimal separators introduce fractions we'd have to reject. */
          inputMode="numeric"
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
          onBlur={() => setTouched((t) => ({ ...t, amount: true }))}
          disabled={submitting}
          placeholder="0"
          aria-invalid={Boolean(showAmountError)}
          aria-describedby="transfer-amount-msg"
          className="premium-input mt-1.5 w-full text-lg font-black tabular-nums"
        />

        <div id="transfer-amount-msg" className="min-h-[1.25rem] pt-1.5">
          <AnimatePresence mode="wait" initial={false}>
            {showAmountError && (
              <motion.p
                key="err"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={tween.fast}
                className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium"
                style={{ color: "var(--theme-error)" }}
              >
                <AlertCircle size={13} />
                {amountError}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {TRANSFER_FEE === 0 && (
          <p
            className="mt-1 text-[0.75rem]"
            style={{ color: "var(--theme-text-muted)" }}
          >
            No transfer fee — the recipient gets the full amount.
          </p>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!ready || submitting}
          className="premium-button premium-button-primary mt-5 w-full justify-center gap-2 py-3 text-[0.9375rem] disabled:opacity-50"
        >
          {submitting ? (
            <>
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                aria-hidden
              />
              Processing transfer…
            </>
          ) : (
            <>
              Send
              {amountCheck.valid ? ` ${Number(amount).toLocaleString()} coins` : " coins"}
              <ArrowRight size={16} />
            </>
          )}
        </button>

        <p
          className="mt-3 text-center text-[0.6875rem] leading-relaxed"
          style={{ color: "var(--theme-text-muted)" }}
        >
          Transfers are instant and final. Double-check the address — coins sent
          to the wrong wallet can&apos;t be recalled.
        </p>
      </div>
    </Modal>
  );
}
