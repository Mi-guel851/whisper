-- ===========================================================================
-- Post views — "every view counts" (Option A)
--
-- The previous implementation (202608030001_public_feed_metrics.sql) made
-- `public_feed_post_views` unique per (post_id, viewer_id) and had the
-- recorder insert with `on conflict do nothing`. That deduplicates: a person
-- who comes back to a post — refresh, reopen, scroll past again — never moves
-- the counter a second time. It also skipped the author's own views.
--
-- The product now wants Option A: every qualifying view increments the post's
-- total by exactly one, with no unique-user, per-day, or per-session limit.
-- This migration repairs the *existing* objects rather than adding new ones.
--
-- What changes
--   1. `public_feed_post_views` becomes an append-only log: a surrogate
--      `id` primary key replaces the (post_id, viewer_id) unique constraint,
--      which is kept only as a *non-unique* index. Now a repeat viewer inserts
--      a second row, so the view is genuinely counted again.
--   2. `record_public_feed_impressions(uuid[])` is redefined to return the new
--      `view_count` per post it touched (so the client stops guessing with a
--      client-side +1), no longer deduplicates, and no longer excludes the
--      author. The atomic increment still lives in the existing
--      `sync_public_feed_view_count()` trigger on INSERT.
--   3. The count stays permanent: the trigger only ever *adds* on INSERT and is
--      no longer paired with a decrement on DELETE, so pruning the log for
--      storage (or cascade deletes when a post expires) cannot lower a total.
--
-- RLS is untouched: clients still cannot UPDATE `view_count` (no policy exists
-- for it), so they can only move it by calling the RPC, which increments
-- server-side. The database remains the single source of truth.
-- ===========================================================================

-- 1. Make the view log append-only instead of one-row-per-viewer.
alter table public.public_feed_post_views
  drop constraint if exists public_feed_post_views_pkey;

alter table public.public_feed_post_views
  add column if not exists id bigint generated always as identity
    primary key;

-- (post_id, viewer_id) is now just a lookup index — not a uniqueness guard.
drop index if exists public_feed_post_views_post_viewer_idx;
create index if not exists public_feed_post_views_post_viewer_idx
  on public.public_feed_post_views (post_id, viewer_id);

-- A short-lived guard against a *transient* double-insert of the very same
-- request, without blocking a *genuine* later re-view. Two views a fraction of
-- a second apart are two rows; the same row resent by a network retry is one.
drop index if exists public_feed_post_views_dedup_idx;
create unique index if not exists public_feed_post_views_dedup_idx
  on public.public_feed_post_views (post_id, viewer_id, created_at)
  where created_at > now() - interval '2 seconds';

-- 2. Re-record impressions. Now: every id in the batch becomes one new row
--    (one +1), and the function returns the resulting view_count per post so
--    the client can render the authoritative number.
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
    and p.expires_at > now();

  return query
  select p.id, p.view_count
  from public.public_feed_posts p
  where p.id = any(post_ids);
end;
$$;

grant execute on function public.record_public_feed_impressions(uuid[]) to authenticated;

-- 3. The count is permanent. The old trigger decremented on DELETE; remove that
--    half so a view can never be taken back, while keeping the atomic +1 on
--    every INSERT (this is what makes concurrent views safe — one UPDATE wins
--    per row, serialised by the database).
create or replace function public.sync_public_feed_view_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.public_feed_posts
    set view_count = view_count + 1
    where id = new.post_id;
  end if;
  return null;
end;
$$;

drop trigger if exists public_feed_view_count_trigger on public.public_feed_post_views;
create trigger public_feed_view_count_trigger
after insert on public.public_feed_post_views
for each row execute function public.sync_public_feed_view_count();

-- Realtime: the posts table already broadcasts its changes; an UPDATE carrying
-- a fresh view_count reaches every open feed and the owner's dashboard. No new
-- publication entry is required — public_feed_posts is already in
-- supabase_realtime. The view log stays in the publication for the dashboard
-- 7-day series, which keys off rows rather than the denormalised column.
do $$ begin
  alter publication supabase_realtime add table public.public_feed_posts;
exception when duplicate_object then null; end $$;
