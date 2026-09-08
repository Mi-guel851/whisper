"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, SearchX } from "lucide-react";

import { withQuery, type AdminUserList, type AdminUserRow } from "@/lib/admin/client";
import { useAdminData, useDebounced } from "@/lib/admin/useAdminData";
import {
  AdminBadge,
  AdminButton,
  AdminEmptyState,
  AdminErrorState,
  AdminPanel,
  AdminRow,
  AdminSearchInput,
  AdminSkeletonRows,
  AdminTable,
  AdminTableScroll,
  AdminTd,
  AdminTh,
} from "@/components/admin/primitives";

/**
 * Users.
 *
 * Server-side search, filtering and keyset pagination — the browser never holds
 * more than one page, and never holds an unmasked email or phone number (both
 * arrive masked from app/api/admin/users, which is where the redaction happens;
 * masking in the component would be a rendering choice, not a privacy one).
 *
 * The full values are on the detail page, one account at a time, and that call is
 * audited.
 */

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "banned", label: "Banned" },
  { key: "new", label: "New (7d)" },
  { key: "high_coins", label: "500+ coins" },
  { key: "recently_active", label: "Active 24h" },
] as const;

const PAGE_SIZE = 25;

export default function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");

  /* The pagination stack. The last entry is the page being looked at, so "Back"
     is `slice(0, -1)` and "Next" is a push — one piece of state instead of a
     cursor plus a history array that have to be kept in agreement, and no
     side effects inside a state updater. */
  const [stack, setStack] = useState<Array<{ afterTs: string; afterId: string } | null>>([null]);
  const cursor = stack[stack.length - 1] ?? null;

  const debouncedSearch = useDebounced(search, 350);

  /* A new search or filter invalidates the page the cursor points into, so both
     are reset in the handlers that change them rather than in an effect watching
     for the change — the reset belongs to the input, not to the render after it. */
  const changeSearch = useCallback((value: string) => {
    setSearch(value);
    setStack([null]);
  }, []);

  const changeStatus = useCallback((value: string) => {
    setStatus(value);
    setStack([null]);
  }, []);

  /* Memoized so an unchanged query is referentially stable and the fetch effect
     does not re-run on every keystroke of an unrelated field. */
  const path = useMemo(
    () =>
      withQuery("/api/admin/users", {
        q: debouncedSearch,
        status,
        limit: PAGE_SIZE,
        afterTs: cursor?.afterTs,
        afterId: cursor?.afterId,
      }),
    [debouncedSearch, status, cursor]
  );

  const { data, loading, error, reload } = useAdminData<AdminUserList>(path);

  const goNext = () => {
    const next = data?.nextCursor;
    if (!next) return;
    setStack((previous) => [...previous, next]);
  };

  /* Plain functions rather than useCallback: the React Compiler memoizes these,
     and wrapping them by hand only adds a dependency array to keep honest. */
  const goBack = () => {
    setStack((previous) => (previous.length > 1 ? previous.slice(0, -1) : previous));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-[var(--admin-text)] sm:text-2xl">Users</h1>
          <p className="mt-1 text-[12.5px] text-[var(--admin-muted)]">
            Search by username, email, phone or user id. Emails and phone numbers are
            masked here; the detail page shows them in full and logs the view.
          </p>
        </div>
        {data && (
          <p className="admin-numeric text-[12.5px] text-[var(--admin-muted)]">
            {Math.min(data.total, 100_000).toLocaleString()}
            {data.total >= 100_000 ? "+" : ""} match{data.total === 1 ? "" : "es"}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="w-full sm:max-w-sm">
          <AdminSearchInput
            value={search}
            onChange={changeSearch}
            placeholder="username, email, phone or id"
            label="Search users"
          />
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => changeStatus(filter.key)}
              aria-pressed={status === filter.key}
              className={`flex-none whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12px] font-bold transition ${
                status === filter.key
                  ? "bg-purple-500/20 text-purple-200"
                  : "border border-[var(--admin-line)] text-[var(--admin-muted)] hover:bg-[var(--admin-hover)] hover:text-[var(--admin-text)]"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <AdminPanel
        actions={
          <div className="flex items-center gap-2">
            <AdminButton variant="ghost" onClick={goBack} disabled={stack.length <= 1 || loading}>
              Back
            </AdminButton>
            <AdminButton variant="ghost" onClick={goNext} disabled={!data?.nextCursor || loading}>
              Next
            </AdminButton>
          </div>
        }
      >
        {error ? (
          <AdminErrorState message={error.message} onRetry={reload} misconfigured={error.misconfigured} />
        ) : loading && !data ? (
          <AdminSkeletonRows rows={8} columns={6} />
        ) : !data || data.users.length === 0 ? (
          <AdminEmptyState
            title={debouncedSearch ? "No accounts match that" : "No accounts yet"}
            body={
              debouncedSearch
                ? "Try a shorter fragment, or clear the filter chips above."
                : "Registered accounts will appear here."
            }
            action={
              debouncedSearch ? (
                <AdminButton variant="ghost" onClick={() => changeSearch("")}>
                  <SearchX size={14} />
                  Clear search
                </AdminButton>
              ) : undefined
            }
          />
        ) : (
          <AdminTableScroll>
            <AdminTable
              head={
                <>
                  <AdminTh>Account</AdminTh>
                  <AdminTh>Email</AdminTh>
                  <AdminTh>Phone</AdminTh>
                  <AdminTh>Registered</AdminTh>
                  <AdminTh className="text-right">Coins</AdminTh>
                  <AdminTh>Status</AdminTh>
                  <AdminTh>Last seen</AdminTh>
                  <AdminTh className="text-right">Actions</AdminTh>
                </>
              }
            >
              {data.users.map((user, index) => (
                <UserRow key={user.id} user={user} index={index} />
              ))}
            </AdminTable>
          </AdminTableScroll>
        )}
      </AdminPanel>

      {data && data.users.length > 0 && (
        <p className="text-center text-[11.5px] text-[var(--admin-muted)]">
          Showing {data.users.length} of up to {Math.min(data.total, 100_000).toLocaleString()}
          {data.total >= 100_000 ? "+" : ""}
        </p>
      )}
    </div>
  );
}

function UserRow({ user, index }: { user: AdminUserRow; index: number }) {
  return (
    <AdminRow index={index}>
      <AdminTd>
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 flex-none place-items-center rounded-full bg-purple-500/15 text-[12px] font-black text-purple-200">
            {(user.display_name || user.username || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold text-[var(--admin-text)]">@{user.username}</p>
            {user.display_name && (
              <p className="truncate text-[11.5px] text-[var(--admin-muted)]">{user.display_name}</p>
            )}
          </div>
        </div>
      </AdminTd>

      <AdminTd>
        <span className="text-[12.5px] text-[var(--admin-muted)]" title="Masked — open the account for the full address">
          {user.email_masked ?? "—"}
        </span>
      </AdminTd>

      <AdminTd>
        <span className="admin-numeric text-[12.5px] text-[var(--admin-muted)]">
          {user.phone_masked ?? "—"}
        </span>
      </AdminTd>

      <AdminTd>
        <span className="whitespace-nowrap text-[12.5px] text-[var(--admin-muted)]">
          {formatRegistered(user.created_at)}
        </span>
      </AdminTd>

      <AdminTd className="text-right">
        <span className="admin-numeric text-[13px] font-bold text-[var(--admin-text)]">
          {user.coin_balance.toLocaleString()}
        </span>
      </AdminTd>

      <AdminTd>
        <AdminBadge tone={user.status === "banned" ? "danger" : "success"}>
          {user.status === "banned" ? "Banned" : "Active"}
        </AdminBadge>
      </AdminTd>

      <AdminTd>
        <span className="whitespace-nowrap text-[12px] text-[var(--admin-muted)]">
          {user.last_sign_in ? formatRelative(user.last_sign_in) : "Never"}
        </span>
      </AdminTd>

      <AdminTd className="text-right">
        <Link
          href={`/admin/users/${user.id}`}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-bold text-purple-300 transition hover:bg-[var(--admin-hover)]"
        >
          View
          <ExternalLink size={12} />
        </Link>
      </AdminTd>
    </AdminRow>
  );
}

/* -------------------------------------------------------------------------- */

/** "September 7, 2026 — 10:42 AM", which is what the brief asked the row to read. */
function formatRegistered(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  })} — ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
