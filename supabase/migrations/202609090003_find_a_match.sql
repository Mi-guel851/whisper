-- Find a Match: opt-in regional ranking of discoverable users.
--
-- WHAT THIS IS
--
-- A ranked candidate list for the Friends screen's radar sweep: people in
-- your coarse OPT-IN region (the country you entered at Complete Profile —
-- the same `profiles.country_code` the app already stores for payments and
-- hints) who are active recently, minus everyone you already know.
--
-- WHAT IT IS NOT
--
-- It does not use, store, or even read any precise location. The web
-- Permissions-Policy hard-disables geolocation=(), and this ranking runs on a
-- two-letter code the user typed in. "Nearby" in this product means
-- "same self-declared country" — and the app must keep saying it that way.
--
-- "Active recently" comes from `profiles.last_active_at`, a heartbeat the
-- presence manager (lib/realtime/presence.ts) stamps on connect/reconnect
-- with a ~10-minute throttle. Presence itself is ephemeral WebSocket state;
-- the column is the durable "seen in the last 24h" signal, and a user who has
-- never stamped falls back to their profile's created_at, so nobody is
-- permanently invisible.
--
-- THE EXCLUSIONS (all server-side; the RPC is security definer and applies
-- them itself because it reads profiles data the client RLS never exposes in
-- this shape)
--
--   - self
--   - accounts without a completed profile (an unfinished onboarding is not
--     a matchable user)
--   - users who opted out of Find a Match (find_a_match_enabled = false;
--     DEFAULT ON — only an explicit off hides them)
--   - users without a self-declared region (region is opt-in data; nobody
--     who never set a country is "nearby" anything)
--   - banned users (user_is_banned, 202609080001)
--   - blocked users, either direction (blocked_users)
--   - existing friends, either row direction (friends)
--   - any pending request in either direction (friend_requests)
--
-- PAGING
--
-- 20 per page, page 0-9 (200 rows reachable — far beyond one radar sweep's
-- intent, there so "Scan again" can actually page). The order is deterministic
-- for the day (a daily seed in the tiebreak), so scanning pages 1, 2, 3 does
-- not reshuffle the list out from under the reader; it reshuffles once a day,
-- which is what keeps the surface from feeling like a static directory.
--
-- No data is dropped. Two additive, nullable-by-default columns on profiles.

-- ---------------------------------------------------------------------------
-- 1. The two profile columns the ranking runs on
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists find_a_match_enabled boolean not null default true;

alter table public.profiles
  add column if not exists last_active_at timestamptz;

-- The candidate probe: completed, opted-in, region-bearing profiles.
-- Partial index so opted-out and incomplete accounts cost nothing to scan.
create index if not exists profiles_find_a_match_candidates_idx
  on public.profiles (country_code)
  where find_a_match_enabled is distinct from false
    and profile_completed is distinct from false
    and country_code is not null;

create index if not exists profiles_last_active_idx
  on public.profiles (last_active_at desc);

-- ---------------------------------------------------------------------------
-- 2. The ranking RPC
-- ---------------------------------------------------------------------------

create or replace function public.find_match_candidates(p_page integer default 0)
returns table (
  profile_id   uuid,
  country_code text,
  active_recent boolean,
  rank_score   double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_code text;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- No region of my own means there is no "nearby" to rank against. Zero
  -- rows, not an error: the UI says "set your country first", and in
  -- practice Complete Profile requires a country, so this is a guard
  -- against legacy rows more than a reachable state.
  select country_code into my_code
  from public.profiles
  where id = me;

  if my_code is null then
    return;
  end if;

  return query
  with ranked as (
    select
      p.id as profile_id,
      p.country_code,
      (coalesce(p.last_active_at, p.created_at) > now() - interval '24 hours') as active_recent,
      (
        -- 1) same self-declared region first — the whole point of the radar.
        (case when p.country_code = my_code then 200.0 else 0.0 end)
        -- 2) seen in the last 24 hours, from the presence heartbeat.
        + (case when coalesce(p.last_active_at, p.created_at) > now() - interval '24 hours'
               then 100.0 else 0.0 end)
        -- 3) linear recency decay so near-ties order by most-recent-seen.
        + greatest(0.0, 24.0 - extract(epoch from now() - coalesce(p.last_active_at, p.created_at)) / 3600.0)
        -- 4) deterministic daily seed: stable within a day (pagination can't
        --    reshuffle the list mid-scroll) but a fresh order every day.
        + (abs(hashtext(p.id::text || ':' || me::text || ':' || to_char(date_trunc('day', now()), 'YYYY-MM-DD'))) % 100) / 100.0
      ) as rank_score
    from public.profiles p
    where p.id <> me
      and p.profile_completed is distinct from false
      and p.find_a_match_enabled is distinct from false
      and p.country_code is not null
      and not public.user_is_banned(p.id)
      and not exists (
        select 1 from public.blocked_users b
        where (b.user_id = me and b.blocked_user_id = p.id)
           or (b.user_id = p.id and b.blocked_user_id = me)
      )
      and not exists (
        select 1 from public.friends f
        where (f.user_id = me and f.friend_id = p.id)
           or (f.user_id = p.id and f.friend_id = me)
      )
      and not exists (
        select 1 from public.friend_requests r
        where r.status = 'pending'
          and least(r.sender_id, r.receiver_id) = least(me, p.id)
          and greatest(r.sender_id, r.receiver_id) = greatest(me, p.id)
      )
  )
  select
    ranked.profile_id,
    ranked.country_code,
    ranked.active_recent,
    ranked.rank_score
  from ranked
  order by ranked.rank_score desc, ranked.profile_id
  limit 20
  offset greatest(0, least(coalesce(p_page, 0), 9)) * 20;
end;
$$;

revoke all on function public.find_match_candidates(integer) from public;
revoke all on function public.find_match_candidates(integer) from anon;
grant execute on function public.find_match_candidates(integer) to authenticated;

comment on function public.find_match_candidates(integer) is
  'Find a Match radar: up to 20 ranked candidates per page, ranked by self-declared region match then presence-recency, excluding self, friends, pending requests, blocks, bans and opt-outs. Coarse opt-in location only — no geolocation.';
