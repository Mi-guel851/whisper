-- =============================================================================
-- Unique anonymous names
-- =============================================================================
-- Every registered user gets a system-generated anonymous handle -- the name
-- shown in Discover, Friends, the Inbox list, Chat headers and the public feed.
-- It was computed in the browser from the user id, and the namespace it drew
-- from was 15 prefixes x 100 suffixes = 1500 names. At that size a handle
-- repeats almost immediately: one user in fifteen is called "DarkWolf", so a few
-- dozen accounts is enough to see the same name four times over.
--
-- This makes the handle a stored, uniquely-indexed column instead.
--
--   * 30 adjectives x 28 nouns x 9000 numbers = 7,560,000 distinct handles,
--     formatted exactly as before (`DarkWolf.4821`), so nothing about the app
--     looks different -- the names just stop colliding.
--   * A partial unique index makes "no two users share a handle" a fact rather
--     than a hope.
--   * Assignment happens in a BEFORE INSERT trigger, so a handle exists from the
--     moment a profile does. There is no window where a user has no name, and no
--     client code path that could skip it.
--
-- WHY A SEQUENCE AND NOT random()
--
-- The handle is derived from `nextval`, which is atomic, and the decomposition
-- below is injective -- so two concurrent signups cannot be handed the same
-- handle in the first place. A random generator would have to test-then-insert,
-- and losing that race means a failed signup. Race-free beats retry-loop.
--
-- The trigger writes `new.anon_name` directly rather than running as AFTER
-- INSERT, which would have to UPDATE the row it just fired for and re-enter
-- itself.
--
-- The word lists are mirrored in `lib/anonymousIdentity.ts`, which the client
-- still uses as an instant fallback while the stored handle is being fetched.
-- Both sides produce the same shape, so the swap is invisible.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists anon_name text;

-- Partial: profiles are only in this index once they hold a handle, so the many
-- NULLs during a backfill do not collide with each other.
create unique index if not exists profiles_anon_name_unique
  on public.profiles (anon_name)
  where anon_name is not null;


-- ---------------------------------------------------------------------------
-- 2. Sequence value -> handle
-- ---------------------------------------------------------------------------

create sequence if not exists public.anon_name_serial as bigint start 1;

create or replace function public.whisper_anon_name_for(n bigint)
returns text
language plpgsql
immutable
as $$
declare
  adjectives text[] := array[
    'Dark','Night','Neon','Silent','Void','Moon','Nova','Pixel','Echo','Alpha',
    'Ghost','Shadow','Cipher','Ember','Frost','Storm','Solar','Lunar','Astral',
    'Crimson','Cobalt','Onyx','Velvet','Static','Hollow','Quiet','Faded','Muted',
    'Drift','Zero'
  ];
  nouns text[] := array[
    'Wolf','Fox','Ghost','Echo','Raven','Owl','Lynx','Void','Nova','Shade',
    'Wisp','Specter','Phantom','Ember','Comet','Cipher','Drifter','Signal',
    'Static','Whisper','Mirage','Vector','Pulse','Reign','Sparrow','Falcon',
    'Serpent','Halo'
  ];
  span bigint := 30 * 28 * 9000;   -- 7,560,000
  k bigint;
begin
  -- Scattered before decomposition, otherwise consecutive signups get
  -- consecutive numbers and the handle reads as a queue ticket. 2654435761 is
  -- coprime with 7,560,000 (= 2^6 * 3^3 * 5^4 * 7), so multiplying mod span is
  -- a bijection: distinct n within a span always yield distinct handles.
  k := (n * 2654435761) % span;

  return adjectives[1 + ((k / 28) % 30)::int]
      || nouns[1 + (k % 28)::int]
      || '.'
      || (1000 + ((k / 840) % 9000))::int;
end $$;

comment on function public.whisper_anon_name_for(bigint) is
  'Maps a sequence value to a distinct anonymous handle. Injective across each block of 7,560,000 values.';


-- ---------------------------------------------------------------------------
-- 3. Assignment
-- ---------------------------------------------------------------------------

create or replace function public.whisper_assign_anon_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
  candidate text;
begin
  if new.anon_name is not null then
    return new;
  end if;

  n := nextval('public.anon_name_serial');
  candidate := public.whisper_anon_name_for(n);

  -- Only reachable once the sequence passes 7.56M profiles and the bijection
  -- starts a second lap. The fallback embeds the raw sequence value, which is
  -- unique by construction and -- seven digits or more by then -- cannot be
  -- mistaken for one of the four-digit handles above.
  if exists (select 1 from public.profiles where anon_name = candidate) then
    candidate := split_part(candidate, '.', 1) || '.' || n;
  end if;

  new.anon_name := candidate;
  return new;
end $$;

drop trigger if exists profiles_assign_anon_name on public.profiles;
create trigger profiles_assign_anon_name
  before insert on public.profiles
  for each row execute function public.whisper_assign_anon_name();


-- ---------------------------------------------------------------------------
-- 4. Existing profiles
--
-- Ordered by id so re-running against a partially backfilled table is stable.
-- Each iteration takes its own sequence value, so this cannot hand two rows the
-- same handle even if it runs concurrently with signups.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  n bigint;
  candidate text;
begin
  for r in
    select id from public.profiles where anon_name is null order by id
  loop
    n := nextval('public.anon_name_serial');
    candidate := public.whisper_anon_name_for(n);
    if exists (select 1 from public.profiles where anon_name = candidate) then
      candidate := split_part(candidate, '.', 1) || '.' || n;
    end if;
    update public.profiles set anon_name = candidate where id = r.id;
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 5. Reading them back
--
-- The client resolves handles for a batch of user ids at a time (see
-- `lib/anonNames.ts`). That is a primary-key lookup on `profiles`, so no index
-- is needed here -- noted so the omission reads as a decision.
--
-- `anon_name` is deliberately NOT added to the realtime publication column list
-- from 202608190001. A handle never changes after it is assigned, so there is
-- nothing to stream, and widening that list puts columns into the WAL payload of
-- every profile UPDATE for no reason.
-- ---------------------------------------------------------------------------
