-- =============================================================================
-- Author engagement series — the real numbers behind the dashboard chart
-- =============================================================================
-- The dashboard chart used to plot `messages` + `profile_views`, both read
-- straight from the browser. Two problems with extending that to post views and
-- likes, which is what it now shows:
--
--  1. `public_feed_post_views` is RLS'd to `viewer_id = auth.uid()` — you can see
--     what *you* looked at, nobody else. So an author cannot read the view rows
--     for their own posts at all. The only readable figure is the denormalised
--     `view_count` on the post, which is a lifetime total with no dates in it and
--     therefore cannot be bucketed into a day-by-day series.
--
--  2. Even for the tables the client *can* read, plotting seven days meant
--     fetching every row and counting them in JavaScript. That is a lot of rows
--     over the wire to produce fourteen integers.
--
-- So the whole series is computed here, in one round trip, `security definer` so
-- it can reach across the view rows — and scoped to `auth.uid()` so it can only
-- ever describe the caller's own posts. It returns counts per day and nothing
-- else: no viewer ids, no liker ids, no post bodies. An author learns that four
-- people looked at their post, never which four.
--
-- `days` is clamped rather than trusted: the chart asks for 7, and an unbounded
-- value would let a caller ask for a series over all time in one call.
-- =============================================================================

create or replace function public.whisper_author_engagement(days integer default 7)
returns table (
  day date,
  whispers bigint,
  profile_views bigint,
  post_views bigint,
  post_likes bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with bounds as (
    -- 1..90. A NULL from a caller that omitted the argument lands on 7.
    select greatest(1, least(90, coalesce(days, 7))) as span
  ),
  calendar as (
    select generate_series(
             (current_date - (select span from bounds) + 1),
             current_date,
             interval '1 day'
           )::date as day
  ),
  -- Resolved once. Referencing auth.uid() inside each subquery below would
  -- re-evaluate it per row of the calendar.
  me as (select auth.uid() as id),
  mine as (
    select id from public.public_feed_posts where author_id = (select id from me)
  )
  select
    c.day,
    (select count(*) from public.messages m
      where m.recipient_id = (select id from me)
        and m.created_at >= c.day
        and m.created_at < c.day + 1) as whispers,
    (select count(*) from public.profile_views v
      where v.profile_id = (select id from me)
        and v.created_at >= c.day
        and v.created_at < c.day + 1) as profile_views,
    (select count(*) from public.public_feed_post_views pv
      where pv.post_id in (select id from mine)
        and pv.created_at >= c.day
        and pv.created_at < c.day + 1) as post_views,
    (select count(*) from public.public_feed_likes pl
      where pl.post_id in (select id from mine)
        and pl.created_at >= c.day
        and pl.created_at < c.day + 1) as post_likes
  from calendar c
  order by c.day;
$$;

comment on function public.whisper_author_engagement(integer) is
  'Per-day engagement counts for the calling user only: whispers received, profile views, views and likes on their own feed posts. Counts only — never viewer or liker identities.';

revoke all on function public.whisper_author_engagement(integer) from public;
revoke all on function public.whisper_author_engagement(integer) from anon;
grant execute on function public.whisper_author_engagement(integer) to authenticated;

-- The date-range scans above lean on these. `if not exists` so re-running is
-- safe and so this does not fight whichever earlier migration added them.
create index if not exists public_feed_post_views_created_at_idx
  on public.public_feed_post_views (post_id, created_at desc);

create index if not exists public_feed_likes_created_at_idx
  on public.public_feed_likes (post_id, created_at desc);

create index if not exists public_feed_posts_author_idx
  on public.public_feed_posts (author_id);

create index if not exists profile_views_profile_created_idx
  on public.profile_views (profile_id, created_at desc);

create index if not exists messages_recipient_created_idx
  on public.messages (recipient_id, created_at desc);
