"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Ban, CheckCircle2, ExternalLink, Eye, XCircle } from "lucide-react";

import { adminFetch, withQuery, type AdminReportsPage } from "@/lib/admin/client";
import { runAdminAction, useAdminData } from "@/lib/admin/useAdminData";
import BanUserDialog from "@/components/admin/BanUserDialog";
import { useToast } from "@/components/ToastProvider";
import {
  AdminBadge,
  AdminButton,
  AdminEmptyState,
  AdminErrorState,
  AdminPanel,
  AdminRow,
  AdminSkeletonRows,
  AdminStatCard,
  AdminTable,
  AdminTableScroll,
  AdminTd,
  AdminTh,
} from "@/components/admin/primitives";

/**
 * Reports.
 *
 * Reports already existed in this codebase — `public_feed_reports`, filed by
 * components/feed/FeedReportSheet.tsx. What was missing was the other half: the
 * table had no status column, so a report could be filed and then never moved, and
 * nothing read them. 202609080001 added the verdict columns without changing what a
 * report means, and this is the reader.
 *
 * `self_harm` reports sort to the top regardless of age. That is a deliberate
 * ordering rule in `admin_reports_page`, not a client-side sort, because it has to
 * hold for every admin looking at the queue and not only for whoever remembers.
 *
 * What is shown per report: the reason, the reporter's details, an excerpt of the
 * reported post, and the author. The excerpt is there because a moderator cannot act
 * on a report without seeing what was reported — and the post is public by
 * construction. Nothing private is included: no message bodies, no images, no
 * reporter identity beyond a username.
 */

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "reviewing", label: "Reviewing" },
  { key: "resolved", label: "Resolved" },
  { key: "dismissed", label: "Dismissed" },
  { key: "all", label: "All" },
] as const;

const REASON_LABELS: Record<string, string> = {
  spam: "Spam or scam",
  harassment: "Harassment or hate",
  sexual: "Sexual content",
  violence: "Violence or threats",
  self_harm: "Self-harm",
  other: "Something else",
};

export default function AdminReportsPage() {
  const { showToast } = useToast();
  const [status, setStatus] = useState<string>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banTarget, setBanTarget] = useState<{ id: string; username: string } | null>(null);

  const { data, loading, error, reload } = useAdminData<AdminReportsPage>(
    withQuery("/api/admin/reports", { status, limit: 50 })
  );

  const setStatusFor = useCallback(
    async (reportId: string, next: string) => {
      setBusyId(reportId);
      const result = await runAdminAction(() =>
        adminFetch<{ ok: boolean }>(`/api/admin/reports/${reportId}`, {
          method: "PATCH",
          body: { status: next },
        })
      );
      setBusyId(null);

      if (!result.ok) {
        showToast(result.error, { variant: "error" });
        return;
      }
      reload();
    },
    [reload, showToast]
  );

  const counts = data?.counts;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-white sm:text-2xl">Reports</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
          Public feed reports filed by users. Self-harm reports are sorted first, at
          the database level, regardless of age.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard label="Pending" value={counts?.pending ?? "—"} tone={(counts?.pending ?? 0) > 0 ? "danger" : "default"} loading={loading} />
        <AdminStatCard label="Reviewing" value={counts?.reviewing ?? "—"} tone="warning" loading={loading} />
        <AdminStatCard label="Resolved" value={counts?.resolved ?? "—"} tone="success" loading={loading} />
        <AdminStatCard label="Dismissed" value={counts?.dismissed ?? "—"} loading={loading} />
      </div>

      <AdminPanel
        actions={
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatus(tab.key)}
                aria-pressed={status === tab.key}
                className={`flex-none whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] font-bold transition ${
                  status === tab.key
                    ? "bg-purple-500/20 text-purple-200"
                    : "text-[var(--admin-muted)] hover:bg-white/5 hover:text-white"
                }`}
              >
                {tab.label}
                {tab.key !== "all" && counts && (
                  <span className="admin-numeric ml-1.5 opacity-70">
                    {counts[tab.key as keyof typeof counts]}
                  </span>
                )}
              </button>
            ))}
          </div>
        }
      >
        {error ? (
          <AdminErrorState message={error.message} onRetry={reload} misconfigured={error.misconfigured} />
        ) : loading && !data ? (
          <AdminSkeletonRows rows={6} columns={6} />
        ) : !data || data.reports.length === 0 ? (
          <AdminEmptyState
            title={status === "pending" ? "Nothing waiting" : `No ${status} reports`}
            body="Reports filed from the public feed appear here with the reason, the reporter and an excerpt of the post."
          />
        ) : (
          <AdminTableScroll>
            <AdminTable
              head={
                <>
                  <AdminTh>Reported</AdminTh>
                  <AdminTh>Reason</AdminTh>
                  <AdminTh>Reporter</AdminTh>
                  <AdminTh>Filed</AdminTh>
                  <AdminTh>Status</AdminTh>
                  <AdminTh className="text-right">Actions</AdminTh>
                </>
              }
            >
              {data.reports.map((report, index) => {
                const isSelfHarm = report.reason === "self_harm";
                const busy = busyId === report.id;

                return (
                  <AdminRow key={report.id} index={index}>
                    <AdminTd>
                      <div className="min-w-0 max-w-xs">
                        {report.author_username ? (
                          <Link
                            href={`/admin/users/${report.author_id}`}
                            className="inline-flex items-center gap-1 text-[13px] font-bold text-white hover:text-purple-300"
                          >
                            @{report.author_username}
                            <ExternalLink size={11} />
                          </Link>
                        ) : (
                          <span className="text-[13px] text-[var(--admin-muted)]">deleted account</span>
                        )}
                        {report.post_excerpt && (
                          <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-[var(--admin-muted)]">
                            {report.post_excerpt}
                          </p>
                        )}
                        {report.details && (
                          <p className="mt-1.5 line-clamp-2 rounded-lg bg-white/5 px-2 py-1 text-[11.5px] italic text-[var(--admin-muted)]">
                            “{report.details}”
                          </p>
                        )}
                        {report.author_banned && (
                          <AdminBadge tone="danger">
                            <span className="mt-2 inline-flex">author banned</span>
                          </AdminBadge>
                        )}
                      </div>
                    </AdminTd>

                    <AdminTd>
                      <AdminBadge tone={isSelfHarm ? "danger" : "warning"}>
                        {REASON_LABELS[report.reason] ?? report.reason}
                      </AdminBadge>
                      {isSelfHarm && (
                        <p className="mt-1.5 max-w-[12rem] text-[11px] leading-relaxed text-red-200/70">
                          Reviewed first. If someone is in danger, local emergency
                          services are the right call.
                        </p>
                      )}
                    </AdminTd>

                    <AdminTd className="text-[12.5px] text-[var(--admin-muted)]">
                      {report.reporter_username ? `@${report.reporter_username}` : "—"}
                    </AdminTd>

                    <AdminTd className="whitespace-nowrap text-[12px] text-[var(--admin-muted)]">
                      {new Date(report.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </AdminTd>

                    <AdminTd>
                      <AdminBadge
                        tone={
                          report.status === "resolved"
                            ? "success"
                            : report.status === "dismissed"
                              ? "neutral"
                              : report.status === "reviewing"
                                ? "warning"
                                : "danger"
                        }
                      >
                        {report.status}
                      </AdminBadge>
                    </AdminTd>

                    <AdminTd className="text-right">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {report.author_id && !report.author_banned && (
                          <AdminButton
                            variant="danger"
                            disabled={busy}
                            onClick={() =>
                              setBanTarget({
                                id: report.author_id!,
                                username: report.author_username ?? "this account",
                              })
                            }
                            title="Ban the author"
                          >
                            <Ban size={13} />
                            Ban
                          </AdminButton>
                        )}

                        {report.status === "pending" && (
                          <AdminButton variant="ghost" disabled={busy} onClick={() => setStatusFor(report.id, "reviewing")}>
                            <Eye size={13} />
                            Review
                          </AdminButton>
                        )}

                        {report.status !== "resolved" && (
                          <AdminButton variant="ghost" disabled={busy} onClick={() => setStatusFor(report.id, "resolved")}>
                            <CheckCircle2 size={13} />
                            Resolve
                          </AdminButton>
                        )}

                        {report.status !== "dismissed" && (
                          <AdminButton variant="subtle" disabled={busy} onClick={() => setStatusFor(report.id, "dismissed")}>
                            <XCircle size={13} />
                            Dismiss
                          </AdminButton>
                        )}
                      </div>
                    </AdminTd>
                  </AdminRow>
                );
              })}
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
        onDone={() => {
          setBanTarget(null);
          showToast("Author banned.", { variant: "success" });
          reload();
        }}
      />
      )}
    </div>
  );
}
