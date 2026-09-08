"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ExternalLink, Flag, SearchX } from "lucide-react";

import { adminFetch, withQuery, type AdminUserList, type AdminUserRow } from "@/lib/admin/client";
import { runAdminAction, useAdminData, useDebounced } from "@/lib/admin/useAdminData";
import BanUserDialog from "@/components/admin/BanUserDialog";
import { useToast } from "@/components/ToastProvider";
import {
  AdminBadge,
  AdminButton,
  AdminEmptyState,
  AdminErrorState,
  AdminPanel,
  AdminRow,
  AdminSearchInput,
  AdminSkeletonRows,
  AdminStatCard,
  AdminTable,
  AdminTableScroll,
  AdminTd,
  AdminTh,
} from "@/components/admin/primitives";

/**
 * Moderation.
 *
 * Two jobs on one screen: what is currently banned, and banning or lifting someone
 * without first having to find their detail page. Search runs against the same
 * server-side endpoint as /admin/users, so it is debounced, paginated and never
 * loads the table into the browser.
 *
 * Every action here goes through the same two routes the detail page uses, so
 * there is exactly one implementation of "ban a user" and exactly one audit entry
 * per action, whichever screen it was issued from.
 */

type BanRow = {
  id: string;
  user_id: string;
  username: string | null;
  reason: string;
  duration: "permanent" | "temporary";
  expires_at: string | null;
  active: boolean;
  created_at: string;
  sessions_revoked: boolean;
  banned_by_username: string | null;
};

export default function AdminModerationPage() {
  const { showToast } = useToast();

  const [scope, setScope] = useState<"active" | "all">("active");
  const { data: bansData, loading: bansLoading, error: bansError, reload: reloadBans } = useAdminData<{ bans: BanRow[] }>(
    withQuery("/api/admin/bans", { scope })
  );

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 350);
  const {
    data: searchResults,
    loading: searchLoading,
    error: searchError,
    reload: reloadSearch,
  } = useAdminData<AdminUserList>(
    debouncedSearch.trim().length >= 2
      ? withQuery("/api/admin/users", { q: debouncedSearch.trim(), status: "all", limit: 10 })
      : "",
    { skip: debouncedSearch.trim().length < 2 }
  );

  const [banTarget, setBanTarget] = useState<{ id: string; username: string } | null>(null);
  const [unbanningId, setUnbanningId] = useState<string | null>(null);

  const unban = useCallback(
    async (userId: string) => {
      setUnbanningId(userId);
      const result = await runAdminAction(() =>
        adminFetch<{ cleared: boolean; sessionsRestored: boolean }>(`/api/admin/bans/${userId}`, {
          method: "DELETE",
        })
      );
      setUnbanningId(null);

      if (!result.ok) {
        showToast(result.error, { variant: "error" });
        return;
      }
      showToast("Ban lifted.", { variant: "success" });
      reloadBans();
    },
    [reloadBans, showToast]
  );

  const bans = bansData?.bans ?? [];
  const activeCount = bans.filter((ban) => ban.active).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-[var(--admin-text)] sm:text-2xl">Moderation</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
          Bans in force, and the accounts they belong to. A ban is enforced by the
          database, not by this page — every whisper, message, post, reaction and
          coin movement is refused for a banned account at the row level.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <AdminStatCard
          label="Bans in force"
          value={bansLoading ? "—" : activeCount.toLocaleString()}
          tone={activeCount > 0 ? "danger" : "default"}
          loading={bansLoading}
        />
        <AdminStatCard
          label="Ban events shown"
          value={bansLoading ? "—" : bans.length.toLocaleString()}
          hint={scope === "active" ? "Active only" : "Including lifted"}
          loading={bansLoading}
        />
        <AdminStatCard
          label="Sessions revoked"
          value={
            bansLoading ? "—" : bans.filter((ban) => ban.sessions_revoked).length.toLocaleString()
          }
          hint="GoTrue token revocation confirmed"
          loading={bansLoading}
        />
      </div>

      {/* ------------------------------------------------------------ */}
      {/* Find a user to action                                        */}
      {/* ------------------------------------------------------------ */}
      <AdminPanel
        title="Find an account"
        subtitle="Search to ban or unban directly. Two characters or more."
      >
        <div className="p-4">
          <div className="max-w-md">
            <AdminSearchInput
              value={search}
              onChange={setSearch}
              placeholder="username, email, phone or id"
              label="Search accounts to moderate"
            />
          </div>

          <div className="mt-4">
            {searchError ? (
              <AdminErrorState message={searchError.message} onRetry={reloadSearch} misconfigured={searchError.misconfigured} />
            ) : debouncedSearch.trim().length < 2 ? (
              <p className="py-6 text-center text-[12.5px] text-[var(--admin-muted)]">
                Start typing to search.
              </p>
            ) : searchLoading && !searchResults ? (
              <AdminSkeletonRows rows={3} columns={4} />
            ) : !searchResults || searchResults.users.length === 0 ? (
              <AdminEmptyState
                title="No accounts match that"
                action={
                  <AdminButton variant="ghost" onClick={() => setSearch("")}>
                    <SearchX size={14} />
                    Clear
                  </AdminButton>
                }
              />
            ) : (
              <AdminTableScroll>
                <AdminTable
                  head={
                    <>
                      <AdminTh>Account</AdminTh>
                      <AdminTh>Registered</AdminTh>
                      <AdminTh>Status</AdminTh>
                      <AdminTh className="text-right">Action</AdminTh>
                    </>
                  }
                >
                  {searchResults.users.map((user, index) => (
                    <SearchResultRow
                      key={user.id}
                      user={user}
                      index={index}
                      unbanning={unbanningId === user.id}
                      onBan={() => setBanTarget({ id: user.id, username: user.username })}
                      onUnban={() => unban(user.id)}
                    />
                  ))}
                </AdminTable>
              </AdminTableScroll>
            )}
          </div>
        </div>
      </AdminPanel>

      {/* ------------------------------------------------------------ */}
      {/* Ban queue                                                    */}
      {/* ------------------------------------------------------------ */}
      <AdminPanel
        title="Bans"
        subtitle={scope === "active" ? "Currently in force" : "Every ban event, newest first"}
        actions={
          <div className="flex items-center gap-1 rounded-xl border border-[var(--admin-line)] p-0.5">
            {(["active", "all"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setScope(option)}
                aria-pressed={scope === option}
                className={`rounded-lg px-3 py-1.5 text-[12px] font-bold transition ${
                  scope === option ? "bg-purple-500/20 text-purple-200" : "text-[var(--admin-muted)] hover:text-[var(--admin-text)]"
                }`}
              >
                {option === "active" ? "Active" : "All"}
              </button>
            ))}
          </div>
        }
      >
        {bansError ? (
          <AdminErrorState message={bansError.message} onRetry={reloadBans} misconfigured={bansError.misconfigured} />
        ) : bansLoading && !bansData ? (
          <AdminSkeletonRows rows={6} columns={5} />
        ) : bans.length === 0 ? (
          <AdminEmptyState
            title={scope === "active" ? "No active bans" : "No bans have been issued"}
            body="When an account is restricted, it appears here with the reason and who issued it."
          />
        ) : (
          <AdminTableScroll>
            <AdminTable
              head={
                <>
                  <AdminTh>Account</AdminTh>
                  <AdminTh>Reason</AdminTh>
                  <AdminTh>Issued</AdminTh>
                  <AdminTh>Duration</AdminTh>
                  <AdminTh>By</AdminTh>
                  <AdminTh>Status</AdminTh>
                  <AdminTh className="text-right">Actions</AdminTh>
                </>
              }
            >
              {bans.map((ban, index) => (
                <AdminRow key={ban.id} index={index}>
                  <AdminTd>
                    <Link
                      href={`/admin/users/${ban.user_id}`}
                      className="inline-flex items-center gap-1 text-[13px] font-bold text-[var(--admin-text)] hover:text-purple-300"
                    >
                      @{ban.username ?? "unknown"}
                      <ExternalLink size={11} />
                    </Link>
                  </AdminTd>
                  <AdminTd>
                    <span className="line-clamp-2 max-w-xs text-[12.5px] text-[var(--admin-muted)]">
                      {ban.reason}
                    </span>
                  </AdminTd>
                  <AdminTd className="whitespace-nowrap text-[12px] text-[var(--admin-muted)]">
                    {new Date(ban.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </AdminTd>
                  <AdminTd className="whitespace-nowrap text-[12px] text-[var(--admin-muted)]">
                    {ban.duration === "permanent"
                      ? "Permanent"
                      : `Until ${ban.expires_at ? new Date(ban.expires_at).toLocaleDateString() : "—"}`}
                  </AdminTd>
                  <AdminTd className="text-[12px] text-[var(--admin-muted)]">
                    {ban.banned_by_username ? `@${ban.banned_by_username}` : "—"}
                  </AdminTd>
                  <AdminTd>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <AdminBadge tone={ban.active ? "danger" : "neutral"}>
                        {ban.active ? "Active" : "Lifted"}
                      </AdminBadge>
                      {ban.active && !ban.sessions_revoked && (
                        <AdminBadge tone="warning" title="Banned in the database; GoTrue session not revoked">
                          DB only
                        </AdminBadge>
                      )}
                    </div>
                  </AdminTd>
                  <AdminTd className="text-right">
                    {ban.active ? (
                      <AdminButton
                        variant="ghost"
                        disabled={unbanningId === ban.user_id}
                        onClick={() => unban(ban.user_id)}
                      >
                        {unbanningId === ban.user_id ? "Lifting…" : "Unban"}
                      </AdminButton>
                    ) : (
                      <Link
                        href={`/admin/users/${ban.user_id}`}
                        className="inline-flex items-center gap-1 text-[12px] font-bold text-purple-300 hover:text-[var(--admin-text)]"
                      >
                        <Flag size={12} />
                        Review
                      </Link>
                    )}
                  </AdminTd>
                </AdminRow>
              ))}
            </AdminTable>
          </AdminTableScroll>
        )}
      </AdminPanel>

      {banTarget && (
      <BanUserDialog
        key={banTarget.id}
        userId={banTarget.id}
        username={banTarget.username}
        onClose={() => setBanTarget(null)}
        onDone={({ sessionsRevoked }) => {
          setBanTarget(null);
          showToast(
            sessionsRevoked
              ? "User banned and their session revoked."
              : "User banned. The database is enforcing it; their GoTrue session could not be revoked.",
            { variant: "success" }
          );
          reloadBans();
        }}
      />
      )}
    </div>
  );
}

function SearchResultRow({
  user,
  index,
  unbanning,
  onBan,
  onUnban,
}: {
  user: AdminUserRow;
  index: number;
  unbanning: boolean;
  onBan: () => void;
  onUnban: () => void;
}) {
  const banned = user.status === "banned";

  return (
    <AdminRow index={index}>
      <AdminTd>
        <p className="text-[13px] font-bold text-[var(--admin-text)]">@{user.username}</p>
        {user.display_name && <p className="text-[11.5px] text-[var(--admin-muted)]">{user.display_name}</p>}
      </AdminTd>
      <AdminTd className="whitespace-nowrap text-[12px] text-[var(--admin-muted)]">
        {new Date(user.created_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </AdminTd>
      <AdminTd>
        <AdminBadge tone={banned ? "danger" : "success"}>{banned ? "Banned" : "Active"}</AdminBadge>
      </AdminTd>
      <AdminTd className="text-right">
        {banned ? (
          <AdminButton variant="ghost" onClick={onUnban} disabled={unbanning}>
            {unbanning ? "Lifting…" : "Unban"}
          </AdminButton>
        ) : (
          <AdminButton variant="danger" onClick={onBan}>
            Ban
          </AdminButton>
        )}
      </AdminTd>
    </AdminRow>
  );
}
