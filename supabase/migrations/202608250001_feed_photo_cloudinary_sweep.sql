-- =============================================================================
-- Feed photo expiry, after the Cloudinary migration
-- =============================================================================
-- `cleanup_expired_public_feed_posts()` (202608220003, section 8) deleted the
-- expiring post's photo by removing a row from `storage.objects` in the
-- `feed-photos` bucket. Feed photos are now uploaded to Cloudinary and
-- `image_path` holds a delivery URL, so that DELETE matches nothing for any post
-- written since the migration: the rows still expire on schedule, but the images
-- behind them stay in Cloudinary forever.
--
-- That is the exact failure the original sweep was written to prevent — "a
-- 24-hour feed quietly turning into permanent image storage" — so it has to keep
-- working across both storage backends.
--
-- WHY A QUEUE AND NOT A DIRECT CALL
--
-- Deleting a Cloudinary asset is an authenticated HTTPS call signed with
-- CLOUDINARY_API_SECRET. Postgres cannot make it: the secret is a server
-- environment variable and deliberately not in the database, and reaching the
-- network from plpgsql would mean pg_net plus storing that secret here. So the
-- sweep records what should be destroyed and /api/cloudinary/sweep — which does
-- hold the secret — drains the queue.
--
-- The ordering this produces is the safe one. A row is queued in the same
-- transaction that deletes the post, so the asset is unreferenced before anything
-- tries to destroy it, and a failed or never-run drain leaves an orphan (costs
-- storage) rather than a live post whose photo has been deleted (breaks the
-- feature). Legacy `feed-photos` keys keep taking the old path, unchanged and
-- still transactional.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. The queue
--
-- No RLS policies are written, and that is the point: RLS is enabled, so with no
-- policy the table is unreadable and unwritable through the anon and authenticated
-- keys. The only things that touch it are the security-definer function below and
-- the service role, which bypasses RLS. A client has no business knowing which
-- photos are pending deletion — the URLs are exactly what the feed's proxy route
-- exists to keep server-side.
-- ---------------------------------------------------------------------------

create table if not exists public.cloudinary_deletion_queue (
  -- The delivery URL, as it was stored on the post. Primary key rather than a
  -- surrogate id: queueing the same URL twice is the same fact as queueing it
  -- once, which makes the insert below idempotent for free.
  url text primary key,
  queued_at timestamptz not null default now(),
  -- Bumped by the drainer on each failed attempt, so a permanently failing entry
  -- is visible instead of silently retried forever.
  attempts integer not null default 0,
  last_error text
);

alter table public.cloudinary_deletion_queue enable row level security;

-- Oldest first, so the drainer's LIMIT takes the longest-waiting entries.
create index if not exists cloudinary_deletion_queue_queued_at_idx
  on public.cloudinary_deletion_queue (queued_at);


-- ---------------------------------------------------------------------------
-- 2. The sweep, handling both backends
--
-- `image_path` is classified by prefix. This mirrors `isCloudinaryUrl()` in
-- lib/cloudinary.ts, but it is a narrower test on purpose: this function only
-- decides which of two cleanup paths to take, and anything unrecognised falls
-- through to the legacy storage DELETE, which is a no-op for a value that is not
-- an object key. The authoritative host-and-cloud check still happens in
-- lib/cloudinary.ts before anything is actually destroyed.
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_expired_public_feed_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  -- Cloudinary URLs: hand off to the drainer.
  insert into public.cloudinary_deletion_queue (url)
  select image_path
    from public.public_feed_posts
   where expires_at <= now()
     and image_path is not null
     and image_path like 'https://res.cloudinary.com/%'
  on conflict (url) do nothing;

  -- Legacy `feed-photos` object keys: delete now, as before.
  delete from storage.objects
   where bucket_id = 'feed-photos'
     and name in (
       select image_path
         from public.public_feed_posts
        where expires_at <= now()
          and image_path is not null
          and image_path not like 'https://res.cloudinary.com/%'
     );

  delete from public.public_feed_posts where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. Queueing a deletion from elsewhere
--
-- The expiry sweep is not the only way a photo becomes garbage: a post deleted by
-- its author, or cascaded away with its profile, leaves the same orphan. Those
-- paths run as the user rather than the service role, so they need a callable
-- entry point that does not expose the queue itself.
--
-- Ownership is checked against the post, not passed in — an arbitrary URL cannot
-- be queued by a caller who does not own the post carrying it.
-- ---------------------------------------------------------------------------

create or replace function public.queue_public_feed_photo_deletion(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  doomed text;
begin
  select image_path
    into doomed
    from public.public_feed_posts
   where id = p_post_id
     and author_id = auth.uid()
     and image_path is not null
     and image_path like 'https://res.cloudinary.com/%';

  if doomed is null then
    return false;
  end if;

  insert into public.cloudinary_deletion_queue (url)
  values (doomed)
  on conflict (url) do nothing;

  return true;
end;
$$;

grant execute on function public.queue_public_feed_photo_deletion(uuid) to authenticated;
