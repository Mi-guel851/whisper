"use client";

import { useCallback, useState } from "react";
import { BarChart3, Copy, Eye, EyeOff, Megaphone, Pencil, Plus, Trash2 } from "lucide-react";

import { adminFetch, withQuery, type AdminAnnouncement } from "@/lib/admin/client";
import { runAdminAction, useAdminData } from "@/lib/admin/useAdminData";
import AnnouncementEditor from "@/components/admin/AnnouncementEditor";
import { useToast } from "@/components/ToastProvider";
import {
  AdminBadge,
  AdminButton,
  AdminEmptyState,
  AdminErrorState,
  AdminPanel,
  AdminSkeletonRows,
  AdminStatCard,
} from "@/components/admin/primitives";

/**
 * Announcements.
 *
 * Publishing is one insert. There is no per-user fan-out anywhere in this flow:
 * `active_announcements_for_me()` answers "what should this account see" in one
 * bounded query when the user opens the app (202609080002 §A3). That is the whole
 * design, and it is why an announcement to a million accounts costs the same as one
 * to ten.
 *
 * States are derived from (active, starts_at, ends_at) rather than stored as a
 * fourth status, so the panel and the clock can never disagree about whether
 * something is live.
 */

const TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "scheduled", label: "Scheduled" },
  { key: "draft", label: "Drafts" },
  { key: "expired", label: "Expired" },
] as const;

const AUDIENCE_LABELS: Record<string, string> = {
  everyone: "Everyone",
  new_users: "New users",
  active_users: "Active users",
  inactive_users: "Inactive users",
  specific_users: "Specific accounts",
  banned_users: "Banned accounts",
};

export default function AdminAnnouncementsPage() {
  const { showToast } = useToast();
  const [tab, setTab] = useState<string>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminAnnouncement | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, loading, error, reload } = useAdminData<{ announcements: AdminAnnouncement[] }>(
    withQuery("/api/admin/announcements", { state: tab })
  );

  const announcements = data?.announcements ?? [];

  const mutate = useCallback(
    async (
      id: string,
      patch: Record<string, unknown> | null,
      method: "PATCH" | "DELETE",
      successMessage: string
    ) => {
      setBusyId(id);
      const result = await runAdminAction(() =>
        adminFetch<{ ok: boolean }>(`/api/admin/announcements/${id}`, { method, body: patch ?? undefined })
      );
      setBusyId(null);

      if (!result.ok) {
        showToast(result.error, { variant: "error" });
        return;
      }
      showToast(successMessage, { variant: "success" });
      reload();
    },
    [reload, showToast]
  );

  const duplicate = useCallback(
    async (announcement: AdminAnnouncement) => {
      setBusyId(announcement.id);
      /* Copied as a draft. A duplicate that goes straight live would mean one tap
         publishing a second copy to the same audience, which is the kind of
         irreversible thing a "duplicate" button should not do. */
      const result = await runAdminAction(() =>
        adminFetch<{ id: string }>("/api/admin/announcements", {
          method: "POST",
          body: {
            kind: announcement.kind,
            title: `${announcement.title} (copy)`.slice(0, 80),
            body: announcement.body,
            imageUrl: announcement.image_url ?? "",
            ctaLabel: announcement.cta_label ?? "",
            ctaHref: announcement.cta_href ?? "",
            audience: announcement.audience,
            audienceIds: announcement.audience_ids ?? [],
            pollOptions: announcement.poll_options ?? [],
            active: false,
          },
        })
      );
      setBusyId(null);

      if (!result.ok) {
        showToast(result.error, { variant: "error" });
        return;
      }
      showToast("Copied as a draft.", { variant: "success" });
      reload();
    },
    [reload, showToast]
  );

  const counts = announcements.reduce(
    (accumulator, announcement) => {
      accumulator[announcement.state] = (accumulator[announcement.state] ?? 0) + 1;
      return accumulator;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-white sm:text-2xl">Announcements</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
            Published announcements appear as a popup on targeted users&apos; dashboard.
            One row reaches everyone in the audience — nothing is sent per user.
          </p>
        </div>
        <AdminButton
          variant="primary"
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        >
          <Plus size={14} />
          New announcement
        </AdminButton>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard label="Live now" value={counts.active ?? 0} tone={(counts.active ?? 0) > 0 ? "success" : "default"} loading={loading} />
        <AdminStatCard label="Scheduled" value={counts.scheduled ?? 0} tone={(counts.scheduled ?? 0) > 0 ? "accent" : "default"} loading={loading} />
        <AdminStatCard label="Drafts" value={counts.draft ?? 0} loading={loading} />
        <AdminStatCard label="Expired" value={counts.expired ?? 0} loading={loading} />
      </div>

      <AdminPanel
        actions={
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {TABS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setTab(option.key)}
                aria-pressed={tab === option.key}
                className={`flex-none whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] font-bold transition ${
                  tab === option.key
                    ? "bg-purple-500/20 text-purple-200"
                    : "text-[var(--admin-muted)] hover:bg-white/5 hover:text-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        {error ? (
          <AdminErrorState message={error.message} onRetry={reload} misconfigured={error.misconfigured} />
        ) : loading && !data ? (
          <AdminSkeletonRows rows={4} columns={4} />
        ) : announcements.length === 0 ? (
          <AdminEmptyState
            title="Nothing here yet"
            body="Create an announcement to publish an update, a promotion, a poll or a maintenance notice."
            action={
              <AdminButton
                variant="primary"
                onClick={() => {
                  setEditing(null);
                  setEditorOpen(true);
                }}
              >
                <Plus size={14} />
                New announcement
              </AdminButton>
            }
          />
        ) : (
          <ul className="divide-y divide-white/5">
            {announcements.map((announcement) => {
              const busy = busyId === announcement.id;
              const total = announcement.total_votes ?? 0;

              return (
                <li key={announcement.id} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <AdminBadge
                          tone={
                            announcement.state === "active"
                              ? "success"
                              : announcement.state === "scheduled"
                                ? "accent"
                                : announcement.state === "draft"
                                  ? "neutral"
                                  : "warning"
                          }
                        >
                          {announcement.state}
                        </AdminBadge>
                        <AdminBadge tone="neutral">
                          {announcement.kind === "poll" ? (
                            <span className="inline-flex items-center gap-1">
                              <BarChart3 size={11} />
                              poll
                            </span>
                          ) : (
                            announcement.kind
                          )}
                        </AdminBadge>
                        <span className="text-[11.5px] text-[var(--admin-muted)]">
                          {AUDIENCE_LABELS[announcement.audience] ?? announcement.audience}
                        </span>
                      </div>

                      <h3 className="mt-2 truncate text-[15px] font-bold text-white">{announcement.title}</h3>
                      <p className="mt-1 line-clamp-2 max-w-2xl text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
                        {announcement.body}
                      </p>

                      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[var(--admin-muted)]">
                        {announcement.cta_label && (
                          <span>
                            Button: <span className="text-white">{announcement.cta_label}</span> →{" "}
                            <span className="font-mono">{announcement.cta_href}</span>
                          </span>
                        )}
                        <span>
                          {announcement.starts_at
                            ? `From ${new Date(announcement.starts_at).toLocaleString()}`
                            : "Starts immediately"}
                        </span>
                        <span>
                          {announcement.ends_at
                            ? `Ends ${new Date(announcement.ends_at).toLocaleString()}`
                            : "No end time"}
                        </span>
                        {announcement.created_by && <span>by @{announcement.created_by}</span>}
                        <span>
                          {announcement.published_at
                            ? `Published ${new Date(announcement.published_at).toLocaleDateString()}`
                            : "Never published"}
                        </span>
                      </div>

                      {announcement.kind === "poll" && (
                        <div className="mt-3 space-y-1.5">
                          {announcement.poll_options.map((option, index) => {
                            const tally = announcement.vote_counts?.[index] ?? 0;
                            const pct = total > 0 ? Math.round((tally / total) * 100) : 0;
                            return (
                              <div key={index} className="flex items-center gap-3">
                                <span className="w-40 flex-none truncate text-[12px] text-white">{option}</span>
                                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/8">
                                  <div
                                    className="h-full rounded-full bg-purple-500/70 transition-[width] duration-500"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="admin-numeric w-16 flex-none text-right text-[11.5px] text-[var(--admin-muted)]">
                                  {tally} · {pct}%
                                </span>
                              </div>
                            );
                          })}
                          <p className="admin-numeric pt-0.5 text-[11px] text-[var(--admin-muted)]">
                            {total.toLocaleString()} vote{total === 1 ? "" : "s"}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-none flex-wrap items-center gap-1.5">
                      {announcement.active ? (
                        <AdminButton
                          variant="ghost"
                          disabled={busy}
                          onClick={() => mutate(announcement.id, { active: false }, "PATCH", "Disabled.")}
                          title="Disable — stops showing immediately"
                        >
                          <EyeOff size={13} />
                          Disable
                        </AdminButton>
                      ) : (
                        <AdminButton
                          variant="primary"
                          disabled={busy}
                          onClick={() => mutate(announcement.id, { active: true }, "PATCH", "Published.")}
                        >
                          <Eye size={13} />
                          Publish
                        </AdminButton>
                      )}

                      <AdminButton
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setEditing(announcement);
                          setEditorOpen(true);
                        }}
                      >
                        <Pencil size={13} />
                        Edit
                      </AdminButton>

                      <AdminButton variant="ghost" disabled={busy} onClick={() => duplicate(announcement)}>
                        <Copy size={13} />
                        Duplicate
                      </AdminButton>

                      <AdminButton
                        variant="danger"
                        disabled={busy}
                        title="Deletes the announcement and every vote cast on it"
                        onClick={() => {
                          if (window.confirm(`Delete “${announcement.title}”? Its votes are deleted with it.`)) {
                            void mutate(announcement.id, null, "DELETE", "Deleted.");
                          }
                        }}
                      >
                        <Trash2 size={13} />
                        Delete
                      </AdminButton>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AdminPanel>

      <AdminPanel title="How delivery works">
        <div className="space-y-2.5 p-4 text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
          <p>
            <Megaphone size={13} className="mr-1 inline" />
            Nothing is pushed. When a user opens Whisper, the client asks for the
            announcements that apply to them — filtered by audience, time window and
            active flag inside a single database function — and shows them one at a
            time.
          </p>
          <p>
            Poll voting is limited to one per person by a unique index on
            (announcement, user) and re-checked inside the voting function, so a
            double-tap or a hand-written request cannot add a second vote.
          </p>
          <p>
            Button destinations are validated against a fixed allowlist of Whisper
            pages and https domains the app already links to, so an announcement
            cannot be used to point users somewhere it should not.
          </p>
        </div>
      </AdminPanel>

      {/* Mounted only while open, and keyed by the row: opening a different
          announcement is a fresh component, which is what clears the form. */}
      {editorOpen && (
        <AnnouncementEditor
          key={editing?.id ?? "new"}
          announcement={editing}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            showToast("Saved.", { variant: "success" });
            reload();
          }}
        />
      )}
    </div>
  );
}
