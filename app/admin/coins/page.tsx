"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Coins as CoinsIcon, Gift, Loader2, SearchX } from "lucide-react";

import { adminFetch, withQuery, type AdminLedgerRow, type AdminUserList, type AdminUserRow } from "@/lib/admin/client";
import { runAdminAction, useAdminData, useDebounced } from "@/lib/admin/useAdminData";
import { useToast } from "@/components/ToastProvider";
import {
  AdminBadge,
  AdminButton,
  AdminEmptyState,
  AdminErrorState,
  AdminField,
  AdminPanel,
  AdminRow,
  AdminSearchInput,
  AdminSkeletonRows,
  AdminStatCard,
  AdminTable,
  AdminTableScroll,
  AdminTd,
  AdminTh,
  adminInputClass,
} from "@/components/admin/primitives";

/**
 * Coins: the original Grant Coins screen, unchanged in behaviour and moved here.
 *
 * app/admin/grant-coins still resolves — it redirects to this page — so nothing
 * that linked to it breaks.
 *
 * WHAT DID NOT CHANGE
 *
 * The grant still posts to /api/admin/grant-coins with the PIN in the request. It
 * has to: unlocking this section is a React boolean, and a boolean cannot
 * authorize anything. The route re-verifies the PIN on every request and calls
 * `admin_grant_coins`, which 202608190004 made callable only with the service role
 * key. There is no client-side path to a balance change, and adding the search and
 * ledger views below did not create one — they are reads.
 *
 * WHAT WAS ADDED
 *
 * A balance lookup before the grant, so an admin can see what they are about to
 * change, and the ledger, so "who granted what, when, and why" is answerable
 * without leaving the section. The grant is now audited too.
 */

const PRESETS = [50, 100, 250, 500, 1000];

export default function AdminCoinsPage() {
  const { showToast } = useToast();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 350);
  const {
    data: results,
    loading: searching,
    error: searchError,
    reload: reloadSearch,
  } = useAdminData<AdminUserList>(
    debouncedSearch.trim().length >= 2
      ? withQuery("/api/admin/users", { q: debouncedSearch.trim(), status: "all", limit: 8 })
      : "",
    { skip: debouncedSearch.trim().length < 2 }
  );

  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("Premium Grant");
  const [busy, setBusy] = useState(false);

  const {
    data: ledger,
    loading: ledgerLoading,
    error: ledgerError,
    reload: reloadLedger,
  } = useAdminData<{ transactions: AdminLedgerRow[]; nextCursor: { before: string } | null }>(
    withQuery("/api/admin/coins/history", { limit: 50 })
  );

  const grant = useCallback(async () => {
    if (!selected) return;
    const value = Number.parseInt(amount, 10);
    if (!Number.isFinite(value) || value <= 0) {
      showToast("Enter a coin amount greater than zero.", { variant: "error" });
      return;
    }

    setBusy(true);
    const result = await runAdminAction(() =>
      adminFetch<{ balance: number }>("/api/admin/grant-coins", {
        method: "POST",
        body: {
          username: selected.username,
          amount: value,
          note: note.trim() || "Premium Grant",
        },
      })
    );
    setBusy(false);

    if (!result.ok) {
      showToast(result.error, { variant: "error" });
      return;
    }

    showToast(`Granted ${value.toLocaleString()} coins to @${selected.username}. New balance: ${result.value.balance.toLocaleString()}.`, {
      variant: "success",
    });
    setSelected(null);
    setAmount("");
    setSearch("");
    reloadLedger();
  }, [selected, amount, note, showToast, reloadLedger]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-[var(--admin-text)] sm:text-2xl">Coins</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
          Grant coins and read the ledger. Every grant is verified against the admin
          PIN on the server and recorded in the audit log.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* ---------------------------------------------------------- */}
        {/* Grant                                                      */}
        {/* ---------------------------------------------------------- */}
        <AdminPanel title="Grant coins" subtitle="Search first — the balance is shown before anything is sent.">
          <div className="space-y-4 p-4">
            <AdminField label="Find the account">
              <AdminSearchInput
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setSelected(null);
                }}
                placeholder="username, email or id"
                label="Search for an account to grant coins to"
              />
            </AdminField>

            {searchError ? (
              <AdminErrorState message={searchError.message} onRetry={reloadSearch} misconfigured={searchError.misconfigured} />
            ) : searching && !results ? (
              <AdminSkeletonRows rows={3} columns={3} />
            ) : results && results.users.length > 0 && !selected ? (
              <ul className="divide-y divide-white/5 overflow-hidden rounded-xl border border-[var(--admin-line)]">
                {results.users.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(user)}
                      className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition hover:bg-[var(--admin-hover)]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-bold text-[var(--admin-text)]">
                          @{user.username}
                        </span>
                        <span className="block truncate text-[11.5px] text-[var(--admin-muted)]">
                          {user.email_masked ?? "no email"}
                        </span>
                      </span>
                      <span className="admin-numeric flex-none text-[12.5px] font-bold text-[var(--admin-text)]">
                        {user.coin_balance.toLocaleString()}
                        <span className="ml-1 text-[11px] font-semibold text-[var(--admin-muted)]">coins</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : debouncedSearch.trim().length >= 2 && !selected ? (
              <AdminEmptyState
                title="No account matches that"
                action={
                  <AdminButton variant="ghost" onClick={() => setSearch("")}>
                    <SearchX size={14} />
                    Clear
                  </AdminButton>
                }
              />
            ) : null}

            {selected ? (
              <div className="space-y-4 rounded-xl border border-purple-500/25 bg-purple-500/8 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold text-[var(--admin-text)]">@{selected.username}</p>
                    <p className="truncate text-[11.5px] text-[var(--admin-muted)]">
                      {selected.email_masked ?? "no email"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="flex-none text-[11.5px] font-semibold text-[var(--admin-muted)] hover:text-[var(--admin-text)]"
                  >
                    Change
                  </button>
                </div>

                <div className="flex items-center gap-2 rounded-lg bg-[var(--admin-input)] px-3 py-2">
                  <CoinsIcon size={15} className="text-purple-300" />
                  <span className="text-[12.5px] text-[var(--admin-muted)]">Current balance</span>
                  <span className="admin-numeric ml-auto text-[13px] font-bold text-[var(--admin-text)]">
                    {selected.coin_balance.toLocaleString()}
                  </span>
                </div>

                <AdminField label="Amount">
                  <input
                    type="number"
                    min={1}
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="500"
                    className={adminInputClass}
                  />
                </AdminField>

                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAmount(String(preset))}
                      className="admin-numeric rounded-full border border-[var(--admin-line)] px-3 py-1.5 text-[12px] font-bold text-[var(--admin-muted)] transition hover:border-purple-400/40 hover:text-[var(--admin-text)]"
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <AdminField label="Note" hint="Shown in their wallet history.">
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Premium Grant"
                    maxLength={200}
                    className={adminInputClass}
                  />
                </AdminField>

                {amount && Number.parseInt(amount, 10) > 0 && (
                  <p className="admin-numeric text-[12px] text-[var(--admin-muted)]">
                    New balance:{" "}
                    <span className="font-bold text-[var(--admin-text)]">
                      {(selected.coin_balance + Number.parseInt(amount, 10)).toLocaleString()}
                    </span>
                  </p>
                )}

                <AdminButton
                  variant="primary"
                  className="w-full"
                  disabled={busy || !amount || Number.parseInt(amount, 10) <= 0}
                  onClick={grant}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Gift size={14} />}
                  {busy ? "Granting…" : "Grant coins"}
                </AdminButton>
              </div>
            ) : (
              <p className="rounded-xl border border-[var(--admin-line)] p-4 text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
                A grant is capped at 1,000,000 coins per request and is written to the
                ledger with your account recorded as the granter.
              </p>
            )}
          </div>
        </AdminPanel>

        {/* ---------------------------------------------------------- */}
        {/* Ledger                                                     */}
        {/* ---------------------------------------------------------- */}
        <AdminPanel
          title="Recent ledger"
          subtitle="Grants, purchases, spends and refunds — newest first"
          actions={
            <Link href="/admin/system">
              <AdminButton variant="subtle">Audit log</AdminButton>
            </Link>
          }
        >
          {ledgerError ? (
            <AdminErrorState message={ledgerError.message} onRetry={reloadLedger} misconfigured={ledgerError.misconfigured} />
          ) : ledgerLoading && !ledger ? (
            <AdminSkeletonRows rows={8} columns={5} />
          ) : !ledger || ledger.transactions.length === 0 ? (
            <AdminEmptyState title="No coin activity yet" />
          ) : (
            <AdminTableScroll>
              <AdminTable
                head={
                  <>
                    <AdminTh>When</AdminTh>
                    <AdminTh>Account</AdminTh>
                    <AdminTh>Type</AdminTh>
                    <AdminTh className="text-right">Amount</AdminTh>
                    <AdminTh>Granted by</AdminTh>
                  </>
                }
              >
                {ledger.transactions.map((row, index) => (
                  <AdminRow key={row.id} index={index}>
                    <AdminTd className="whitespace-nowrap text-[12px] text-[var(--admin-muted)]">
                      {new Date(row.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </AdminTd>
                    <AdminTd>
                      <span className="text-[12.5px] font-semibold text-[var(--admin-text)]">
                        {row.username ? `@${row.username}` : "—"}
                      </span>
                      <span className="block max-w-[10rem] truncate text-[11px] text-[var(--admin-muted)]">
                        {row.description}
                      </span>
                    </AdminTd>
                    <AdminTd>
                      <AdminBadge
                        tone={
                          row.transaction_type === "grant"
                            ? "accent"
                            : row.transaction_type === "purchase"
                              ? "success"
                              : row.transaction_type === "refund"
                                ? "warning"
                                : "neutral"
                        }
                      >
                        {row.transaction_type}
                      </AdminBadge>
                    </AdminTd>
                    <AdminTd className="admin-numeric text-right font-bold">
                      {row.amount > 0 ? "+" : ""}
                      {row.amount.toLocaleString()}
                    </AdminTd>
                    <AdminTd className="text-[12px] text-[var(--admin-muted)]">
                      {row.granted_by_name ? `@${row.granted_by_name}` : "—"}
                    </AdminTd>
                  </AdminRow>
                ))}
              </AdminTable>
            </AdminTableScroll>
          )}
        </AdminPanel>
      </div>

      <AdminPanel title="Ledger integrity">
        <div className="space-y-2.5 p-4 text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
          <p>
            Balances are never computed by adding up the ledger in the browser, and no
            coin movement in this app is a read-modify-write. Spending is a single
            guarded <code className="rounded bg-[var(--admin-hover)] px-1">update … where balance &gt;= cost</code>{" "}
            inside a database function (<code className="rounded bg-[var(--admin-hover)] px-1">debit_whisper_coins</code>,
            202609070001 §S7b), so two concurrent spends cannot both succeed against the
            same balance.
          </p>
          <p>
            The ledger is append-only and is never edited by this panel. Refunds are
            their own row, so a reversal is visible as a reversal rather than as a
            balance that quietly changed.
          </p>
        </div>
      </AdminPanel>
    </div>
  );
}
