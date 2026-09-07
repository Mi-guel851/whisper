"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Coins,
  Flag,
  Image as ImageIcon,
  MessageSquare,
  Megaphone,
  ShieldOff,
  UserPlus,
  Users,
} from "lucide-react";

import { AdminRequestError, adminFetch, type AdminStats } from "@/lib/admin/client";
import { useAdminData } from "@/lib/admin/useAdminData";
import {
  AdminButton,
  AdminErrorState,
  AdminPanel,
  AdminSkeletonCards,
  AdminStatCard,
} from "@/components/admin/primitives";

/**
 * Overview.
 *
 * Every number here comes from `admin_platform_stats` in one request. Nothing is
 * hardcoded and nothing is counted client-side — there is no query in this file at
 * all, which is the point.
 *
 * HOW THE COSTS ARE KEPT DOWN (202609080001 §B6)
 *
 *   - The big totals are read from `admin_stats_cache`, recomputed at most once
 *     every five minutes no matter how many admins are looking.
 *   - `total_whispers`, `total_direct_messages` and `total_feed_posts` are
 *     `pg_class.reltuples` estimates rather than `count(*)`. They are within a
 *     couple of percent, maintained by autovacuum, and cost a catalog read instead
 *     of a scan — the same trade 202609070001 §S10 already makes for the public
 *     activity strip. Exact counts of tables that will hold hundreds of millions
 *     of rows, on every dashboard open, is not a trade worth making for a number
 *     that is only ever read as an order of magnitude.
 *   - The "today"/"yesterday" figures are exact, because they are all
 *     `created_at >= <boundary>` on an indexed column.
 *
 * So a dashboard render is: one cached JSON row, one 30-day GROUP BY over an index,
 * and a dozen index-bounded range counts. No full-table scan, at any scale.
 */

export default function AdminOverviewPage() {
  const { data, loading, error, reload } = useAdminData<AdminStats>("/api/admin/stats");

  const totals = data?.totals;
  const today = data?.today;
  const registrations = data?.registrations ?? [];

  /* Newest first for the list, oldest first for the chart. Computed once. */
  const recentDays = useMemo(() => [...registrations].reverse(), [registrations]);
  const peak = useMemo(
    () => registrations.reduce((max, day) => Math.max(max, day.count), 0),
    [registrations]
  );

  if (error) {
    return (
      <AdminPanel>
        <AdminErrorState message={error.message} onRetry={reload} misconfigured={error.misconfigured} />
      </AdminPanel>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle={
          data
            ? `Totals cached ${new Date(data.computed_at).toLocaleTimeString()} · live counts as of ${new Date(
                data.generated_at
              ).toLocaleTimeString()}`
            : "Platform health at a glance"
        }
        action={
          <AdminButton
            variant="ghost"
            onClick={async () => {
              try {
                await adminFetch("/api/admin/stats?refresh=1");
                reload();
              } catch (err) {
                if (err instanceof AdminRequestError) reload();
              }
            }}
          >
            Recompute totals
          </AdminButton>
        }
      />

      {/* ------------------------------------------------------------ */}
      {/* People                                                       */}
      {/* ------------------------------------------------------------ */}
      <SectionHeading>People</SectionHeading>
      {loading ? (
        <AdminSkeletonCards count={4} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <AdminStatCard
            label="Registered users"
            value={fmt(totals?.total_users)}
            hint="Estimated; see the note below"
          />
          <AdminStatCard
            label="New today"
            value={fmt(today?.users_today)}
            tone="accent"
            hint={`${fmt(today?.users_yesterday)} yesterday`}
          />
          <AdminStatCard label="New this week" value={fmt(today?.users_this_week)} hint="Last 7 days" />
          <AdminStatCard label="New this month" value={fmt(today?.users_this_month)} hint="Last 30 days" />
        </div>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Registration activity                                        */}
      {/* ------------------------------------------------------------ */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <AdminPanel title="Registrations" subtitle="Last 30 days, from profile creation timestamps">
          {loading ? (
            <div className="p-4">
              <div className="h-40 animate-pulse rounded-xl bg-white/6" />
            </div>
          ) : registrations.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-[var(--admin-muted)]">
              No registrations recorded yet.
            </p>
          ) : (
            <RegistrationChart days={registrations} peak={peak} />
          )}
        </AdminPanel>

        <AdminPanel title="Day by day" subtitle="Newest first">
          <ul className="max-h-[19rem] divide-y divide-white/5 overflow-y-auto">
            {(loading ? PLACEHOLDER_DAYS : recentDays).map((day) => (
              <li key={day.date} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-[12.5px] text-[var(--admin-muted)]">{formatDayLabel(day.date)}</span>
                <span className="admin-numeric text-[13px] font-bold text-white">{day.count}</span>
              </li>
            ))}
          </ul>
        </AdminPanel>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* Messages & media                                             */}
      {/* ------------------------------------------------------------ */}
      <SectionHeading>Messages &amp; media</SectionHeading>
      {loading ? (
        <AdminSkeletonCards count={8} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <AdminStatCard
            label="Anonymous whispers"
            value={fmt(totals?.total_whispers)}
            hint={`${fmt(today?.whispers_today)} today`}
          />
          <AdminStatCard
            label="Whispers today"
            value={fmt(today?.whispers_today)}
            tone="accent"
            hint={`${fmt(today?.whispers_yesterday)} yesterday`}
          />
          <AdminStatCard
            label="Inbox messages"
            value={fmt(totals?.total_direct_messages)}
            hint={`${fmt(today?.direct_messages_today)} today`}
          />
          <AdminStatCard
            label="Anonymous images"
            value={fmt(
              (totals?.total_whisper_images ?? 0) + (totals?.total_chat_images ?? 0) + (totals?.total_feed_images ?? 0)
            )}
            hint="Whispers, chat and feed combined"
          />
          <AdminStatCard
            label="Images today"
            value={fmt(
              (today?.whisper_images_today ?? 0) + (today?.chat_images_today ?? 0) + (today?.feed_images_today ?? 0)
            )}
            tone="accent"
            hint={`Chat ${fmt(today?.chat_images_today)} · whispers ${fmt(today?.whisper_images_today)} · feed ${fmt(
              today?.feed_images_today
            )}`}
          />
          <AdminStatCard label="Whisper images" value={fmt(totals?.total_whisper_images)} />
          <AdminStatCard label="Chat images" value={fmt(totals?.total_chat_images)} />
          <AdminStatCard label="Feed images" value={fmt(totals?.total_feed_images)} />
        </div>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Feed, coins, moderation                                      */}
      {/* ------------------------------------------------------------ */}
      <SectionHeading>Feed, coins &amp; moderation</SectionHeading>
      {loading ? (
        <AdminSkeletonCards count={8} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <AdminStatCard
            label="Public posts"
            value={fmt(totals?.total_feed_posts)}
            hint={`${fmt(today?.feed_posts_today)} today`}
          />
          <AdminStatCard label="Posts today" value={fmt(today?.feed_posts_today)} tone="accent" />
          <AdminStatCard label="Coins held" value={fmt(totals?.coins_held)} hint="Sum of every wallet" />
          <AdminStatCard label="Coins spent" value={fmt(totals?.coins_spent)} hint="All-time" />
          <AdminStatCard label="Coins purchased" value={fmt(totals?.coins_purchased)} hint="Via Paystack" />
          <AdminStatCard label="Coins granted" value={fmt(totals?.coins_granted)} hint="By admins" />
          <AdminStatCard
            label="Banned users"
            value={fmt(totals?.banned_users)}
            tone={(totals?.banned_users ?? 0) > 0 ? "danger" : "default"}
            hint={`${fmt(totals?.bans_all_time)} bans issued all-time`}
          />
          <AdminStatCard
            label="Pending reports"
            value={fmt(totals?.pending_reports)}
            tone={(totals?.pending_reports ?? 0) > 0 ? "warning" : "default"}
            hint={`${fmt(totals?.reviewing_reports)} under review`}
          />
        </div>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Announcements + the honest caveat                            */}
      {/* ------------------------------------------------------------ */}
      <div className="grid gap-4 lg:grid-cols-2">
        <AdminPanel title="Announcements" subtitle="Live right now">
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-purple-500/15">
                <Megaphone size={18} className="text-purple-300" />
              </span>
              <div>
                <p className="admin-numeric text-xl font-black text-white">
                  {loading ? "—" : fmt(totals?.active_announcements)}
                </p>
                <p className="text-[12px] text-[var(--admin-muted)]">
                  {fmt(totals?.announcements_all_time)} created all-time
                </p>
              </div>
            </div>
            <Link href="/admin/announcements">
              <AdminButton variant="ghost">
                Manage
                <ArrowUpRight size={14} />
              </AdminButton>
            </Link>
          </div>
        </AdminPanel>

        <AdminPanel title="How to read these numbers">
          <ul className="space-y-2.5 p-4 text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
            <LegendRow icon={<Users size={13} />} text="User totals are planner estimates refreshed by autovacuum, not exact counts. Exact counts of a table this size would be a full scan on every page load." />
            <LegendRow icon={<UserPlus size={13} />} text="Today, yesterday, week and month figures are exact — they ride an index on profiles.created_at." />
            <LegendRow icon={<MessageSquare size={13} />} text="“Anonymous whispers” are rows in the messages table: what someone sends to a Whisper link. Inbox messages are counted separately." />
            <LegendRow icon={<ImageIcon size={13} />} text="Image counts come from database columns, never from scanning storage buckets." />
            <LegendRow icon={<Coins size={13} />} text="Coin figures are exact, and are the reason the cache exists: they aggregate the ledger." />
            <LegendRow icon={<Flag size={13} />} text="Reports are the moderation queue — pending, reviewing, resolved, dismissed." />
            <LegendRow icon={<ShieldOff size={13} />} text="Banned counts only bans that are active and not yet expired." />
          </ul>
        </AdminPanel>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-black text-white sm:text-2xl">{title}</h1>
        <p className="mt-1 text-[12.5px] text-[var(--admin-muted)]">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="pt-1 text-[11px] font-bold uppercase tracking-wider text-[var(--admin-muted)]">{children}</h2>
  );
}

function LegendRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 flex-none text-[var(--admin-muted)]">{icon}</span>
      <span>{text}</span>
    </li>
  );
}

/** Shown while the first request is in flight, so the list has a shape. */
const PLACEHOLDER_DAYS = Array.from({ length: 8 }).map((_, index) => ({
  date: `placeholder-${index}`,
  count: 0,
}));

/**
 * A 30-bar registration chart, hand-rolled.
 *
 * recharts is already in the project (components/ActivityChart.tsx), but a
 * thirty-bar column chart does not need it, and pulling a charting library into
 * the admin bundle for one panel is a poor trade. Bars are divs: no SVG
 * coordinate maths, no resize observer, and they scale down to a 360px phone
 * because they are a flex row that simply gets narrower.
 */
function RegistrationChart({ days, peak }: { days: Array<{ date: string; count: number }>; peak: number }) {
  const safePeak = Math.max(peak, 1);

  return (
    <div className="px-4 pb-4 pt-5">
      <div className="flex h-40 items-end gap-[3px]" role="img" aria-label="Registrations per day over the last 30 days">
        {days.map((day) => {
          const pct = (day.count / safePeak) * 100;
          return (
            <div key={day.date} className="group relative flex min-w-0 flex-1 flex-col justify-end" title={`${formatDayLabel(day.date)}: ${day.count}`}>
              <div
                className="w-full rounded-t-[3px] bg-gradient-to-t from-purple-600/50 to-purple-400/90 transition-opacity group-hover:opacity-80"
                /* A zero day still gets 2px: a bar of no height at all reads as
                   a gap in the data rather than as a quiet day. */
                style={{ height: `${Math.max(pct, 1.5)}%` }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex justify-between text-[10.5px] text-[var(--admin-muted)]">
        <span>{formatDayLabel(days[0]?.date)}</span>
        <span>peak {peak}</span>
        <span>{formatDayLabel(days[days.length - 1]?.date)}</span>
      </div>
    </div>
  );
}

function fmt(value: number | undefined | null): string {
  if (value === undefined || value === null) return "—";
  return value.toLocaleString();
}

/**
 * `2026-09-07` → `September 7` (or `Today` / `Yesterday`).
 *
 * Parsed as parts rather than `new Date(string)`: a bare `YYYY-MM-DD` is parsed as
 * UTC, so in any timezone behind UTC the label would be a day early — which on a
 * registrations chart is exactly the kind of off-by-one that makes the numbers
 * look wrong.
 */
function formatDayLabel(iso: string | undefined): string {
  if (!iso || iso.startsWith("placeholder")) return "";
  const [year, month, day] = iso.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return iso;

  const date = new Date(year, month - 1, day);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((startOfToday.getTime() - date.getTime()) / 86_400_000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}
