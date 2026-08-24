-- =============================================================================
-- Saved posts
-- =============================================================================
-- `/saved-messages` has been a "coming soon" page and the drawer has linked to it
-- since the feed was rebuilt. This is the feature behind that link.
--
-- WHAT IS SAVED, AND WHAT IS NOT
--
-- A save is a pointer, not a copy. The feed expires posts 24 hours after they are
-- written, and `on delete cascade` means a saved row disappears with its post. That
-- is deliberate: the whole premise of the public feed is that it is ephemeral, and a
-- "Saved" tab that resurrects whispers their authors expected to be gone would break
-- the promise the product is built on. Saving buys you the rest of the 24 hours in
-- one place, not an archive.
--
-- Anyone who wants a permanent copy already has Share, which produces a link and an
-- image — an explicit, visible act rather than a silent private archive of other
-- people's deleted words.
--
-- WHY IT IS PRIVATE
--
-- Only the owner can read, insert or delete their own rows, so a save is invisible
-- to the author. That matters on a confession app: if saves were countable, the
-- number would leak "somebody is keeping this", and on an anonymous post that reads
-- as a threat. There is deliberately no aggregate counter anywhere — this table is
-- never summed, and no policy exposes another user's rows.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. The table
--
-- Composite primary key rather than a surrogate id: saving twice is the same fact
-- as saving once, so the key makes `on conflict do nothing` an idempotent toggle
-- and there is no way to accumulate duplicate rows for one (user, post).
-- ---------------------------------------------------------------------------

create table if not exists public.public_feed_saves (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.public_feed_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- The list is always "my saves, newest first", so the index carries the sort.
create index if not exists public_feed_saves_user_idx
  on public.public_feed_saves (user_id, created_at desc);

alter table public.public_feed_saves enable row level security;


-- ---------------------------------------------------------------------------
-- 2. Policies — your own rows and nobody else's
--
-- Separate policies per command rather than one `for all`: a save has no update
-- path at all (the composite key is the whole row), so no UPDATE policy exists and
-- the operation is refused by default rather than by a check somebody has to
-- remember to write.
-- ---------------------------------------------------------------------------

drop policy if exists "Users read own saves" on public.public_feed_saves;
create policy "Users read own saves" on public.public_feed_saves
  for select using (auth.uid() = user_id);

drop policy if exists "Users create own saves" on public.public_feed_saves;
create policy "Users create own saves" on public.public_feed_saves
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users delete own saves" on public.public_feed_saves;
create policy "Users delete own saves" on public.public_feed_saves
  for delete using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 3. Reading the list
--
-- Returns the same column set as `public_feed_page`, in the same order, so the feed
-- components render a saved post with no branching — a saved row is a `FeedPost`.
-- The only structural difference is `saved_at`, appended last so a client that
-- ignores it still lines up.
--
-- Expired posts are filtered rather than deleted here. The cascade removes them when
-- the sweeper deletes the post; until then, filtering means a save never shows a
-- whisper past its lifetime even if the sweeper is late.
--
-- Blocked authors are excluded for the same reason the feed excludes them: blocking
-- somebody and then finding their post in your own Saved tab is the block failing.
-- ---------------------------------------------------------------------------

create or replace function public.public_feed_saved(
  p_limit integer default 20,
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
  saved_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with blocked as (
    select blocked_user_id as uid from public.blocked_users where user_id = auth.uid()
    union
    select user_id as uid from public.blocked_users where blocked_user_id = auth.uid()
  )
  select
    p.id,
    p.author_id,
    p.body,
    p.whisper_link,
    p.created_at,
    p.expires_at,
    p.parent_post_id,
    p.view_count,
    p.topic,
    (p.image_path is not null) as has_image,
    p.image_preview,
    p.poll_options,
    (select count(*)::integer from public.public_feed_likes l where l.post_id = p.id) as like_count,
    (select count(*)::integer from public.public_feed_posts c
       where c.parent_post_id = p.id and c.expires_at > now()) as reply_count,
    -- Poll tallies are computed, not stored — the same lateral the main feed RPC
    -- uses, so a saved poll shows the same counts as it does in the timeline.
    pc.counts as poll_counts,
    exists (
      select 1 from public.public_feed_likes l
      where l.post_id = p.id and l.user_id = auth.uid()
    ) as viewer_liked,
    exists (
      select 1 from public.public_feed_post_image_views iv
      where iv.post_id = p.id and iv.viewer_id = auth.uid()
    ) as viewer_image_viewed,
    (
      select v.option_index::integer
      from public.public_feed_poll_votes v
      where v.post_id = p.id and v.user_id = auth.uid()
    ) as viewer_vote,
    s.created_at as saved_at
  from public.public_feed_saves s
  join public.public_feed_posts p on p.id = s.post_id
  left join lateral (
    select array_agg(tally order by idx) as counts
    from (
      select
        g.idx,
        count(v.user_id)::integer as tally
      from generate_subscripts(p.poll_options, 1) as g(idx)
      left join public.public_feed_poll_votes v
        on v.post_id = p.id
       and v.option_index = g.idx - 1
      group by g.idx
    ) tallies
  ) pc on true
  where s.user_id = auth.uid()
    and p.expires_at > now()
    and p.author_id not in (select uid from blocked)
  order by s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
  offset greatest(0, coalesce(p_offset, 0))
$$;

grant execute on function public.public_feed_saved(integer, integer) to authenticated;

comment on function public.public_feed_saved(integer, integer) is
  'The signed-in user''s saved feed posts, newest save first. Same columns as public_feed_page plus saved_at.';


-- ---------------------------------------------------------------------------
-- 4. Toggling
--
-- One round trip and one source of truth for the resulting state. A client that
-- inserted-or-deleted itself would need to know the current state first, which is a
-- second query and a race with the same user on another device.
--
-- Returns true when the post is now saved.
-- ---------------------------------------------------------------------------

create or replace function public.toggle_public_feed_save(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  delete from public.public_feed_saves
  where user_id = auth.uid() and post_id = p_post_id;

  get diagnostics removed = row_count;
  if removed > 0 then
    return false;
  end if;

  /* Only saves a post that is real and still alive, so a stale client cannot
     create a row pointing at nothing. `on conflict` covers the double-tap. */
  insert into public.public_feed_saves (user_id, post_id)
  select auth.uid(), p.id
  from public.public_feed_posts p
  where p.id = p_post_id and p.expires_at > now()
  on conflict (user_id, post_id) do nothing;

  return exists (
    select 1 from public.public_feed_saves
    where user_id = auth.uid() and post_id = p_post_id
  );
end $$;

grant execute on function public.toggle_public_feed_save(uuid) to authenticated;

comment on function public.toggle_public_feed_save(uuid) is
  'Saves or unsaves a feed post for the signed-in user. Returns true when it is now saved.';


-- ---------------------------------------------------------------------------
-- 5. Which of these posts have I saved?
--
-- One call for a page of the feed, so the bookmark icons can render filled without
-- a query per card.
-- ---------------------------------------------------------------------------

create or replace function public.public_feed_saved_ids(p_post_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select post_id
  from public.public_feed_saves
  where user_id = auth.uid()
    and post_id = any(p_post_ids)
$$;

grant execute on function public.public_feed_saved_ids(uuid[]) to authenticated;
