"use client";

import { ImageIcon, Lock } from "lucide-react";

import type { AdminStats } from "@/lib/admin/client";
import { useAdminData } from "@/lib/admin/useAdminData";
import {
  AdminErrorState,
  AdminPanel,
  AdminSkeletonCards,
  AdminStatCard,
} from "@/components/admin/primitives";

/**
 * Media volume.
 *
 * Counted from database columns, never by listing storage. That distinction is the
 * whole reason this section is a panel of numbers: a Cloudinary bucket or a
 * Supabase storage bucket for a product this size is a paginated API walk, and
 * doing that on every dashboard open is exactly the "do not scan huge media
 * storage buckets on every page load" case. `messages.image_url`,
 * `direct_messages.image_path` and `public_feed_posts.image_path` are the records
 * of what exists, and counting them is an index-bounded aggregate.
 *
 * As with /admin/messages, the images themselves are not displayed. Chat photos are
 * view-once and destroyed on first read (/api/photos/view); feed photos are served
 * through an owner-checked route. Neither has a path that would let this panel show
 * them, and adding one would be a new capability, not a dashboard.
 */
export default function AdminMediaPage() {
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

  const totalImages =
    (totals?.total_whisper_images ?? 0) + (totals?.total_chat_images ?? 0) + (totals?.total_feed_images ?? 0);
  const imagesToday =
    (today?.whisper_images_today ?? 0) + (today?.chat_images_today ?? 0) + (today?.feed_images_today ?? 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-white sm:text-2xl">Media</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
          Image counts from database records, not from walking storage buckets. The
          files themselves are not shown here — chat photos are view-once and
          destroyed on first read, and feed photos are served through an
          owner-checked route.
        </p>
      </div>

      {loading ? (
        <AdminSkeletonCards count={8} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <AdminStatCard label="Total images" value={fmt(totalImages)} hint="All surfaces combined" />
          <AdminStatCard label="Images today" value={fmt(imagesToday)} tone="accent" />
          <AdminStatCard label="Anonymous whisper images" value={fmt(totals?.total_whisper_images)} hint={`${fmt(today?.whisper_images_today)} today`} />
          <AdminStatCard label="Chat images" value={fmt(totals?.total_chat_images)} hint={`${fmt(today?.chat_images_today)} today`} />
          <AdminStatCard label="Feed images" value={fmt(totals?.total_feed_images)} hint={`${fmt(today?.feed_images_today)} today`} />
          <AdminStatCard label="Whispers with an image" value={pct(totals?.total_whisper_images, totals?.total_whispers)} hint="Share of all whispers" />
          <AdminStatCard label="Chat messages with an image" value={pct(totals?.total_chat_images, totals?.total_direct_messages)} hint="Share of all inbox messages" />
          <AdminStatCard label="Feed posts with an image" value={pct(totals?.total_feed_images, totals?.total_feed_posts)} hint="Share of all posts" />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminPanel title="How these are counted">
          <ul className="space-y-3 p-4 text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
            <li className="flex items-start gap-2.5">
              <ImageIcon size={14} className="mt-0.5 flex-none" />
              <span>
                A row counts as an image when its image column is non-null. Totals are
                exact; the underlying message totals they are compared against are
                planner estimates, so the percentages are indicative rather than exact.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <ImageIcon size={14} className="mt-0.5 flex-none" />
              <span>
                Nothing here lists a bucket. Storage is never enumerated by this panel,
                at any size.
              </span>
            </li>
          </ul>
        </AdminPanel>

        <AdminPanel title="Why the files aren't shown">
          <div className="flex items-start gap-3 p-4 text-[12.5px] leading-relaxed text-[var(--admin-muted)]">
            <Lock size={15} className="mt-0.5 flex-none" />
            <p>
              Chat photos are view-once: the row&apos;s image column is nulled and the
              asset destroyed the first time the recipient opens it. Feed photos are
              delivered by a route that checks the folder in the URL against the
              requesting account. There is no admin-shaped reader for either, and
              building one would be a new capability rather than a view of an existing
              one — so this section reports volume and stops there.
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

/** A share, as a percentage, with the honest caveat that the denominator is an estimate. */
function pct(part: number | undefined, whole: number | undefined): string {
  if (!part || !whole) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}
