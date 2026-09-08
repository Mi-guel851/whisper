"use client";

import { MessageSquare, MessageSquareOff, ShieldCheck } from "lucide-react";

import type { AdminStats } from "@/lib/admin/client";
import { useAdminData } from "@/lib/admin/useAdminData";
import {
  AdminErrorState,
  AdminPanel,
  AdminSkeletonCards,
  AdminStatCard,
} from "@/components/admin/primitives";

/**
 * Message volume.
 *
 * WHAT THIS SECTION DELIBERATELY DOES NOT DO
 *
 * It does not show message contents — not anonymous whispers, not inbox threads,
 * not replies. There is no existing moderation surface in this codebase that
 * authorises an admin to read private correspondence: `messages` carries a paid
 * "sender hint" that even the *recipient* has to pay 5 coins to see
 * (202609070001 §S2), and 202609070001 went further and revoked the sender
 * identity columns from client roles outright because storing a sender identifier
 * a recipient could read for free defeated the product's premise.
 *
 * Building an admin screen that reads those columns would undo that decision by
 * accident, from a different door. So this section is volumes only: how much
 * messaging is happening, when, and where. That answers every operational
 * question the panel needs answered, and it is the reason the section is honest
 * about being a dashboard rather than a transcript.
 *
 * The one place message *content* does reach a moderator is a public feed report —
 * the post is public by construction, and /admin/reports shows the excerpt next to
 * the report that references it.
 */
export default function AdminMessagesPage() {
  const { data, loading, error, reload } = useAdminData<AdminStats>("/api/admin/stats");

  if (error) {
    return (
      <AdminPanel>
        <AdminErrorState message={error.message} onRetry={reload} misconfigured={error.misconfigured} />
      </AdminPanel>
    );
  }

  const totals = data?.totals;
  const today = data?.today;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-[var(--admin-text)] sm:text-2xl">Messages</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
          Volume only. Whisper is an anonymous-messaging product: message bodies are
          not exposed to the admin panel, and no admin role in this codebase is
          authorised to read private correspondence. Counts come from database
          aggregates.
        </p>
      </div>

      {loading ? (
        <AdminSkeletonCards count={6} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <AdminStatCard
            label="Anonymous whispers"
            value={fmt(totals?.total_whispers)}
            hint="Estimated total"
          />
          <AdminStatCard label="Whispers today" value={fmt(today?.whispers_today)} tone="accent" />
          <AdminStatCard label="Whispers yesterday" value={fmt(today?.whispers_yesterday)} />
          <AdminStatCard
            label="Inbox messages"
            value={fmt(totals?.total_direct_messages)}
            hint="Estimated total"
          />
          <AdminStatCard label="Inbox messages today" value={fmt(today?.direct_messages_today)} tone="accent" />
          <AdminStatCard label="Public posts" value={fmt(totals?.total_feed_posts)} hint={`${fmt(today?.feed_posts_today)} today`} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminPanel title="What counts as what">
          <ul className="space-y-3 p-4 text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
            <li className="flex items-start gap-2.5">
              <MessageSquare size={14} className="mt-0.5 flex-none" />
              <span>
                <strong className="text-[var(--admin-text)]">Anonymous whispers</strong> are rows in
                the <code className="rounded bg-[var(--admin-hover)] px-1">messages</code> table —
                what a visitor sends to someone&apos;s Whisper link, with or without an
                account.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <MessageSquareOff size={14} className="mt-0.5 flex-none" />
              <span>
                <strong className="text-[var(--admin-text)]">Inbox messages</strong> are rows in{" "}
                <code className="rounded bg-[var(--admin-hover)] px-1">direct_messages</code> —
                conversation turns between two signed-in accounts.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldCheck size={14} className="mt-0.5 flex-none" />
              <span>
                Neither is filtered or de-duplicated here: these are the platform&apos;s
                own row counts, so the numbers agree with the database.
              </span>
            </li>
          </ul>
        </AdminPanel>

        <AdminPanel title="Why contents aren't shown">
          <div className="space-y-3 p-4 text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
            <p>
              The sender-hint columns on <code className="rounded bg-[var(--admin-hover)] px-1">messages</code>{" "}
              are revoked from <code className="rounded bg-[var(--admin-hover)] px-1">anon</code> and{" "}
              <code className="rounded bg-[var(--admin-hover)] px-1">authenticated</code>, and the
              recipient pays 5 coins to see them. Reading them from an admin screen
              would be the same leak with a different name.
            </p>
            <p>
              If content-level moderation is ever needed, it belongs behind a
              report-driven workflow with its own audit trail — where a moderator
              reads a specific reported item for a stated reason — not behind a
              general-purpose inbox.
            </p>
          </div>
        </AdminPanel>
      </div>
    </div>
  );
}

function fmt(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString();
}
