"use client";

import { useState } from "react";
import { Database, KeyRound, ShieldCheck } from "lucide-react";

import { withQuery, type AdminAuditEntry } from "@/lib/admin/client";
import { useAdminData } from "@/lib/admin/useAdminData";
import {
  AdminButton,
  AdminEmptyState,
  AdminErrorState,
  AdminPanel,
  AdminRow,
  AdminSkeletonRows,
  AdminTable,
  AdminTableScroll,
  AdminTd,
  AdminTh,
} from "@/components/admin/primitives";

/**
 * System: the audit log, and what the panel depends on.
 *
 * The log is append-only and has no delete. An audit trail an admin can edit is not
 * an audit trail; if retention is ever wanted it belongs in a scheduled job with its
 * own credentials, not behind a button here.
 *
 * The configuration panel exists because the failure mode this project has already
 * hit is a missing environment variable or an unapplied migration reporting itself
 * as "incorrect PIN" — which sends someone retyping a credential that was never the
 * problem. Naming the dependency and where it is checked turns that into a
 * five-second diagnosis.
 */

const SCOPES = [
  { key: "all", label: "Everything" },
  { key: "user", label: "Users & bans" },
  { key: "coin", label: "Coins" },
  { key: "announcement", label: "Announcements" },
  { key: "report", label: "Reports" },
] as const;

const ACTION_LABELS: Record<string, string> = {
  "user.viewed": "Viewed account",
  "user.banned": "Banned account",
  "user.unbanned": "Lifted a ban",
  "coin.granted": "Granted coins",
  "announcement.created": "Created announcement",
  "announcement.published": "Published announcement",
  "announcement.updated": "Edited announcement",
  "announcement.deleted": "Deleted announcement",
  "report.pending": "Reopened report",
  "report.reviewing": "Opened report for review",
  "report.resolved": "Resolved report",
  "report.dismissed": "Dismissed report",
};

export default function AdminSystemPage() {
  const [scope, setScope] = useState<string>("all");
  const [cursor, setCursor] = useState<string | null>(null);

  const { data, loading, error, reload } = useAdminData<{
    entries: AdminAuditEntry[];
    nextCursor: { before: string } | null;
  }>(withQuery("/api/admin/audit-logs", { scope, limit: 50, before: cursor }));

  const entries = data?.entries ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-[var(--admin-text)] sm:text-2xl">System</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
          Every privileged action taken through this panel, including reads of
          accounts&apos; private details. Append-only — there is no delete.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminPanel title="What the panel depends on">
          <ul className="space-y-3.5 p-4 text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
            <li className="flex items-start gap-2.5">
              <KeyRound size={14} className="mt-0.5 flex-none" />
              <span>
                <code className="rounded bg-[var(--admin-hover)] px-1 text-[var(--admin-text)]">ADMIN_GRANT_PIN</code> —
                checked in <code className="rounded bg-[var(--admin-hover)] px-1">lib/admin/auth.ts</code>{" "}
                on every request, in constant time. Missing it makes every route
                answer with a configuration error rather than “incorrect PIN”.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <Database size={14} className="mt-0.5 flex-none" />
              <span>
                <code className="rounded bg-[var(--admin-hover)] px-1 text-[var(--admin-text)]">SUPABASE_SERVICE_ROLE_KEY</code>{" "}
                — server only. Every admin read and write goes through it, and it
                never reaches a browser.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldCheck size={14} className="mt-0.5 flex-none" />
              <span>
                Migrations{" "}
                <code className="rounded bg-[var(--admin-hover)] px-1">202609080001</code> and{" "}
                <code className="rounded bg-[var(--admin-hover)] px-1">202609080002</code>. Without
                them the panel reports the missing object by name instead of failing
                silently.
              </span>
            </li>
          </ul>
        </AdminPanel>

        <AdminPanel title="How authorization works here">
          <div className="space-y-2.5 p-4 text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
            <p>
              Nothing in this panel is protected by hiding a button or guarding a
              route. Every request carries the caller&apos;s access token and the admin
              PIN, and both are verified server-side before any data is touched.
            </p>
            <p>
              Every admin database function is EXECUTE-revoked from{" "}
              <code className="rounded bg-[var(--admin-hover)] px-1">anon</code> and{" "}
              <code className="rounded bg-[var(--admin-hover)] px-1">authenticated</code>, and the
              tables behind them have row-level security enabled with no client
              policy. A browser that skipped this UI entirely would still have no
              path to another user&apos;s email or phone number.
            </p>
            <p>
              Bans are enforced in the database by before-insert triggers, not by this
              interface — see <code className="rounded bg-[var(--admin-hover)] px-1">/admin/moderation</code>.
            </p>
          </div>
        </AdminPanel>
      </div>

      <AdminPanel
        title="Audit log"
        subtitle="Newest first"
        actions={
          <div className="flex items-center gap-2">
            <AdminButton
              variant="ghost"
              disabled={loading || !data?.nextCursor}
              onClick={() => data?.nextCursor && setCursor(data.nextCursor.before)}
            >
              Older
            </AdminButton>
            {cursor && (
              <AdminButton variant="subtle" onClick={() => setCursor(null)}>
                Newest
              </AdminButton>
            )}
          </div>
        }
      >
        <div className="-mx-1 flex gap-1 overflow-x-auto px-4 pb-3 pt-4 sm:px-5">
          {SCOPES.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                setScope(option.key);
                setCursor(null);
              }}
              aria-pressed={scope === option.key}
              className={`flex-none whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] font-bold transition ${
                scope === option.key
                  ? "bg-purple-500/20 text-purple-200"
                  : "text-[var(--admin-muted)] hover:bg-[var(--admin-hover)] hover:text-[var(--admin-text)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {error ? (
          <AdminErrorState message={error.message} onRetry={reload} misconfigured={error.misconfigured} />
        ) : loading && !data ? (
          <AdminSkeletonRows rows={8} columns={5} />
        ) : entries.length === 0 ? (
          <AdminEmptyState title="Nothing logged yet" body="Actions taken in this panel appear here." />
        ) : (
          <AdminTableScroll>
            <AdminTable
              head={
                <>
                  <AdminTh>When</AdminTh>
                  <AdminTh>Action</AdminTh>
                  <AdminTh>Admin</AdminTh>
                  <AdminTh>Target</AdminTh>
                  <AdminTh>Detail</AdminTh>
                </>
              }
            >
              {entries.map((entry, index) => (
                <AdminRow key={entry.id} index={index}>
                  <AdminTd className="whitespace-nowrap text-[12px] text-[var(--admin-muted)]">
                    {new Date(entry.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </AdminTd>
                  <AdminTd>
                    <span className="text-[12.5px] font-semibold text-[var(--admin-text)]">
                      {ACTION_LABELS[entry.action] ?? entry.action}
                    </span>
                  </AdminTd>
                  <AdminTd className="text-[12px] text-[var(--admin-muted)]">
                    {entry.admin_username ? `@${entry.admin_username}` : "—"}
                  </AdminTd>
                  <AdminTd className="text-[12px] text-[var(--admin-muted)]">
                    {entry.target_username ? `@${entry.target_username}` : "—"}
                  </AdminTd>
                  <AdminTd>
                    <span className="block max-w-md truncate font-mono text-[11px] text-[var(--admin-muted)]" title={JSON.stringify(entry.metadata)}>
                      {summarise(entry.metadata)}
                    </span>
                  </AdminTd>
                </AdminRow>
              ))}
            </AdminTable>
          </AdminTableScroll>
        )}
      </AdminPanel>
    </div>
  );
}

/**
 * Metadata as one line.
 *
 * Deliberately terse: the log is meant to be scanned, and the full JSON is on the
 * row's title attribute for the moment someone needs it. Nothing in here is a
 * secret by construction — `admin_log` stores ids, amounts, statuses and reasons,
 * never emails, phone numbers or message bodies.
 */
function summarise(metadata: Record<string, unknown>): string {
  const parts = Object.entries(metadata ?? {})
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  return parts.length ? parts.join(" · ") : "—";
}
