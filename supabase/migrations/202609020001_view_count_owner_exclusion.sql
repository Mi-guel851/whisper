-- ===========================================================================
-- Post views — the post owner never counts
--
-- 202608260001_view_count_every_view.sql moved the feed to "every view
-- counts": record_public_feed_impressions() logs one row per impression into
-- public_feed_post_views, and the existing sync_public_feed_view_count()
-- trigger turns each inserted row into exactly one +1 on
-- public_feed_posts.view_count. That change also dropped the author filter
-- that 202608030001_public_feed_metrics.sql used to carry
-- (`and p.author_id <> auth.uid()`), so today an author inflates their own
-- post's view count every time they open it — and because the log is
-- append-only, every refresh and reopen adds another.
--
-- This migration restores the owner exclusion at the only place a view can
-- enter the system — the record_public_feed_impressions() RPC — and touches
-- nothing else:
--
--   * No owner view-record: the insert below skips posts the caller authored,
--     so no row is ever logged for an owner's own open and the trigger never
--     fires for them. Counter and log stay in lockstep (view_count == row
--     count), the invariant the dashboard 7-day series
--     (202608200002_author_engagement_series.sql) and the premium ranker
--     (202608220003_public_feed_premium.sql) read from.
--   * Existing counting rules unchanged: every view by any other
--     authenticated user still inserts a row and counts (+1 per open,
--     refresh included — "every view counts"); the sub-2-second retry-guard
--     index from 202608260001 still applies; anonymous callers still return
--     early and record nothing; expired posts still record nothing; the
--     returned (post_id, view_count) shape is identical, so lib/feedApi.ts
--     keeps applying the authoritative, database-computed number.
--   * Enforced database-side: RLS on public_feed_post_views grants SELECT of
--     your own rows only and defines no INSERT policy, so this
--     security-definer RPC is the sole write path. An owner calling the API
--     directly — from any client — still cannot move their own counter.
--
-- Idempotent: safe to run repeatedly (drop + create, grant re-asserted).
-- No existing migration is modified; no other object is changed.
-- ===========================================================================

drop function if exists public.record_public_feed_impressions(uuid[]);

create or replace function public.record_public_feed_impressions(post_ids uuid[])
returns table (post_id uuid, view_count integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  if post_ids is null or array_length(post_ids, 1) is null then return; end if;

  insert into public.public_feed_post_views (post_id, viewer_id)
  select p.id, auth.uid()
  from public.public_feed_posts p
  where p.id = any(post_ids)
    -- The owner never counts toward their own post: no log row, so the
    -- sync_public_feed_view_count() trigger never fires for them either.
    and p.author_id <> auth.uid()
    and p.expires_at > now();

  return query
  select p.id, p.view_count
  from public.public_feed_posts p
  where p.id = any(post_ids);
end;
$$;

grant execute on function public.record_public_feed_impressions(uuid[]) to authenticated;
