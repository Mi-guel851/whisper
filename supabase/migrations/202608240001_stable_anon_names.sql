-- =============================================================================
-- Anonymous handles that genuinely belong to a person
-- =============================================================================
-- `202608210001_unique_identities.sql` made the handle a stored, uniquely-indexed
-- column and assigned it from a sequence. That fixed collisions and it is why the
-- column exists. It left one problem, and this migration is about that problem.
--
-- THE BUG
--
-- The client renders `anonymousDisplayName(userId)` — a hash of the user id — for
-- the frame or two before the stored handle arrives, and the earlier migration's
-- header says "Both sides produce the same shape, so the swap is invisible."
-- Same *shape*, but not the same *value*. The fallback hashes the id and lands on
-- `DarkWolf.4821`; the trigger takes `nextval` and lands on `NeonRaven.1234`.
-- Two different namespaces for one user.
--
-- Most of the time that is a flicker nobody catches. It stops being a flicker the
-- moment a profile row is created *after* the user has already been on screen —
-- which is precisely what happens on a first Google sign-in, where the row is
-- written at /setup rather than at signup. The user sees one name, the row is
-- created, the trigger mints an unrelated one, and the name they had been shown
-- is gone. Reported symptom: "when I logout and login again names change."
--
-- It also means a handle is only stable as long as its row is. Anything that
-- recreates a profile row — a restore, a re-signup on the same account, a manual
-- fix — draws a fresh sequence value and issues a brand-new identity to somebody
-- other people have been talking to under the old one.
--
-- THE FIX
--
-- Derive the handle from the user id, in the database, using the same FNV-1a
-- triple-hash the client already uses. Then:
--
--   * The fallback and the stored value are the same string, so the swap is
--     genuinely invisible rather than merely similarly-shaped.
--   * A handle is a function of the user id, so it survives the row. Recreate a
--     profile and the same person gets the same name back.
--   * Nothing has to be fetched before the right name can be shown. The client
--     computes it locally and the database agrees.
--
-- WHAT ABOUT COLLISIONS
--
-- A hash into 30 x 28 x 9000 = 7,560,000 names collides by the birthday bound
-- well before the space is full — around a thousand users there is a real chance
-- of one pair. So the deterministic name is an *attempt*, not a guarantee: the
-- unique index still decides, and a loser falls back to the sequence exactly as
-- before. That keeps "no two users share a handle" a fact while making "your
-- handle is yours" true for all but a handful of users, who get a stable stored
-- one anyway.
--
-- Existing handles are left alone. They are what other people have already seen,
-- and renaming everybody to fix the derivation would be the same bug pointed the
-- other way.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. FNV-1a, mirroring lib/anonymousIdentity.ts
--
-- `hash * 16777619` is taken mod 2^32 to reproduce JavaScript's `Math.imul`,
-- which keeps the low 32 bits. `#` is Postgres's integer XOR. Every character of
-- a UUID is ASCII, so `ascii()` and `charCodeAt` agree on all inputs this is
-- ever called with.
-- ---------------------------------------------------------------------------

create or replace function public.whisper_fnv1a(input text)
returns bigint
language plpgsql
immutable
strict
as $$
declare
  value bigint := 2166136261;   -- 0x811c9dc5
  index int;
begin
  for index in 1..length(input) loop
    value := value # ascii(substr(input, index, 1));
    value := (value * 16777619) % 4294967296;
  end loop;
  return value;
end $$;

comment on function public.whisper_fnv1a(text) is
  'FNV-1a 32-bit, matching hashUserId() in lib/anonymousIdentity.ts. Keep the two in step.';


-- ---------------------------------------------------------------------------
-- 2. User id -> handle
--
-- Three independent digests rather than three slices of one, for the reason the
-- client file gives: slicing ties the adjective, the noun and the number
-- together, so two ids agreeing in the low bits produce names that rhyme.
--
-- The word lists are the same lists in the same order as
-- `whisper_anon_name_for` and `lib/anonymousIdentity.ts`. All three must match.
-- ---------------------------------------------------------------------------

create or replace function public.whisper_anon_name_from_id(user_id uuid)
returns text
language plpgsql
immutable
strict
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
  seed text := user_id::text;
begin
  return adjectives[1 + (public.whisper_fnv1a(seed) % 30)::int]
      || nouns[1 + (public.whisper_fnv1a(seed || '::noun') % 28)::int]
      || '.'
      || (1000 + (public.whisper_fnv1a(seed || '::number') % 9000))::int;
end $$;

comment on function public.whisper_anon_name_from_id(uuid) is
  'Derives a handle from a user id. Byte-identical to anonymousDisplayName() in lib/anonymousIdentity.ts, so the client fallback and the stored handle are the same string.';


-- ---------------------------------------------------------------------------
-- 3. Assignment
--
-- Deterministic first; sequence only when the deterministic name is genuinely
-- taken by somebody else. `is distinct from new.id` matters: without it, a row
-- being re-inserted with its own id would see its own handle as a collision and
-- rename itself, which is the exact behaviour this migration exists to stop.
-- ---------------------------------------------------------------------------

create or replace function public.whisper_assign_anon_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text;
  n bigint;
begin
  -- Already has one. Never reassigned: the handle is what other people have seen.
  if new.anon_name is not null then
    return new;
  end if;

  candidate := public.whisper_anon_name_from_id(new.id);

  if not exists (
    select 1 from public.profiles
    where anon_name = candidate
      and id is distinct from new.id
  ) then
    new.anon_name := candidate;
    return new;
  end if;

  -- Birthday collision with a different user. Fall back to the sequence, which is
  -- atomic and injective across each block of 7,560,000 values.
  n := nextval('public.anon_name_serial');
  candidate := public.whisper_anon_name_for(n);

  if exists (
    select 1 from public.profiles
    where anon_name = candidate
      and id is distinct from new.id
  ) then
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
-- 4. Rows that never got one
--
-- Only NULLs. A profile that already holds a handle keeps it, sequence-derived or
-- not — see the header. Ordered by id so a partial run is resumable, and each row
-- is attempted individually so one collision cannot abort the batch.
-- ---------------------------------------------------------------------------

do $$
declare
  row_id uuid;
  candidate text;
  n bigint;
begin
  for row_id in
    select id from public.profiles where anon_name is null order by id
  loop
    candidate := public.whisper_anon_name_from_id(row_id);

    if exists (select 1 from public.profiles where anon_name = candidate) then
      n := nextval('public.anon_name_serial');
      candidate := public.whisper_anon_name_for(n);
      if exists (select 1 from public.profiles where anon_name = candidate) then
        candidate := split_part(candidate, '.', 1) || '.' || n;
      end if;
    end if;

    update public.profiles set anon_name = candidate where id = row_id;
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 5. A profile for every account, so the handle exists before /setup runs
--
-- The row is first written at /setup, when a username is chosen. A Google sign-in
-- reaches the app before that, so there is a window with an authenticated user and
-- no profile — the window in which the client showed the fallback and the eventual
-- insert minted something else. Sections 1-4 already make those two agree, so this
-- is not load-bearing for the reported bug; it closes the window outright and makes
-- `anon_name` queryable for anyone who can be messaged.
--
-- WHY THE EXCEPTION HANDLER IS NOT OPTIONAL
--
-- `public.profiles` is not created by any migration in this repository — it
-- predates them — so its NOT NULL constraints cannot be verified from the tree. If
-- some column other than `id` is NOT NULL without a default, an id-only insert
-- raises, and because this fires AFTER INSERT on `auth.users`, an unhandled raise
-- would abort the transaction that creates the account. That would turn a cosmetic
-- improvement into "nobody can sign up".
--
-- So the insert is attempted and any failure is swallowed with a warning. The
-- profile then gets created at /setup exactly as it does today, and the handle is
-- still correct because the trigger in section 3 derives it from the id. Failing
-- open is right here: the upside is a slightly earlier row, and the downside of
-- failing closed is a dead signup flow.
-- ---------------------------------------------------------------------------

create or replace function public.whisper_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.profiles (id) values (new.id)
    on conflict (id) do nothing;
  exception when others then
    -- A required column we cannot see from here. /setup will create the row.
    raise warning 'whisper_profile_for_new_user: skipped profile for % (%)', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists whisper_create_profile_on_signup on auth.users;
create trigger whisper_create_profile_on_signup
  after insert on auth.users
  for each row execute function public.whisper_profile_for_new_user();

-- Backfill accounts that predate the trigger. Guarded for the same reason: on a
-- schema where an id-only insert cannot succeed, this is a no-op rather than a
-- migration that refuses to apply.
do $$
begin
  insert into public.profiles (id)
  select u.id
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null
  on conflict (id) do nothing;
exception when others then
  raise warning 'profile backfill skipped: %', sqlerrm;
end $$;
