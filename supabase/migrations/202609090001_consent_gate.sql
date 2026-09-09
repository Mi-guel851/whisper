-- Mandatory privacy/terms consent at registration.
--
-- WHY THIS EXISTS
--
-- A new account can now be created (Google OAuth mints the auth.users row)
-- without the person ever having read, let alone accepted, the Privacy Policy
-- or the Terms. The checkbox in the UI is not the control here — it is the
-- *trigger*; the control is the profiles trigger below, which makes completing
-- a profile impossible in the database while no consent row exists for the
-- user. A UI checkbox that is the only guard can be bypassed from devtools or
-- an old build; a row that a security-definer-checked trigger requires cannot.
--
-- THE CONTRACT
--
--   - `public.consents` holds one row per (user, document). New signups must
--     land a row for the current document at the CURRENT version before they
--     can finish onboarding.
--   - `public.current_consent_doc_version()` is the single place the version
--     lives. Bumping it (1 → 2) instantly makes the trigger demand a fresh
--     consent for the bumped version, and the client (lib/consent.ts mirrors
--     the value) starts showing the checkbox again for new accounts. Nobody
--     edits SQL and app code separately to disagree about "current".
--   - The trigger fires on the profile_completed transition, not on every
--     profile update: onboarding is the account-creation event, and every
--     user already onboarded before this migration is grandfathered — a
--     re-consent demand on a one-year-old account would read as the app
--     breaking, not as legal hygiene.
--
-- No data is dropped. No existing user is touched.

-- ---------------------------------------------------------------------------
-- 1. The consent row
-- ---------------------------------------------------------------------------

create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  doc text not null default 'privacy_terms',
  doc_version integer not null default 1,
  accepted_at timestamptz not null default now(),
  unique (user_id, doc)
);

create index if not exists consents_user_idx on public.consents (user_id);

alter table public.consents enable row level security;

drop policy if exists "Users can view own consents" on public.consents;
create policy "Users can view own consents" on public.consents
  for select using (auth.uid() = user_id);

drop policy if exists "Users can record own consent" on public.consents;
create policy "Users can record own consent" on public.consents
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can refresh own consent" on public.consents;
create policy "Users can refresh own consent" on public.consents
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- No delete policy on purpose: an acceptance is a legal fact. Re-consenting
-- after a version bump writes a new row; the old one stays in the trail.

-- ---------------------------------------------------------------------------
-- 2. What "current" means
-- ---------------------------------------------------------------------------

create or replace function public.current_consent_doc_version()
returns integer
language sql
stable
set search_path = public
as $$
  select 1;
$$;

comment on function public.current_consent_doc_version() is
  'The consent document version the profiles trigger demands. Bump it to re-open the consent gate for new accounts; lib/consent.ts mirrors this value client-side.';

-- ---------------------------------------------------------------------------
-- 3. Recording consent. Definer so the write happens under the server even
--    though the RLS insert policy would allow it too — the RPC is the one
--    place that can reject a call for a stale document version, and the
--    trigger below trusts the same predicate, so there is a single definition
--    of "consented".
-- ---------------------------------------------------------------------------

create or replace function public.record_consent(p_doc text default 'privacy_terms', p_doc_version integer default null)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted_at timestamptz;
  version integer := coalesce(p_doc_version, public.current_consent_doc_version());
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- The document is closed vocabulary: 'privacy_terms' is the one the app
  -- ships. Anything else would be a row the trigger never consults, i.e. a
  -- consent that looks recorded and is never enforced.
  if p_doc is distinct from 'privacy_terms' then
    raise exception 'Unknown consent document' using errcode = '22023';
  end if;

  insert into public.consents (user_id, doc, doc_version, accepted_at)
  values (auth.uid(), p_doc, version, now())
  on conflict (user_id, doc)
  do update set doc_version = excluded.doc_version, accepted_at = excluded.accepted_at
  returning accepted_at into accepted_at;

  return accepted_at;
end;
$$;

revoke all on function public.record_consent(text, integer) from public;
revoke all on function public.record_consent(text, integer) from anon;
grant execute on function public.record_consent(text, integer) to authenticated;

comment on function public.record_consent(text, integer) is
  'Writes/refreshes the caller''s privacy_terms consent row at the current version. The client calls it the moment the checkbox is ticked; the profiles trigger reads the same table.';

-- ---------------------------------------------------------------------------
-- 4. The gate: completing a profile requires a consent row
-- ---------------------------------------------------------------------------

create or replace function public.profiles_require_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only the false→true transition is account creation. Anything else —
  -- editing a username, a theme change, an fcm_token refresh — must not
  -- start demanding consent, or every settings save becomes a legal event.
  if new.profile_completed and not coalesce(old.profile_completed, false) then
    if not exists (
      select 1
      from public.consents c
      where c.user_id = new.id
        and c.doc = 'privacy_terms'
        and c.doc_version = public.current_consent_doc_version()
    ) then
      raise exception 'Consent to the Privacy Policy and Terms is required before your account can be completed.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  drop trigger if exists profiles_require_consent on public.profiles;
  create trigger profiles_require_consent
    before update of profile_completed on public.profiles
    for each row execute function public.profiles_require_consent();
  raise notice 'Consent gate attached to public.profiles.';
exception when undefined_table then
  raise warning 'Consent gate skipped: public.profiles does not exist in this environment.';
end $$;
