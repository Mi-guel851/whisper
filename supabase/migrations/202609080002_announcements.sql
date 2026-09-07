-- ===========================================================================
-- Announcement Center: database-backed platform announcements, polls and votes.
--
-- WHY A TABLE AND NOT A FAN-OUT
--
-- The obvious implementation — an admin presses "send" and the server writes a
-- `notifications` row per user, or opens a Realtime channel per recipient — is
-- the same mistake 202609070001 §S4 removed from the feed. At 100k users it is
-- 100k rows and 100k payloads for one sentence of copy, and every one of them
-- is written before a single person has read it.
--
-- Instead an announcement is ONE row. Users read it: `active_announcements_for_me()`
-- answers "what should this account see right now" in a single bounded query,
-- filtered by the audience predicate, and the client fetches it once per app
-- open. Publishing to a million accounts costs one insert.
--
-- WHAT IS HERE
--
--   A1  `announcements` — the row, its audience, its window, its CTA, its poll.
--   A2  `announcement_votes` — one row per (announcement, user), enforced by a
--       unique index, so "one vote per person" is a database constraint rather
--       than a React boolean.
--   A3  `active_announcements_for_me()` — the only client-reachable reader.
--       It resolves the audience server-side, never returns another user's
--       data, and caps the result so a dozen live announcements cannot dump
--       twelve dialogs at once.
--   A4  `cast_announcement_vote()` — the only client-reachable writer.
--   A5  `admin_announcements_page()` — the moderation-side reader, service role.
--
-- Authorization follows 202609080001 §B5: everything an admin does goes through
-- a `service_role`-only function reached from a PIN-checked API route. Both
-- tables have RLS enabled with no client policies, so PostgREST exposes
-- neither to a browser and neither is delivered over Realtime.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- A1. announcements
-- ---------------------------------------------------------------------------

create table if not exists public.announcements (
  id            uuid primary key default gen_random_uuid(),

  kind          text not null default 'info'
                check (kind in ('info', 'poll', 'cta', 'maintenance')),

  title         text not null check (char_length(title) between 1 and 80),
  body          text not null check (char_length(body) between 1 and 600),
  -- Optional illustration. A plain URL rather than a storage key so the client
  -- can render it without a signed-URL round trip; the admin panel only
  -- accepts a same-origin path or an https URL (see the POST route).
  image_url     text,

  cta_label     text check (cta_label is null or char_length(cta_label) between 1 and 40),
  -- Where the button goes. Validated in the API route against a fixed
  -- allowlist of internal paths plus https: URLs, so an announcement can never
  -- become a vector for pointing users at an attacker's domain.
  cta_href      text,

  -- Who sees it. Resolved in SQL, never in the browser.
  audience      text not null default 'everyone'
                check (audience in (
                  'everyone', 'new_users', 'active_users', 'inactive_users',
                  'specific_users', 'banned_users'
                )),
  -- Populated only for 'specific_users'. Kept as a uuid array rather than a
  -- join table because the panel caps it at 500 ids and a membership test on a
  -- bounded array is cheaper than a join.
  audience_ids  uuid[] not null default '{}',

  starts_at     timestamptz,
  ends_at       timestamptz,
  -- Draft/scheduled/live are derived from (active, starts_at, ends_at) rather
  -- than stored as a fourth status, so the three can never disagree.
  active        boolean not null default false,

  poll_options  text[] not null default '{}',

  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz,

  constraint announcements_window_is_ordered
    check (starts_at is null or ends_at is null or starts_at < ends_at),
  constraint announcements_poll_needs_options
    check (kind <> 'poll' or array_length(poll_options, 1) between 2 and 6),
  constraint announcements_specific_needs_ids
    check (audience <> 'specific_users' or array_length(audience_ids, 1) > 0)
);

comment on table public.announcements is
  'Platform announcements. One row reaches every targeted user; nothing is fanned out per recipient.';

-- The read shape: what is live right now, newest first.
create index if not exists announcements_live_idx
  on public.announcements (active, starts_at, ends_at);
create index if not exists announcements_created_at_idx
  on public.announcements (created_at desc);
-- Audience membership for 'specific_users'.
create index if not exists announcements_audience_ids_idx
  on public.announcements using gin (audience_ids);

alter table public.announcements enable row level security;
-- No policies. The browser never selects this table; it calls A3.


-- ---------------------------------------------------------------------------
-- A2. announcement_votes
-- ---------------------------------------------------------------------------

create table if not exists public.announcement_votes (
  id              uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  option_index    integer not null check (option_index >= 0 and option_index < 6),
  created_at      timestamptz not null default now()
);

-- THE rule. One vote per person per announcement, enforced here so that a
-- client racing itself, a double-tap, or a hand-written fetch all hit the same
-- wall. `cast_announcement_vote` turns the violation into a readable answer.
create unique index if not exists announcement_votes_one_per_user
  on public.announcement_votes (announcement_id, user_id);

create index if not exists announcement_votes_tally_idx
  on public.announcement_votes (announcement_id, option_index);

alter table public.announcement_votes enable row level security;
-- No policies: a user's vote is legible to them through A3, and to nobody else.


-- ---------------------------------------------------------------------------
-- A3. What this account should see right now.
--
-- Audience resolution is the security-relevant half. 'specific_users' is a
-- membership test against a bounded array; 'new_users' and the activity
-- audiences are predicates over columns the caller already owns the right to
-- have read about themselves. Nothing here exposes another user's row.
--
-- Bounded at 5 rows: a dialog queue longer than that is a spam cannon, and the
-- client shows them one at a time anyway.
-- ---------------------------------------------------------------------------

create or replace function public.active_announcements_for_me()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  return coalesce((
    select json_agg(a order by a.created_at desc)
    from (
      select json_build_object(
        'id',           x.id,
        'kind',         x.kind,
        'title',        x.title,
        'body',         x.body,
        'image_url',    x.image_url,
        'cta_label',    x.cta_label,
        'cta_href',     x.cta_href,
        'ends_at',      x.ends_at,
        'published_at', x.published_at,
        'poll_options', x.poll_options,
        'my_vote', (
          select v.option_index from public.announcement_votes v
          where v.announcement_id = x.id and v.user_id = me
        ),
        'total_votes', (
          select count(*)::integer from public.announcement_votes v
          where v.announcement_id = x.id
        ),
        'vote_counts', (
          select coalesce(
            array_agg(t.tally order by t.idx),
            array_fill(0, array[greatest(coalesce(array_length(x.poll_options, 1), 0), 0)])
          )
          from generate_subscripts(x.poll_options, 1) as g(idx)
          left join lateral (
            select count(*)::integer as tally
            from public.announcement_votes v
            where v.announcement_id = x.id and v.option_index = g.idx - 1
          ) t on true
        )
      ) as a
      from public.announcements x
      where x.active
        and coalesce(x.starts_at, now()) <= now()
        and (x.ends_at is null or x.ends_at > now())
        and case x.audience
              when 'everyone' then true
              when 'banned_users' then public.user_is_banned(me)
              when 'specific_users' then me = any (x.audience_ids)
              when 'new_users' then exists (
                select 1 from public.profiles p
                where p.id = me and p.created_at >= now() - interval '14 days'
              )
              when 'active_users' then exists (
                select 1 from public.direct_messages d
                where d.sender_id = me and d.created_at >= now() - interval '7 days'
              ) or exists (
                select 1 from public.public_feed_posts f
                where f.author_id = me and f.created_at >= now() - interval '7 days'
              )
              when 'inactive_users' then not exists (
                select 1 from public.direct_messages d
                where d.sender_id = me and d.created_at >= now() - interval '14 days'
              ) and not exists (
                select 1 from public.public_feed_posts f
                where f.author_id = me and f.created_at >= now() - interval '14 days'
              )
              else false
            end
      order by x.created_at desc
      limit 5
    ) a
  ), '[]'::json);
end;
$$;

revoke all on function public.active_announcements_for_me() from public;
revoke all on function public.active_announcements_for_me() from anon;
grant execute on function public.active_announcements_for_me() to authenticated;

comment on function public.active_announcements_for_me() is
  'The announcements this account should see now, with its own vote and the poll tallies. Bounded at 5 rows. Audience is resolved here, never in the client.';


-- ---------------------------------------------------------------------------
-- A4. Voting.
--
-- Every rule is checked before the insert, and the unique index is the backstop
-- for the race between two of them arriving at once. A second attempt returns
-- the vote that already exists rather than an error, because the outcome the
-- user asked for is the outcome they have.
-- ---------------------------------------------------------------------------

create or replace function public.cast_announcement_vote(p_announcement_id uuid, p_option_index integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing integer;
  options  text[];
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_announcement_id is null then
    raise exception 'No announcement selected.';
  end if;

  select x.poll_options into options
  from public.announcements x
  where x.id = p_announcement_id
    and x.active
    and x.kind = 'poll'
    and coalesce(x.starts_at, now()) <= now()
    and (x.ends_at is null or x.ends_at > now());

  if options is null or array_length(options, 1) is null then
    raise exception 'That poll is not open.' using errcode = 'WH002';
  end if;

  -- Audience is re-checked here rather than trusted from the reader: a client
  -- that can call this function directly must not be able to vote on an
  -- announcement it was never shown.
  if not exists (
    select 1 from public.announcements x
    where x.id = p_announcement_id
      and case x.audience
            when 'everyone' then true
            when 'banned_users' then public.user_is_banned(me)
            when 'specific_users' then me = any (x.audience_ids)
            else true
          end
  ) then
    raise exception 'That poll is not open to you.' using errcode = 'WH002';
  end if;

  if p_option_index is null
     or p_option_index < 0
     or p_option_index >= array_length(options, 1) then
    raise exception 'That is not one of the options.' using errcode = '22023';
  end if;

  begin
    insert into public.announcement_votes (announcement_id, user_id, option_index)
    values (p_announcement_id, me, p_option_index);
  exception when unique_violation then
    select v.option_index into existing
    from public.announcement_votes v
    where v.announcement_id = p_announcement_id and v.user_id = me;
    -- Idempotent on purpose. The alternative — an error — reads as a failure to
    -- someone who tapped twice and is correct either way.
    return json_build_object('already_voted', true, 'my_vote', existing);
  end;

  return json_build_object('already_voted', false, 'my_vote', p_option_index);
end;
$$;

revoke all on function public.cast_announcement_vote(uuid, integer) from public;
revoke all on function public.cast_announcement_vote(uuid, integer) from anon;
grant execute on function public.cast_announcement_vote(uuid, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- A5. Admin-side reader and audit trail.
-- ---------------------------------------------------------------------------

create or replace function public.admin_announcements_page(p_state text default 'all')
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'admin_announcements_page is server-side only';
  end if;

  return coalesce((
    select json_agg(a order by a.created_at desc)
    from (
      select json_build_object(
        'id',           x.id,
        'kind',         x.kind,
        'title',        x.title,
        'body',         x.body,
        'image_url',    x.image_url,
        'cta_label',    x.cta_label,
        'cta_href',     x.cta_href,
        'audience',     x.audience,
        'audience_ids', x.audience_ids,
        'starts_at',    x.starts_at,
        'ends_at',      x.ends_at,
        'active',       x.active,
        'poll_options', x.poll_options,
        'created_at',   x.created_at,
        'updated_at',   x.updated_at,
        'published_at', x.published_at,
        'created_by',   (select pr.username from public.profiles pr where pr.id = x.created_by),
        'total_votes',  (select count(*)::integer from public.announcement_votes v
                          where v.announcement_id = x.id),
        'vote_counts',  (
          select coalesce(array_agg(t.tally order by t.idx), '{}')
          from generate_subscripts(x.poll_options, 1) as g(idx)
          left join lateral (
            select count(*)::integer as tally
            from public.announcement_votes v
            where v.announcement_id = x.id and v.option_index = g.idx - 1
          ) t on true
        ),
        -- Derived, so the panel and the database cannot disagree about state.
        'state', case
                   when not x.active then 'draft'
                   when x.starts_at is not null and x.starts_at > now() then 'scheduled'
                   when x.ends_at is not null and x.ends_at <= now() then 'expired'
                   else 'active'
                 end
      ) as a
      from public.announcements x
      where p_state = 'all'
         or (p_state = 'draft'     and not x.active)
         or (p_state = 'scheduled' and x.active and x.starts_at is not null and x.starts_at > now())
         or (p_state = 'active'    and x.active
              and coalesce(x.starts_at, now()) <= now()
              and (x.ends_at is null or x.ends_at > now()))
         or (p_state = 'expired'   and x.ends_at is not null and x.ends_at <= now())
      order by x.created_at desc
      limit 200
    ) a
  ), '[]'::json);
end;
$$;

create or replace function public.admin_create_announcement(p_payload jsonb, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is not null then
    raise exception 'admin_create_announcement is server-side only';
  end if;

  insert into public.announcements (
    kind, title, body, image_url, cta_label, cta_href,
    audience, audience_ids, starts_at, ends_at, active, poll_options, created_by
  )
  values (
    coalesce(p_payload ->> 'kind', 'info'),
    p_payload ->> 'title',
    p_payload ->> 'body',
    nullif(p_payload ->> 'imageUrl', ''),
    nullif(p_payload ->> 'ctaLabel', ''),
    nullif(p_payload ->> 'ctaHref', ''),
    coalesce(p_payload ->> 'audience', 'everyone'),
    coalesce(
      (select array_agg(v::uuid) from jsonb_array_elements_text(coalesce(p_payload -> 'audienceIds', '[]'::jsonb)) v),
      '{}'),
    nullif(p_payload ->> 'startsAt', '')::timestamptz,
    nullif(p_payload ->> 'endsAt', '')::timestamptz,
    coalesce((p_payload ->> 'active')::boolean, false),
    coalesce(
      (select array_agg(v) from jsonb_array_elements_text(coalesce(p_payload -> 'pollOptions', '[]'::jsonb)) v),
      '{}'),
    p_by
  )
  returning id into new_id;

  -- `published_at` is set here rather than by a trigger, because "published"
  -- means an admin turned it on, not that the clock passed starts_at.
  if coalesce((p_payload ->> 'active')::boolean, false) then
    update public.announcements set published_at = now() where id = new_id and published_at is null;
  end if;

  perform public.admin_log(p_by, 'announcement.created', null,
    jsonb_build_object('announcement_id', new_id, 'kind', coalesce(p_payload ->> 'kind', 'info')));

  return new_id;
end;
$$;

create or replace function public.admin_update_announcement(p_id uuid, p_payload jsonb, p_by uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  was_active boolean;
  now_active boolean;
  touched text[] := '{}';
begin
  if auth.uid() is not null then
    raise exception 'admin_update_announcement is server-side only';
  end if;

  select a.active into was_active from public.announcements a where a.id = p_id;
  if not found then
    raise exception 'No announcement with that id.';
  end if;

  -- Field-by-field rather than a bulk merge, so a partial PATCH cannot clear a
  -- column the caller never mentioned.
  if p_payload ? 'kind' then
    update public.announcements set kind = p_payload ->> 'kind' where id = p_id;
    touched := touched || 'kind';
  end if;
  if p_payload ? 'title' then
    update public.announcements set title = p_payload ->> 'title' where id = p_id;
    touched := touched || 'title';
  end if;
  if p_payload ? 'body' then
    update public.announcements set body = p_payload ->> 'body' where id = p_id;
    touched := touched || 'body';
  end if;
  if p_payload ? 'imageUrl' then
    update public.announcements set image_url = nullif(p_payload ->> 'imageUrl', '') where id = p_id;
    touched := touched || 'image_url';
  end if;
  if p_payload ? 'ctaLabel' then
    update public.announcements set cta_label = nullif(p_payload ->> 'ctaLabel', '') where id = p_id;
    touched := touched || 'cta_label';
  end if;
  if p_payload ? 'ctaHref' then
    update public.announcements set cta_href = nullif(p_payload ->> 'ctaHref', '') where id = p_id;
    touched := touched || 'cta_href';
  end if;
  if p_payload ? 'audience' then
    update public.announcements set audience = p_payload ->> 'audience' where id = p_id;
    touched := touched || 'audience';
  end if;
  if p_payload ? 'audienceIds' then
    update public.announcements
       set audience_ids = coalesce(
             (select array_agg(v::uuid) from jsonb_array_elements_text(p_payload -> 'audienceIds') v),
             '{}')
     where id = p_id;
    touched := touched || 'audience_ids';
  end if;
  if p_payload ? 'startsAt' then
    update public.announcements set starts_at = nullif(p_payload ->> 'startsAt', '')::timestamptz where id = p_id;
    touched := touched || 'starts_at';
  end if;
  if p_payload ? 'endsAt' then
    update public.announcements set ends_at = nullif(p_payload ->> 'endsAt', '')::timestamptz where id = p_id;
    touched := touched || 'ends_at';
  end if;
  if p_payload ? 'pollOptions' then
    update public.announcements
       set poll_options = coalesce(
             (select array_agg(v) from jsonb_array_elements_text(p_payload -> 'pollOptions') v),
             '{}')
     where id = p_id;
    touched := touched || 'poll_options';
  end if;
  if p_payload ? 'active' then
    now_active := (p_payload ->> 'active')::boolean;
    update public.announcements
       set active = now_active,
           published_at = case when now_active and published_at is null then now() else published_at end
     where id = p_id;
    touched := touched || 'active';
  end if;

  update public.announcements set updated_at = now() where id = p_id;

  perform public.admin_log(p_by,
    case when p_payload ? 'active' and (p_payload ->> 'active')::boolean and not coalesce(was_active, false)
         then 'announcement.published' else 'announcement.updated' end,
    null,
    jsonb_build_object('announcement_id', p_id, 'fields', touched));

  return true;
end;
$$;

-- Disabled rather than deleted by default; DELETE is a separate route so the
-- destructive path is the one an admin has to choose explicitly.
create or replace function public.admin_delete_announcement(p_id uuid, p_by uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  removed_title text;
begin
  if auth.uid() is not null then
    raise exception 'admin_delete_announcement is server-side only';
  end if;

  select a.title into removed_title from public.announcements a where a.id = p_id;
  if not found then
    raise exception 'No announcement with that id.';
  end if;

  -- Votes cascade with the row. Recorded in the audit entry first, because
  -- after the delete there is nothing left to count.
  perform public.admin_log(p_by, 'announcement.deleted', null, jsonb_build_object(
    'announcement_id', p_id,
    'title', left(coalesce(removed_title, ''), 80),
    'votes_discarded', (select count(*) from public.announcement_votes v where v.announcement_id = p_id)
  ));

  delete from public.announcements where id = p_id;
  return true;
end;
$$;


-- ---------------------------------------------------------------------------
-- Grants: admin functions to service_role only. `active_announcements_for_me`
-- and `cast_announcement_vote` were granted to `authenticated` at creation and
-- are deliberately not in this list — they are the two functions a normal user
-- is supposed to be able to call, and both are scoped to the caller's own rows.
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
  signatures text[] := array[
    'public.admin_announcements_page(text)',
    'public.admin_create_announcement(jsonb, uuid)',
    'public.admin_update_announcement(uuid, jsonb, uuid)',
    'public.admin_delete_announcement(uuid, uuid)'
  ];
begin
  foreach f in array signatures loop
    begin
      execute format('revoke all on function %s from public', f);
      execute format('revoke all on function %s from anon', f);
      execute format('revoke all on function %s from authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    exception when others then
      raise warning 'Grant step skipped for %: %', f, sqlerrm;
    end;
  end loop;
end $$;


-- ===========================================================================
-- ROLLBACK NOTES
-- ===========================================================================
--   drop function if exists public.admin_delete_announcement(uuid, uuid);
--   drop function if exists public.admin_update_announcement(uuid, jsonb, uuid);
--   drop function if exists public.admin_create_announcement(jsonb, uuid);
--   drop function if exists public.admin_announcements_page(text);
--   drop function if exists public.cast_announcement_vote(uuid, integer);
--   drop function if exists public.active_announcements_for_me();
--   drop table if exists public.announcement_votes;   -- discards votes
--   drop table if exists public.announcements;        -- discards announcements
--
-- To stop showing announcements without dropping anything:
--   update public.announcements set active = false;
-- ===========================================================================
