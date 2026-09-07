"use client";

import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Ban, CheckCircle2, Copy, ShieldOff } from "lucide-react";

import type { AdminUserDetail } from "@/lib/admin/client";
import { adminFetch } from "@/lib/admin/client";
import { runAdminAction, useAdminData } from "@/lib/admin/useAdminData";
import BanUserDialog from "@/components/admin/BanUserDialog";
import {
  AdminBadge,
  AdminButton,
  AdminErrorState,
  AdminPanel,
  AdminSkeletonRows,
  AdminTable,
  AdminTableScroll,
  AdminTd,
  AdminTh,
} from "@/components/admin/primitives";
import { useToast } from "@/components/ToastProvider";

/**
 * One account.
 *
 * Opening this page writes an audit row (`user.viewed`) server-side, because this
 * is the only screen in the product where a full email address and phone number
 * are shown to someone other than their owner. A read that is not logged is a read
 * nobody can account for later.
 *
 * What is NOT here: message contents. `admin_user_detail` returns counts —
 * whispers received, messages sent, posts, replies — and never a body. Nothing in
 * the existing schema authorises an admin to read private correspondence, and this
 * panel is not the place to invent that.
 */

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const { showToast } = useToast();

  const { data, loading, error, reload } = useAdminData<AdminUserDetail>(`/api/admin/users/${userId}`);
  const [banOpen, setBanOpen] = useState(false);
  const [unbanning, setUnbanning] = useState(false);

  const activeBan = data?.moderation?.bans?.find((ban) => ban.active) ?? null;
  const isBanned = Boolean(activeBan);

  const unban = useCallback(async () => {
    setUnbanning(true);
    const result = await runAdminAction(() =>
      adminFetch<{ cleared: boolean; sessionsRestored: boolean; restoreError: string | null }>(
        `/api/admin/bans/${userId}`,
        { method: "DELETE" }
      )
    );
    setUnbanning(false);

    if (!result.ok) {
      showToast(result.error, { variant: "error" });
      return;
    }
    showToast("Ban lifted.", { variant: "success" });
    reload();
  }, [userId, reload, showToast]);

  const copy = useCallback(
    async (value: string, label: string) => {
      /* Inline confirmation rather than a toast: copying an identifier is the
         quietest action on this page and does not need a card in the corner. */
      try {
        await navigator.clipboard.writeText(value);
        showToast(`${label} copied`, { variant: "subtle" });
      } catch {
        showToast("Couldn't copy that.", { variant: "error" });
      }
    },
    [showToast]
  );

  if (error) {
    return (
      <AdminPanel>
        <AdminErrorState message={error.message} onRetry={reload} misconfigured={error.misconfigured} />
      </AdminPanel>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--admin-muted)] transition hover:text-white"
        >
          <ArrowLeft size={14} />
          All users
        </Link>

        {data && (
          <div className="flex items-center gap-2">
            {isBanned ? (
              <AdminButton variant="ghost" onClick={unban} disabled={unbanning}>
                <CheckCircle2 size={14} />
                {unbanning ? "Lifting…" : "Unban"}
              </AdminButton>
            ) : (
              <AdminButton variant="danger" onClick={() => setBanOpen(true)}>
                <Ban size={14} />
                Ban user
              </AdminButton>
            )}
          </div>
        )}
      </div>

      {loading && !data ? (
        <>
          <AdminPanel title="Profile">
            <AdminSkeletonRows rows={4} columns={3} />
          </AdminPanel>
          <AdminPanel title="Activity">
            <AdminSkeletonRows rows={4} columns={3} />
          </AdminPanel>
        </>
      ) : data ? (
        <>
          {isBanned && activeBan && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/25 bg-red-500/8 p-4">
              <div className="flex items-start gap-3">
                <ShieldOff size={18} className="mt-0.5 flex-none text-red-300" />
                <div>
                  <p className="text-[13px] font-bold text-red-100">
                    {activeBan.duration === "permanent" ? "Permanently banned" : "Temporarily banned"}
                  </p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-red-100/80">{activeBan.reason}</p>
                  <p className="mt-1 text-[11.5px] text-red-200/60">
                    {activeBan.expires_at
                      ? `Expires ${new Date(activeBan.expires_at).toLocaleString()}`
                      : "No expiry"}{" "}
                    ·{" "}
                    {activeBan.sessions_revoked
                      ? "session revoked in GoTrue"
                      : "database enforcement only — GoTrue session not revoked"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* -------------------------------------------------------- */}
          {/* Profile                                                  */}
          {/* -------------------------------------------------------- */}
          <AdminPanel title="Profile" subtitle="Sensitive fields are shown in full here, and this view is audited.">
            <dl className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Username" value={`@${data.profile.username}`} />
              <Detail label="Display name" value={data.profile.display_name} />
              <Detail
                label="Email"
                value={data.profile.email}
                action={data.profile.email ? () => copy(data.profile.email!, "Email") : undefined}
              />
              <Detail
                label="Phone"
                value={
                  data.profile.phone_number
                    ? `${data.profile.dial_code ?? ""} ${data.profile.phone_number}`.trim()
                    : null
                }
                action={data.profile.phone_number ? () => copy(data.profile.phone_number!, "Phone") : undefined}
              />
              <Detail label="Country" value={data.profile.country} />
              <Detail label="Registered" value={formatDateTime(data.profile.created_at)} />
              <Detail label="Last sign-in" value={formatDateTime(data.profile.last_sign_in_at)} />
              <Detail
                label="Status"
                value={isBanned ? "Banned" : "Active"}
                badge={isBanned ? "danger" : "success"}
              />
              <Detail label="Coin balance" value={data.profile.coin_balance.toLocaleString()} />
              <Detail
                label="Onboarding"
                value={data.profile.profile_completed ? "Completed" : "Incomplete"}
              />
              <Detail
                label="User ID"
                value={data.profile.id}
                mono
                action={() => copy(data.profile.id, "User ID")}
              />
            </dl>
          </AdminPanel>

          {/* -------------------------------------------------------- */}
          {/* Activity                                                 */}
          {/* -------------------------------------------------------- */}
          <AdminPanel
            title="Activity"
            subtitle="Counts over the last 90 days where a window is shown. Message contents are never returned."
          >
            <dl className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Whispers received (90d)" value={data.activity.whispers_received.toLocaleString()} />
              <Detail label="Inbox messages sent (90d)" value={data.activity.direct_messages_sent.toLocaleString()} />
              <Detail label="Images sent (90d)" value={data.activity.images_sent.toLocaleString()} />
              <Detail label="Public posts" value={data.activity.feed_posts.toLocaleString()} />
              <Detail label="Replies" value={data.activity.feed_replies.toLocaleString()} />
              <Detail label="Reactions given" value={data.activity.reactions_given.toLocaleString()} />
            </dl>
          </AdminPanel>

          {/* -------------------------------------------------------- */}
          {/* Moderation                                               */}
          {/* -------------------------------------------------------- */}
          <AdminPanel
            title="Moderation"
            subtitle={`${data.moderation.reports_against} report(s) against this account · ${data.moderation.reports_filed} filed by them`}
          >
            {data.moderation.bans.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-[var(--admin-muted)]">
                No ban history.
              </p>
            ) : (
              <AdminTableScroll>
                <AdminTable
                  head={
                    <>
                      <AdminTh>When</AdminTh>
                      <AdminTh>Reason</AdminTh>
                      <AdminTh>Duration</AdminTh>
                      <AdminTh>By</AdminTh>
                      <AdminTh>Status</AdminTh>
                    </>
                  }
                >
                  {data.moderation.bans.map((ban) => (
                    <tr key={ban.id}>
                      <AdminTd className="whitespace-nowrap text-[var(--admin-muted)]">
                        {formatDateTime(ban.created_at)}
                      </AdminTd>
                      <AdminTd>
                        <span className="line-clamp-2 max-w-md text-[12.5px]">{ban.reason}</span>
                      </AdminTd>
                      <AdminTd className="whitespace-nowrap text-[12.5px] text-[var(--admin-muted)]">
                        {ban.duration === "permanent"
                          ? "Permanent"
                          : `Until ${ban.expires_at ? new Date(ban.expires_at).toLocaleDateString() : "—"}`}
                      </AdminTd>
                      <AdminTd className="text-[12.5px] text-[var(--admin-muted)]">
                        {ban.banned_by ? `@${ban.banned_by}` : "—"}
                      </AdminTd>
                      <AdminTd>
                        <AdminBadge tone={ban.active ? "danger" : "neutral"}>
                          {ban.active ? "Active" : "Lifted"}
                        </AdminBadge>
                      </AdminTd>
                    </tr>
                  ))}
                </AdminTable>
              </AdminTableScroll>
            )}
          </AdminPanel>

          {/* -------------------------------------------------------- */}
          {/* Coins                                                    */}
          {/* -------------------------------------------------------- */}
          <AdminPanel
            title="Coins"
            subtitle={`${data.coins.granted.toLocaleString()} granted · ${data.coins.purchased.toLocaleString()} purchased · ${data.coins.spent.toLocaleString()} spent`}
          >
            {data.coins.transactions.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-[var(--admin-muted)]">
                No coin activity.
              </p>
            ) : (
              <AdminTableScroll>
                <AdminTable
                  head={
                    <>
                      <AdminTh>When</AdminTh>
                      <AdminTh>Type</AdminTh>
                      <AdminTh className="text-right">Amount</AdminTh>
                      <AdminTh>Note</AdminTh>
                      <AdminTh>Granted by</AdminTh>
                    </>
                  }
                >
                  {data.coins.transactions.map((transaction, index) => (
                    <tr key={`${transaction.created_at}-${index}`}>
                      <AdminTd className="whitespace-nowrap text-[var(--admin-muted)]">
                        {formatDateTime(transaction.created_at)}
                      </AdminTd>
                      <AdminTd>
                        <AdminBadge tone={transaction.amount >= 0 ? "success" : "warning"}>
                          {transaction.transaction_type}
                        </AdminBadge>
                      </AdminTd>
                      <AdminTd className="admin-numeric text-right font-bold">
                        {transaction.amount > 0 ? "+" : ""}
                        {transaction.amount.toLocaleString()}
                      </AdminTd>
                      <AdminTd className="max-w-xs truncate text-[12.5px] text-[var(--admin-muted)]">
                        {transaction.description}
                      </AdminTd>
                      <AdminTd className="text-[12px] text-[var(--admin-muted)]">
                        {transaction.granted_by ? shortId(transaction.granted_by) : "—"}
                      </AdminTd>
                    </tr>
                  ))}
                </AdminTable>
              </AdminTableScroll>
            )}
          </AdminPanel>
        </>
      ) : null}

      {banOpen && (
      <BanUserDialog
        key={userId}
        userId={userId}
        username={data?.profile.username ?? "this account"}
        onClose={() => setBanOpen(false)}
        onDone={({ sessionsRevoked }) => {
          setBanOpen(false);
          showToast(
            sessionsRevoked
              ? "User banned and their session revoked."
              : "User banned. Their session could not be revoked, but the database is enforcing it.",
            { variant: "success" }
          );
          reload();
        }}
      />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Detail({
  label,
  value,
  mono = false,
  badge,
  action,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  badge?: "danger" | "success";
  action?: () => void;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">{label}</dt>
      <dd className="mt-1 flex min-w-0 items-center gap-2">
        {badge ? (
          <AdminBadge tone={badge}>{value ?? "—"}</AdminBadge>
        ) : (
          <span
            className={`min-w-0 truncate text-[13px] font-semibold text-white ${mono ? "font-mono text-[12px]" : ""}`}
            title={value ?? undefined}
          >
            {value || "—"}
          </span>
        )}
        {action && (
          <button
            type="button"
            onClick={action}
            aria-label={`Copy ${label}`}
            className="flex-none rounded-lg p-1 text-[var(--admin-muted)] transition hover:bg-white/6 hover:text-white"
          >
            <Copy size={13} />
          </button>
        )}
      </dd>
    </div>
  );
}

function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  })} — ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}
