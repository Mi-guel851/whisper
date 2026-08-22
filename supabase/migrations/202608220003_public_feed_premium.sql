-- ===========================================================================
-- Public Feed — premium social layer
--
-- Additive only. Every object here is new, or a `create or replace` of a
-- function this migration also owns. Nothing existing is dropped or renamed:
-- `public_feed_posts`, `public_feed_likes`, `public_feed_post_views`,
-- `public_feed_notifications` and their policies keep working untouched, and a
-- client that has not been updated keeps reading the table directly.
--
-- What it adds
--   1. Columns on public_feed_posts: topic, image_path, image_preview,
--      poll_options.
--   2. public_feed_post_image_views — view-once photos, counted per viewer.
--   3. public_feed_poll_votes       — one vote per person, enforced by the PK.
--   4. public_feed_reports          — one report per person per post.
--   5. A private `feed-photos` storage bucket.
--   6. Ranking + pagination RPCs so For You / Trending / New / Discussed,
--      search, Whisper of the Day and Surprise Me are all decided server-side
--      over the whole feed instead of over whatever the client happened to load.
--
-- Why the counts are computed in the RPC rather than denormalised into columns:
-- the feed is a 24-hour window, so the working set is small and an aggregate
-- scan is cheaper than the correctness cost of two more triggers that can drift.
-- `view_count` stays denormalised because it already is, with a trigger that
-- already works.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Post columns
-- ---------------------------------------------------------------------------

alter table public.public_feed_posts
  add column if not exists topic text,
  -- Object key in the private `feed-photos` bucket. Never handed to a browser;
  -- bytes are served by app/api/feed/photo/route.ts under the service role.
  add column if not exists image_path text,
  -- A ~24px, heavily compressed JPEG of the image, inline as a data URI. This
  -- is the *only* pixel data the feed ships for a photo whisper: it is what the
  -- blurred plate renders, so the preview is genuinely the picture rather than
  -- a decorative stand-in, while being far too small to make out. The full
  -- image is fetched once, per viewer, through the route.
  add column if not exists image_preview text,
  -- 2-4 choices. Null on a normal post; a poll is a post with options, not a
  -- separate kind of row, so every existing query keeps working on it.
  add column if not exists poll_options text[];

-- Topic slugs. Kept in step with FEED_TOPICS in lib/feed.ts — the constraint is
-- the authority, so an unknown slug is rejected at the door rather than
-- rendering as a blank chip.
do $$
begin
  alter table public.public_feed_posts
    add constraint public_feed_posts_topic_check
    check (
      topic is null or topic in (
        'confession', 'advice', 'love', 'vent',
        'funny', 'deep', 'question', 'random'
      )
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.public_feed_posts
    add constraint public_feed_posts_poll_check
    check (
      poll_options is null
      or (
        array_length(poll_options, 1) between 2 and 4
        -- No blank choices, and nothing long enough to break the bar layout.
        and not exists (
          select 1 from unnest(poll_options) as opt
          where btrim(opt) = '' or char_length(opt) > 60
        )
      )
    );
exception when duplicate_object then null;
end $$;

-- A data URI for a 24px JPEG lands around 700-1200 bytes. The cap is generous
-- enough for that and small enough that nobody can smuggle a real image into
-- the row to dodge the view-once route.
do $$
begin
  alter table public.public_feed_posts
    add constraint public_feed_posts_image_preview_check
    check (image_preview is null or char_length(image_preview) <= 4000);
exception when duplicate_object then null;
end $$;

create index if not exists public_feed_posts_topic_idx
  on public.public_feed_posts (topic, created_at desc)
  where parent_post_id is null;

-- The shape every feed page query starts from: live root posts, newest first.
create index if not exists public_feed_posts_roots_idx
  on public.public_feed_posts (expires_at, created_at desc)
  where parent_post_id is null;


-- ---------------------------------------------------------------------------
-- 2. View-once photos, per viewer
-- ---------------------------------------------------------------------------

-- Chat's view-once deletes the object on first open, because a direct message
-- has exactly one recipient. A feed post has thousands, so "once" has to mean
-- once *each*: the row below is the receipt, and the object lives until the
-- post expires.
create table if not exists public.public_feed_post_image_views (
  post_id uuid not null references public.public_feed_posts(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (post_id, viewer_id)
);

create index if not exists public_feed_post_image_views_viewer_idx
  on public.public_feed_post_image_views (viewer_id, viewed_at desc);

alter table public.public_feed_post_image_views enable row level security;

-- Read your own receipts and nothing else — so the feed can grey out the photos
-- you have already spent, without telling you who else looked.
drop policy if exists "Viewers read own feed photo views" on public.public_feed_post_image_views;
create policy "Viewers read own feed photo views" on public.public_feed_post_image_views
  for select using (auth.uid() = viewer_id);

-- Deliberately no insert policy. Writing a receipt is the act of spending a
-- view, and only the server route may do it — a client that could insert its
-- own row could also decline to, and view the photo forever.


-- ---------------------------------------------------------------------------
-- 3. Poll votes
-- ---------------------------------------------------------------------------

create table if not exists public.public_feed_poll_votes (
  post_id uuid not null references public.public_feed_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  option_index smallint not null check (option_index between 0 and 3),
  created_at timestamptz not null default now(),
  -- One row per person per poll. This is the duplicate-vote protection, and it
  -- is a primary key rather than a frontend check, so two taps racing each
  -- other cannot both land.
  primary key (post_id, user_id)
);

create index if not exists public_feed_poll_votes_post_idx
  on public.public_feed_poll_votes (post_id, option_index);

alter table public.public_feed_poll_votes enable row level security;

-- Only your own vote is readable. Totals come from vote_public_feed_poll() and
-- public_feed_page(), which aggregate under a definer — so a poll can show
-- results without anyone being able to list who chose what.
drop policy if exists "Voters read own feed poll vote" on public.public_feed_poll_votes;
create policy "Voters read own feed poll vote" on public.public_feed_poll_votes
  for select using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 4. Reports
-- ---------------------------------------------------------------------------

create table if not exists public.public_feed_reports (
  post_id uuid not null references public.public_feed_posts(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'sexual', 'violence', 'self_harm', 'other')),
  details text check (details is null or char_length(details) <= 400),
  created_at timestamptz not null default now(),
  -- Reporting twice is not two reports.
  primary key (post_id, reporter_id)
);

create index if not exists public_feed_reports_post_idx
  on public.public_feed_reports (post_id, created_at desc);

alter table public.public_feed_reports enable row level security;

drop policy if exists "Users file own feed reports" on public.public_feed_reports;
create policy "Users file own feed reports" on public.public_feed_reports
  for insert with check (
    auth.uid() = reporter_id
    -- Reporting your own post is not moderation, it is a mistake.
    and exists (
      select 1 from public.public_feed_posts p
      where p.id = post_id and p.author_id <> auth.uid()
    )
  );

drop policy if exists "Users read own feed reports" on public.public_feed_reports;
create policy "Users read own feed reports" on public.public_feed_reports
  for select using (auth.uid() = reporter_id);

-- No update or delete policy: a filed report is not the reporter's to retract,
-- and hiding the post is handled by the feed queries below reading this table.


-- ---------------------------------------------------------------------------
-- 5. Photo storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feed-photos',
  'feed-photos',
  false, -- private: no public URL exists, so a leaked path is worthless
  5242880, -- 5MB; the client downscales to ~1600px before it ever gets here
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/gif']
)
on conflict (id) do update
  set public             = excluded.public,
      allowed_mime_types = excluded.allowed_mime_types,
      file_size_limit    = excluded.file_size_limit;

-- Objects are keyed `<author_id>/<uuid>.<ext>`, so ownership is readable from
-- the name without a lookup. Malformed names simply fail to match rather than
-- raising, or one junk object would break policy evaluation for the bucket.
drop policy if exists "Authors upload own feed photos" on storage.objects;
create policy "Authors upload own feed photos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feed-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "Authors delete own feed photos" on storage.objects;
create policy "Authors delete own feed photos" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'feed-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- No select policy at all. Every read goes through the view-once route under
-- the service role, which is the only place that can decide whether this viewer
-- still has a look left.


-- ---------------------------------------------------------------------------
-- 6. Reading the feed
-- ---------------------------------------------------------------------------

/**
 * One page of the feed, ranked, filtered and personalised.
 *
 * `p_sort`:
 *   new       — newest first.
 *   trending  — engagement *in the last 6 hours*, decayed by post age. A post
 *               that collected fifty likes yesterday and none since ranks below
 *               one collecting them now, which is the whole point of a trending
 *               tab and the thing a lifetime-likes sort gets wrong.
 *   discussed — most replies, recent replies breaking the tie.
 *   for_you   — trending, weighted up for topics this viewer actually engages
 *               with and down for posts they have already scrolled past.
 *
 * Returns `has_image` rather than `image_path`: the browser never needs the key,
 * and not sending it removes a whole class of mistake.
 *
 * Offset pagination rather than keyset, deliberately. Three of the four sorts
 * order by a score computed at query time, which has no stable cursor, and the
 * candidate set is bounded by the 24-hour window — so the usual objection to
 * OFFSET does not apply here.
 */
create or replace function public.public_feed_page(
  p_sort text default 'new',
  p_topic text default null,
  p_search text default null,
  p_limit integer default 10,
  p_offset integer default 0
)
returns table (
  id uuid,
  author_id uuid,
  body text,
  whisper_link text,
  created_at timestamptz,
  expires_at timestamptz,
  parent_post_id uuid,
  view_count integer,
  topic text,
  has_image boolean,
  image_preview text,
  poll_options text[],
  like_count integer,
  reply_count integer,
  poll_counts integer[],
  viewer_liked boolean,
  viewer_image_viewed boolean,
  viewer_vote integer,
  rank_score double precision
)
language sql
stable
security definer
set search_path = public
as $$
with recursive
  -- Everyone this viewer has blocked, and everyone who has blocked them. Both
  -- directions: a feed that hides your blocks but still shows you theirs is a
  -- one-way mirror.
  hidden_authors as (
    select blocked_user_id as uid from public.blocked_users where user_id = auth.uid()
    union
    select user_id as uid from public.blocked_users where blocked_user_id = auth.uid()
  ),
  candidates as (
    select p.*
    from public.public_feed_posts p
    where p.expires_at > now()
      and p.parent_post_id is null
      and not exists (select 1 from hidden_authors h where h.uid = p.author_id)
      and not exists (
        select 1 from public.public_feed_reports r
        where r.post_id = p.id and r.reporter_id = auth.uid()
      )
      and (p_topic is null or p.topic = p_topic)
      and (
        p_search is null
        or btrim(p_search) = ''
        or p.body ilike '%' || btrim(p_search) || '%'
      )
  ),
  -- Every reply attributed to the root of its thread, so a root post's count is
  -- the size of the whole conversation and not just its direct answers. The
  -- base case is restricted to replies *of a root*, or each reply would also be
  -- counted again under its grandparent.
  descendants as (
    select reply.id, reply.parent_post_id as root_id, reply.created_at
    from public.public_feed_posts reply
    join public.public_feed_posts parent on parent.id = reply.parent_post_id
    where reply.expires_at > now()
      and parent.parent_post_id is null
    union all
    select child.id, d.root_id, child.created_at
    from public.public_feed_posts child
    join descendants d on child.parent_post_id = d.id
    where child.expires_at > now()
  ),
  thread_metrics as (
    select
      root_id,
      count(*)::integer as total,
      count(*) filter (where created_at > now() - interval '6 hours')::integer as recent
    from descendants
    group by root_id
  ),
  like_metrics as (
    select
      post_id,
      count(*)::integer as total,
      count(*) filter (where created_at > now() - interval '6 hours')::integer as recent
    from public.public_feed_likes
    group by post_id
  ),
  -- Which topics this viewer has actually engaged with. Real behaviour, not a
  -- declared interest — so For You needs no settings screen to work.
  affinity as (
    select p.topic, count(*)::double precision as hits
    from public.public_feed_likes l
    join public.public_feed_posts p on p.id = l.post_id
    where l.user_id = auth.uid()
      and p.topic is not null
      and l.created_at > now() - interval '14 days'
    group by p.topic
  ),
  scored as (
    select
      c.*,
      coalesce(lm.total, 0)  as likes_total,
      coalesce(lm.recent, 0) as likes_recent,
      coalesce(tm.total, 0)  as replies_total,
      coalesce(tm.recent, 0) as replies_recent,
      -- Hours old, floored at a little above zero so a brand-new post does not
      -- divide by something near nothing and rank first on arithmetic alone.
      -- Kept in double precision throughout: `extract` returns numeric, and a
      -- numeric `power()` with a fractional exponent is markedly slower for no
      -- benefit at this precision.
      greatest(
        extract(epoch from (now() - c.created_at))::double precision / 3600.0,
        0.25
      ) as age_hours,
      coalesce(a.hits, 0) as affinity_hits,
      exists (
        select 1 from public.public_feed_post_views v
        where v.post_id = c.id and v.viewer_id = auth.uid()
      ) as already_seen
    from candidates c
    left join like_metrics   lm on lm.post_id = c.id
    left join thread_metrics tm on tm.root_id = c.id
    left join affinity        a on a.topic   = c.topic
  ),
  ranked as (
    select
      s.*,
      (
        -- A reply is worth more than a like because it costs more to write.
        (s.likes_recent * 3.0 + s.replies_recent * 5.0)
        -- Lifetime engagement still counts, at a fifth of the weight, so a good
        -- post that has gone quiet does not vanish the moment it stops moving.
        + (s.likes_total * 0.6 + s.replies_total * 1.0)
        + (s.view_count * 0.05)
        + 0.5 -- floor, so a brand-new post with nothing yet still sorts by age
      )::double precision / power(s.age_hours + 2.0, 1.35) as heat
    from scored s
  )
select
  r.id,
  r.author_id,
  r.body,
  r.whisper_link,
  r.created_at,
  r.expires_at,
  r.parent_post_id,
  r.view_count,
  r.topic,
  (r.image_path is not null) as has_image,
  r.image_preview,
  r.poll_options,
  r.likes_total   as like_count,
  r.replies_total as reply_count,
  pc.counts       as poll_counts,
  exists (
    select 1 from public.public_feed_likes l
    where l.post_id = r.id and l.user_id = auth.uid()
  ) as viewer_liked,
  exists (
    select 1 from public.public_feed_post_image_views iv
    where iv.post_id = r.id and iv.viewer_id = auth.uid()
  ) as viewer_image_viewed,
  (
    select v.option_index::integer
    from public.public_feed_poll_votes v
    where v.post_id = r.id and v.user_id = auth.uid()
  ) as viewer_vote,
  case lower(coalesce(p_sort, 'new'))
    when 'trending'  then r.heat
    when 'discussed' then
      -- Reply count dominates; recent replies break ties; age breaks those.
      (r.replies_total * 1000.0)
      + (r.replies_recent * 50.0)
      + (extract(epoch from r.created_at)::double precision / 1.0e12)
    when 'for_you' then
      r.heat
      -- Up to +80% for a topic this viewer keeps liking, tapering so one
      -- enthusiasm cannot crowd out the rest of the feed.
      * (1.0 + least(0.8, r.affinity_hits * 0.2))
      -- Already-scrolled-past posts drop but do not disappear, so For You can
      -- still resurface something that has since caught fire.
      * (case when r.already_seen then 0.35 else 1.0 end)
    else extract(epoch from r.created_at)::double precision
  end as rank_score
from ranked r
left join lateral (
  select array_agg(tally order by idx) as counts
  from (
    select
      g.idx,
      count(v.user_id)::integer as tally
    from generate_subscripts(r.poll_options, 1) as g(idx)
    left join public.public_feed_poll_votes v
      on v.post_id = r.id
     and v.option_index = g.idx - 1
    group by g.idx
  ) tallies
) pc on true
order by rank_score desc, r.created_at desc
limit greatest(1, least(coalesce(p_limit, 10), 50))
offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.public_feed_page(text, text, text, integer, integer) to authenticated;


/**
 * Every reply under one root post, whole subtree, oldest first.
 *
 * Threads are fetched on expand rather than shipped with the page, which is
 * what lets the feed paginate at all — the old query pulled every reply in the
 * window on first paint.
 */
create or replace function public.public_feed_thread(p_post_id uuid)
returns table (
  id uuid,
  author_id uuid,
  body text,
  whisper_link text,
  created_at timestamptz,
  expires_at timestamptz,
  parent_post_id uuid,
  view_count integer,
  topic text,
  has_image boolean,
  image_preview text,
  poll_options text[],
  like_count integer,
  reply_count integer,
  poll_counts integer[],
  viewer_liked boolean,
  viewer_image_viewed boolean,
  viewer_vote integer,
  rank_score double precision
)
language sql
stable
security definer
set search_path = public
as $$
with recursive
  hidden_authors as (
    select blocked_user_id as uid from public.blocked_users where user_id = auth.uid()
    union
    select user_id as uid from public.blocked_users where blocked_user_id = auth.uid()
  ),
  branch as (
    select p.*
    from public.public_feed_posts p
    where p.parent_post_id = p_post_id
      and p.expires_at > now()
    union all
    select child.*
    from public.public_feed_posts child
    join branch b on child.parent_post_id = b.id
    where child.expires_at > now()
  )
select
  b.id,
  b.author_id,
  b.body,
  b.whisper_link,
  b.created_at,
  b.expires_at,
  b.parent_post_id,
  b.view_count,
  b.topic,
  (b.image_path is not null) as has_image,
  b.image_preview,
  b.poll_options,
  (select count(*)::integer from public.public_feed_likes l where l.post_id = b.id) as like_count,
  (select count(*)::integer from public.public_feed_posts c where c.parent_post_id = b.id and c.expires_at > now()) as reply_count,
  null::integer[] as poll_counts,
  exists (
    select 1 from public.public_feed_likes l
    where l.post_id = b.id and l.user_id = auth.uid()
  ) as viewer_liked,
  exists (
    select 1 from public.public_feed_post_image_views iv
    where iv.post_id = b.id and iv.viewer_id = auth.uid()
  ) as viewer_image_viewed,
  null::integer as viewer_vote,
  extract(epoch from b.created_at)::double precision as rank_score
from branch b
where not exists (select 1 from hidden_authors h where h.uid = b.author_id)
  and not exists (
    select 1 from public.public_feed_reports r
    where r.post_id = b.id and r.reporter_id = auth.uid()
  )
order by b.created_at asc;
$$;

grant execute on function public.public_feed_thread(uuid) to authenticated;


/**
 * Whisper of the Day — the single most-engaged live post.
 *
 * Returns no row when nothing has been engaged with yet, rather than crowning
 * the newest post by default. A "post of the day" that is really just "a post"
 * is the kind of empty badge that teaches people to ignore badges.
 */
create or replace function public.public_feed_spotlight()
returns table (
  id uuid,
  author_id uuid,
  body text,
  whisper_link text,
  created_at timestamptz,
  expires_at timestamptz,
  parent_post_id uuid,
  view_count integer,
  topic text,
  has_image boolean,
  image_preview text,
  poll_options text[],
  like_count integer,
  reply_count integer,
  poll_counts integer[],
  viewer_liked boolean,
  viewer_image_viewed boolean,
  viewer_vote integer,
  rank_score double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.public_feed_page('trending', null, null, 25, 0) t
  where t.like_count + t.reply_count > 0
  limit 1;
$$;

grant execute on function public.public_feed_spotlight() to authenticated;


/**
 * Surprise Me — one random live post the viewer has not been shown yet.
 *
 * `p_exclude` is the ids already served this session, so pressing the button
 * repeatedly walks the feed instead of landing on the same three posts. When
 * everything has been excluded it returns nothing, and the caller resets.
 *
 * Built on public_feed_page so blocking, reporting and expiry are enforced in
 * exactly one place.
 */
create or replace function public.public_feed_random(p_exclude uuid[] default '{}')
returns table (
  id uuid,
  author_id uuid,
  body text,
  whisper_link text,
  created_at timestamptz,
  expires_at timestamptz,
  parent_post_id uuid,
  view_count integer,
  topic text,
  has_image boolean,
  image_preview text,
  poll_options text[],
  like_count integer,
  reply_count integer,
  poll_counts integer[],
  viewer_liked boolean,
  viewer_image_viewed boolean,
  viewer_vote integer,
  rank_score double precision
)
language sql
volatile
security definer
set search_path = public
as $$
  select *
  from public.public_feed_page('new', null, null, 50, 0) t
  where not (t.id = any (coalesce(p_exclude, '{}'::uuid[])))
  order by random()
  limit 1;
$$;

grant execute on function public.public_feed_random(uuid[]) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Voting
-- ---------------------------------------------------------------------------

/**
 * Casts or changes this viewer's vote and returns the new tallies.
 *
 * One statement, so two taps racing cannot both insert — the primary key
 * decides, and the loser becomes an update. Returning the tallies means the
 * client never has to guess at the total it should optimistically show.
 */
create or replace function public.vote_public_feed_poll(
  p_post_id uuid,
  p_option_index integer
)
returns integer[]
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  options text[];
  tallies integer[];
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select poll_options into options
  from public.public_feed_posts
  where id = p_post_id and expires_at > now();

  if options is null then
    raise exception 'This post is not a poll';
  end if;

  if p_option_index is null
     or p_option_index < 0
     or p_option_index > array_length(options, 1) - 1 then
    raise exception 'That choice does not exist';
  end if;

  insert into public.public_feed_poll_votes (post_id, user_id, option_index)
  values (p_post_id, auth.uid(), p_option_index)
  on conflict (post_id, user_id)
  do update set option_index = excluded.option_index, created_at = now();

  select array_agg(tally order by idx) into tallies
  from (
    select g.idx, count(v.user_id)::integer as tally
    from generate_subscripts(options, 1) as g(idx)
    left join public.public_feed_poll_votes v
      on v.post_id = p_post_id
     and v.option_index = g.idx - 1
    group by g.idx
  ) t;

  return coalesce(tallies, '{}'::integer[]);
end;
$$;

grant execute on function public.vote_public_feed_poll(uuid, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. Expiry now sweeps storage too
-- ---------------------------------------------------------------------------

/**
 * Replaces the existing cleanup so an expiring post takes its photo with it.
 *
 * Without this the rows vanish on schedule and the objects accumulate forever —
 * a 24-hour feed quietly turning into permanent image storage, which is the
 * opposite of what a view-once photo promises.
 */
create or replace function public.cleanup_expired_public_feed_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
  doomed_paths text[];
begin
  select array_agg(image_path)
    into doomed_paths
    from public.public_feed_posts
   where expires_at <= now()
     and image_path is not null;

  if doomed_paths is not null and array_length(doomed_paths, 1) > 0 then
    delete from storage.objects
     where bucket_id = 'feed-photos'
       and name = any (doomed_paths);
  end if;

  delete from public.public_feed_posts where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;


-- ---------------------------------------------------------------------------
-- 9. Realtime
-- ---------------------------------------------------------------------------

-- Votes stream so a poll's bars move while you are looking at it. Image-view
-- receipts and reports deliberately do not: both are private, and broadcasting
-- them would leak exactly the thing their RLS policies protect.
do $$ begin
  alter publication supabase_realtime add table public.public_feed_poll_votes;
exception when duplicate_object then null; end $$;
