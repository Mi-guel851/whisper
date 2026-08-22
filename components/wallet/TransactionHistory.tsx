"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Coins,
  Flame,
  Gift,
  Loader2,
  Receipt,
  ShoppingBag,
  Undo2,
  WalletCards,
} from "lucide-react";
import { staggerItem, tween } from "@/lib/motion";
import GlassPanel from "@/components/GlassPanel";
import type { CoinTransaction } from "@/lib/wallet";

type TransactionHistoryProps = {
  transactions: CoinTransaction[];
  /** How many are shown right now — the parent owns pagination state. */
  visibleCount: number;
  /** True while the next page is in flight. */
  loadingMore: boolean;
  /** False once the server has no further rows. */
  hasMore: boolean;
  onShowMore: () => void;
  onShowLess: () => void;
  /**
   * Opens the receipt for a row — any row.
   *
   * Takes the whole transaction rather than a reference string because the row
   * has no business knowing that transfers are fetched from an RPC while every
   * other type is built from the row itself. That decision belongs to the parent
   * (see `isTransferTransaction` in `lib/wallet.ts`).
   */
  onOpenReceipt: (tx: CoinTransaction) => void;
  /** Id of the row whose receipt is currently being fetched, if any. */
  receiptLoadingId?: string | null;
};

export const HISTORY_PAGE_SIZE = 4;

/**
 * One icon per `transaction_type`, with `Receipt` as the fallback.
 *
 * The fallback matters: the type check on `coin_transactions` is rebuilt from
 * whatever values already exist in the live table, so a type can be present in
 * production that this file has never heard of. It gets a generic receipt icon
 * rather than an empty slot.
 */
const typeIcon: Record<string, typeof Receipt> = {
  purchase: ShoppingBag,
  refund: Undo2,
  transfer_in: ArrowDownLeft,
  transfer_out: ArrowUpRight,
  spend: Coins,
  reward: Flame,
  grant: Gift,
};

function iconFor(tx: CoinTransaction) {
  return typeIcon[tx.transaction_type] ?? Receipt;
}

export default function TransactionHistory({
  transactions,
  visibleCount,
  loadingMore,
  hasMore,
  onShowMore,
  onShowLess,
  onOpenReceipt,
  receiptLoadingId = null,
}: TransactionHistoryProps) {
  const visible = transactions.slice(0, visibleCount);
  const expanded = visibleCount > HISTORY_PAGE_SIZE;

  /* The button only appears when there is somewhere to go: either the server
     has more rows, we're holding rows back locally, or we're expanded and can
     collapse. A user with four or fewer transactions never sees it. */
  const canExpand = hasMore || transactions.length > visibleCount;
  const showButton = canExpand || expanded;

  return (
    <GlassPanel className="rounded-3xl p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-black">
          <WalletCards className="text-purple-300" /> Wallet History
        </h2>
        {transactions.length > 0 && (
          <span
            className="text-[0.75rem] font-semibold tabular-nums"
            style={{ color: "var(--theme-text-muted)" }}
          >
            {visible.length} of {transactions.length}
            {hasMore ? "+" : ""}
          </span>
        )}
      </div>

      {transactions.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">
          No transactions yet.
        </p>
      ) : (
        <>
          {/* `layout` on the list plus `popLayout` keeps the rows below a newly
              revealed batch from jumping — they slide down instead. */}
          <motion.div layout className="space-y-3">
            <AnimatePresence initial={false} mode="popLayout">
              {visible.map((tx) => {
                const Icon = iconFor(tx);
                const credit = tx.amount > 0;
                /* Every row opens a receipt now. Transfers used to be the only
                   tappable ones because the receipt could only be built from the
                   transfer RPC; purchases, spends, refunds, rewards and grants
                   sat inert, which read as a list that was half broken. A ledger
                   row already contains everything its receipt needs — see
                   `receiptFromTransaction`. */
                const loading = receiptLoadingId === tx.id;

                return (
                  <motion.div
                    key={tx.id}
                    layout
                    variants={staggerItem}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    transition={tween.fast}
                    onClick={() => onOpenReceipt(tx)}
                    role="button"
                    tabIndex={0}
                    aria-label={`View receipt for ${tx.description}`}
                    aria-busy={loading || undefined}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenReceipt(tx);
                      }
                    }}
                    className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white/[0.05] p-3 transition-colors hover:bg-white/[0.08]"
                  >
                    <span
                      className="grid h-9 w-9 flex-none place-items-center rounded-xl"
                      style={{
                        background: credit
                          ? "color-mix(in srgb, var(--theme-success) 14%, transparent)"
                          : "color-mix(in srgb, var(--theme-accent-pink) 14%, transparent)",
                        color: credit
                          ? "var(--theme-success)"
                          : "var(--theme-accent-pink)",
                      }}
                    >
                      <Icon size={16} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{tx.description}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(tx.created_at).toLocaleString()}
                      </p>
                    </div>

                    <span
                      className={`flex-none font-black tabular-nums ${
                        credit ? "text-emerald-300" : "text-pink-300"
                      }`}
                    >
                      {credit ? "+" : ""}
                      {tx.amount.toLocaleString()}
                    </span>

                    {/* A fixed-width slot so swapping the chevron for the spinner
                        can't shift the amount beside it. The chevron is the whole
                        reason a user knows the row is tappable at all. */}
                    <span className="grid h-4 w-4 flex-none place-items-center">
                      {loading ? (
                        <Loader2
                          size={14}
                          className="animate-spin"
                          style={{ color: "var(--theme-text-muted)" }}
                        />
                      ) : (
                        <ChevronRight
                          size={14}
                          aria-hidden
                          style={{ color: "var(--theme-text-muted)" }}
                        />
                      )}
                    </span>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>

          {showButton && (
            <motion.button
              layout
              type="button"
              onClick={canExpand ? onShowMore : onShowLess}
              disabled={loadingMore}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-2.5 text-[0.8125rem] font-bold transition-colors disabled:opacity-60"
              style={{
                background: "var(--fill-2)",
                border: "1px solid var(--theme-glass-border)",
                color: "var(--theme-text-secondary)",
              }}
            >
              {loadingMore ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Loading…
                </>
              ) : canExpand ? (
                <>
                  Show more
                  <ChevronDown size={15} />
                </>
              ) : (
                <>
                  Show less
                  <ChevronDown size={15} className="rotate-180" />
                </>
              )}
            </motion.button>
          )}
        </>
      )}
    </GlassPanel>
  );
}
