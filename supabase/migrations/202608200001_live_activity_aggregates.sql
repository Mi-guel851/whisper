-- =============================================================================
-- Live Whisper activity — global aggregates
-- =============================================================================
-- Why this function has to exist
--
-- The obvious implementation of an activity strip is a client-side
-- `select count(*)` on `messages`. It is also wrong, and wrong in a way that
-- looks right: RLS on `messages` limits every reader to their own rows, so the
-- count comes back as "whispers *you* received today" while the label says
-- "whispers today". A brand-new user sees 2 and assumes the platform is dead; a
-- busy user sees their own inbox and assumes it is thriving. Both are misreads
-- of a number that was never global.
--
-- So the aggregate is computed here, `security definer`, where it can see every
-- row — and it returns nothing but counts. There is no way to use this function
-- to learn who sent what: no ids, no bodies, no timestamps, no per-user
-- breakdown. Counts only.
--
-- Granted to `authenticated` rather than `service_role` because it is read from
-- the browser and there is nothing sensitive in the result. `anon` is excluded so
-- the landing page can't be used as cba free metrics endpoint.
-- =============================================================================

create or replace function public.whisper_live_activity()
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    -- Local midnight is a client concept, so "today" here is UTC-day. The strip
    -- labels it "today" and being an hour off at the boundary is invisible at
    -- this granularity; passing a timezone in would let a caller fish for
    -- narrower windows, which is a worse trade.
    'whispers_today', (
      select count(*) from public.messages
      where created_at >= date_trunc('day', now())
    ),
    'whispers_total', (
      select count(*) from public.messages
    ),
    'conversations_total', (
      select count(*) from public.conversations
    ),
    'feed_posts_today', (
      select count(*) from public.public_feed_posts
      where created_at >= date_trunc('day', now())
    )
  );
$$;

comment on function public.whisper_live_activity() is
  'Global, non-identifying activity counts for the live activity strip. Returns counts only — never ids, bodies, or per-user data.';

revoke all on function public.whisper_live_activity() from public;
revoke all on function public.whisper_live_activity() from anon;
grant execute on function public.whisper_live_activity() to authenticated;

-- Indexes the counts above lean on. `if not exists` so re-running is safe and so
-- this does not fight whichever earlier migration may already have added them.
create index if not exists messages_created_at_idx
  on public.messages (created_at desc);

create index if not exists public_feed_posts_created_at_idx
  on public.public_feed_posts (created_at desc);
