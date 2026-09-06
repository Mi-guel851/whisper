-- =============================================================================
-- Official Whisper Creator posts
-- =============================================================================
-- Adds an *official* posting capability for the two Whisper creator accounts,
-- alongside — never instead of — normal user posting.
--
-- WHAT THE DATABASE GUARANTEES
--
--   1. `public_feed_posts.author_role` is the single, trusted distinction between
--      a normal whisper ('user') and an official announcement ('whisper_creator').
--   2. A row can only carry 'whisper_creator' when its `author_id` is an
--      auth.users account whose *confirmed* email is in `whisper_creator_emails`.
--      This is enforced by a BEFORE trigger that runs for every writer — anon key,
--      authenticated user, service role, SQL editor — so no API route, and no
--      client, can mint an official post for an unauthorised account.
--   3. The RLS insert policy additionally refuses the role at the policy layer for
--      anyone who is not a creator, so the rejection happens twice.
--   4. `author_role` is frozen after insert: a post cannot be promoted later.
--   5. Nothing about normal posting changes. Rows that don't mention the column
--      get 'user', exactly as before.
--
-- WHO IS A CREATOR
--
-- Membership is a *table*, not a hardcoded list inside a function, so it can be
-- extended later with one INSERT and no code change. The table has RLS enabled
-- and no policies, so no client role can read or write it — only definer
-- functions and the service role can see it.
--
-- The check is against `auth.users.email` (lowercased) AND requires
-- `email_confirmed_at is not null`. That second clause matters: if email
-- confirmations were ever disabled, a stranger could sign up with a creator's
-- address before the creator did. Google OAuth accounts arrive confirmed.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. The allowlist
-- ---------------------------------------------------------------------------

create table if not exists public.whisper_creator_emails (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  label text,
  created_at timestamptz not null default now()
);

comment on table public.whisper_creator_emails is
  'Emails allowed to publish official Whisper creator posts. RLS on, no policies: unreadable and unwritable from any client role.';

alter table public.whisper_creator_emails enable row level security;

-- Deliberately no policies. Reads happen inside security-definer functions only.
revoke all on public.whisper_creator_emails from anon, authenticated;

insert into public.whisper_creator_emails (email, label) values
  ('basseyaniekeme43@gmail.com', 'Whisper creator'),
  ('mfonisobassey851@gmail.com', 'Whisper creator')
on conflict (email) do nothing;


-- ---------------------------------------------------------------------------
-- 2. is_whisper_creator(uid)
--
-- The one function every other check is built on. Definer so it can read
-- auth.users and the allowlist; `stable` so a policy can call it per row cheaply.
-- With no argument it answers for the calling session, which is what the client
-- uses to decide whether to *show* creator tools (a convenience — never the
-- authorisation itself).
-- ---------------------------------------------------------------------------

create or replace function public.is_whisper_creator(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id is not null
    and exists (
      select 1
      from auth.users u
      join public.whisper_creator_emails w
        on w.email = lower(u.email)
      where u.id = p_user_id
        and u.email_confirmed_at is not null
        and (u.banned_until is null or u.banned_until < now())
        and u.deleted_at is null
    );
$$;

revoke all on function public.is_whisper_creator(uuid) from public;
grant execute on function public.is_whisper_creator(uuid) to authenticated, service_role;

comment on function public.is_whisper_creator(uuid) is
  'True when the given user (default: the caller) has a confirmed email listed in whisper_creator_emails.';


-- ---------------------------------------------------------------------------
-- 3. The trusted role column
-- ---------------------------------------------------------------------------

alter table public.public_feed_posts
  add column if not exists author_role text not null default 'user';

do $$
begin
  alter table public.public_feed_posts
    add constraint public_feed_posts_author_role_check
    check (author_role in ('user', 'whisper_creator'));
exception when duplicate_object then null;
end $$;

create index if not exists public_feed_posts_official_idx
  on public.public_feed_posts (created_at desc)
  where author_role = 'whisper_creator' and parent_post_id is null;


-- ---------------------------------------------------------------------------
-- 4. The guard trigger
--
-- Runs before RLS is evaluated and for every role, including service_role.
--   INSERT: a claimed 'whisper_creator' is rejected outright unless the author is
--           a creator. Raised rather than coerced, so a spoof attempt is an error
--           the caller sees and not a silently downgraded post.
--   UPDATE: the role is immutable. (view_count updates from triggers still pass,
--           because they don't touch the column.)
-- ---------------------------------------------------------------------------

create or replace function public.guard_public_feed_author_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.author_role is null then
      new.author_role := 'user';
    end if;

    if new.author_role = 'whisper_creator' and not public.is_whisper_creator(new.author_id) then
      raise exception 'Only official Whisper creators can publish official posts'
        using errcode = '42501';
    end if;

    return new;
  end if;

  if new.author_role is distinct from old.author_role then
    raise exception 'author_role cannot be changed after a post is created'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_public_feed_author_role_trigger on public.public_feed_posts;
create trigger guard_public_feed_author_role_trigger
  before insert or update on public.public_feed_posts
  for each row execute function public.guard_public_feed_author_role();


-- ---------------------------------------------------------------------------
-- 5. RLS — the policy layer says the same thing
--
-- The existing insert policy is replaced with one that also refuses the official
-- role for non-creators. Normal posts (`author_role = 'user'`, or the column
-- omitted so the default applies) are unaffected: the first branch is exactly the
-- old policy.
-- ---------------------------------------------------------------------------

drop policy if exists "Users can create own feed posts" on public.public_feed_posts;
create policy "Users can create own feed posts" on public.public_feed_posts
  for insert
  with check (
    auth.uid() = author_id
    and (
      coalesce(author_role, 'user') = 'user'
      or public.is_whisper_creator(auth.uid())
    )
  );

-- No UPDATE policy exists for clients, and none is added: an official post is
-- immutable from the client, same as every other post. Delete stays as it was
-- (authors delete their own), which lets a creator retract their own announcement.


-- ---------------------------------------------------------------------------
-- 6. create_whisper_creator_post — the only sanctioned write path
--
-- Called by app/api/creator/post/route.ts with the *user's* JWT, so `auth.uid()`
-- is the real caller and the check cannot be satisfied by a forged body. Inserts
-- with `author_role = 'whisper_creator'`, which the trigger re-verifies.
--
-- Root posts only: an official reply would need its own rendering rules in the
-- thread, and announcements are what this feature is for.
--
-- Returns the same public columns the feed API returns — never `image_path`.
-- ---------------------------------------------------------------------------

create or replace function public.create_whisper_creator_post(
  p_body text,
  p_image_path text default null,
  p_image_preview text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_username text;
  v_row public.public_feed_posts%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.is_whisper_creator(v_uid) then
    raise exception 'Only official Whisper creators can publish official posts'
      using errcode = '42501';
  end if;

  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'Post body must be between 1 and 500 characters' using errcode = '22023';
  end if;

  if (p_image_path is null) <> (p_image_preview is null) then
    raise exception 'A photo needs both an image and a preview' using errcode = '22023';
  end if;

  select username into v_username from public.profiles where id = v_uid;
  if v_username is null then
    raise exception 'Set a username before posting' using errcode = '22023';
  end if;

  insert into public.public_feed_posts (author_id, body, whisper_link, image_path, image_preview, author_role)
  values (v_uid, v_body, '/u/' || v_username, p_image_path, p_image_preview, 'whisper_creator')
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'author_id', v_row.author_id,
    'author_role', v_row.author_role,
    'body', v_row.body,
    'whisper_link', v_row.whisper_link,
    'created_at', v_row.created_at,
    'expires_at', v_row.expires_at,
    'parent_post_id', v_row.parent_post_id,
    'view_count', v_row.view_count,
    'topic', v_row.topic,
    'has_image', v_row.image_path is not null,
    'image_preview', v_row.image_preview,
    'poll_options', v_row.poll_options,
    'like_count', 0,
    'reply_count', 0,
    'viewer_liked', false,
    'viewer_image_viewed', false
  );
end;
$$;

revoke all on function public.create_whisper_creator_post(text, text, text) from public;
grant execute on function public.create_whisper_creator_post(text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Readers now return `author_role`
--
-- The column is appended *last* to every result shape, so `select *` callers
-- (spotlight/random over page) and positional consumers keep lining up. Return
-- types can't be altered with `create or replace`, so each is dropped first.
-- The bodies are the current ones from 202608220003 / 202608240002 with the one
-- extra column.
-- ---------------------------------------------------------------------------

drop function if exists public.public_feed_spotlight();
drop function if exists public.public_feed_random(uuid[]);
drop function if exists public.public_feed_page(text, text, text, integer, integer);
drop function if exists public.public_feed_thread(uuid);
drop function if exists public.public_feed_saved(integer, integer);

create function public.public_feed_page(
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
  rank_score double precision,
  author_role text
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
        (s.likes_recent * 3.0 + s.replies_recent * 5.0)
        + (s.likes_total * 0.6 + s.replies_total * 1.0)
        + (s.view_count * 0.05)
        + 0.5
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
      (r.replies_total * 1000.0)
      + (r.replies_recent * 50.0)
      + (extract(epoch from r.created_at)::double precision / 1.0e12)
    when 'for_you' then
      r.heat
      * (1.0 + least(0.8, r.affinity_hits * 0.2))
      * (case when r.already_seen then 0.35 else 1.0 end)
    else extract(epoch from r.created_at)::double precision
  end as rank_score,
  r.author_role
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


create function public.public_feed_thread(p_post_id uuid)
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
  rank_score double precision,
  author_role text
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
  extract(epoch from b.created_at)::double precision as rank_score,
  b.author_role
from branch b
where not exists (select 1 from hidden_authors h where h.uid = b.author_id)
  and not exists (
    select 1 from public.public_feed_reports r
    where r.post_id = b.id and r.reporter_id = auth.uid()
  )
order by b.created_at asc;
$$;

grant execute on function public.public_feed_thread(uuid) to authenticated;


create function public.public_feed_spotlight()
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
  rank_score double precision,
  author_role text
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


create function public.public_feed_random(p_exclude uuid[] default '{}')
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
  rank_score double precision,
  author_role text
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


create function public.public_feed_saved(
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
  saved_at timestamptz,
  author_role text
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
    s.created_at as saved_at,
    p.author_role
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
  'The signed-in user''s saved feed posts, newest save first. Same columns as public_feed_page plus saved_at and author_role.';
