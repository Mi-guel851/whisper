-- ===========================================================================
-- Admin coin grants
--
-- /admin/grant-coins has shipped for a while and has never worked: both of the
-- objects it reaches for are missing from this folder.
--
--   1. It gates on `profiles.is_admin`, a column no migration creates. The
--      select returns a row without that key, `!profile?.is_admin` is therefore
--      truthy for everyone, and `init()` redirects to /dashboard before the
--      page paints. That is the whole of "the page is inactive".
--   2. Past that gate it calls `rpc("admin_grant_coins")`, which has no
--      definition either, so it would fail with 42883.
--
-- This migration adds both, plus the guard the column requires to be safe.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The flag
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Partial, because this is read to answer "is this one person an admin" and the
-- true set is a handful of rows out of the whole table.
create index if not exists profiles_is_admin_idx
  on public.profiles (id) where is_admin;

-- ---------------------------------------------------------------------------
-- 2. Stop the flag being self-serve
--
-- `profiles` is not defined in this folder — it was created against the live
-- database — so its RLS policies cannot be read here. The overwhelmingly common
-- shape is `update ... using (auth.uid() = id)`, which authorises the *row* and
-- says nothing about the *columns*. Under that policy, adding `is_admin` would
-- hand every authenticated user a switch: PATCH your own profile row, set
-- is_admin true, then call the function below for as many coins as you like.
--
-- Postgres has no per-column RLS, so the check goes in a trigger.
--
-- `auth.uid()` is the discriminator. It carries the user id when a statement
-- arrives through a client JWT (PostgREST, supabase-js) and is null under the
-- service role and in the SQL editor. So: refuse the change when it came from a
-- client, allow it from the dashboard or a server route holding the service
-- role key. That is the same test `ensure_coin_wallet` already uses to refuse
-- cross-user wallet provisioning, kept deliberately consistent.
--
-- Admins are locked out too, which is intended. Nothing reachable from the app
-- promotes an account; that is a deliberate act taken with the service role.
-- ---------------------------------------------------------------------------

create or replace function public.guard_profile_is_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Coerced, not raised. Signup inserts this row, and a failed insert there
    -- breaks account creation; silently refusing the elevation does not.
    if auth.uid() is not null and coalesce(new.is_admin, false) then
      new.is_admin := false;
    end if;
    return new;
  end if;

  if new.is_admin is distinct from old.is_admin and auth.uid() is not null then
    raise exception 'is_admin cannot be changed from a client session'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists guard_profile_is_admin on public.profiles;

create trigger guard_profile_is_admin
  before insert or update on public.profiles
  for each row execute function public.guard_profile_is_admin();

-- ---------------------------------------------------------------------------
-- 3. Ledger type
--
-- A grant is not a purchase. Filing it as one would misreport revenue on the
-- store page and make an audit of who was given what impossible to separate
-- from who paid.
--
-- The allowed set is derived from the values already in the table rather than
-- hard-coded, and added NOT VALID before being validated separately. Both
-- choices are carried over verbatim from 202608110001, which broke the first
-- time precisely because it hard-coded the list and the live table held a type
-- written by a path never checked into this folder.
-- ---------------------------------------------------------------------------

do $$
declare
  allowed text[];
  literals text;
begin
  select coalesce(array_agg(distinct transaction_type), '{}'::text[])
    into allowed
  from public.coin_transactions
  where transaction_type is not null;

  select string_agg(quote_literal(v), ', ' order by v) into literals
  from (
    select distinct unnest(
      allowed || array[
        'purchase', 'spend', 'refund', 'transfer_in', 'transfer_out', 'admin_grant'
      ]
    ) as v
  ) s;

  alter table public.coin_transactions
    drop constraint if exists coin_transactions_type_check;

  execute format(
    'alter table public.coin_transactions add constraint coin_transactions_type_check
       check (transaction_type in (%s)) not valid', literals);

  execute 'alter table public.coin_transactions validate constraint coin_transactions_type_check';

  alter table public.coin_transactions
    drop constraint if exists coin_transactions_transaction_type_check;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The grant
--
-- Signature is fixed by the existing call site in app/admin/grant-coins/page.tsx
-- and must not drift from it:
--
--   rpc("admin_grant_coins", { target_username, coin_amount, grant_note })
--
-- and the page renders the return value as "New balance: ${data}", so this
-- returns the recipient's balance after the credit.
-- ---------------------------------------------------------------------------

create or replace function public.admin_grant_coins(
  target_username text,
  coin_amount integer,
  grant_note text default 'Premium Grant'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_is_admin boolean;
  recipient uuid;
  clean_username text;
  new_balance integer;
begin
  -- security definer means this body runs as the owner with RLS bypassed, so
  -- every check below is the only thing standing between a caller and the
  -- balance column. None of them may be skipped.

  if caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select p.is_admin into caller_is_admin
  from public.profiles p
  where p.id = caller;

  if not coalesce(caller_is_admin, false) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if coin_amount is null or coin_amount <= 0 then
    raise exception 'Grant amount must be a positive number' using errcode = '22023';
  end if;

  -- A ceiling on a single grant. Not a policy about generosity — a bound on the
  -- damage one fat-fingered zero or one stolen admin session can do in one call.
  -- Larger amounts are still possible, they just have to be deliberate.
  if coin_amount > 1000000 then
    raise exception 'Grant amount exceeds the single-grant limit of 1,000,000 coins'
      using errcode = '22023';
  end if;

  clean_username := lower(btrim(coalesce(target_username, '')));

  if clean_username = '' then
    raise exception 'Username is required' using errcode = '22023';
  end if;

  -- Matched case-insensitively. The page lowercases before calling, but the
  -- stored username's case is not guaranteed, and a grant that silently finds
  -- nobody is worse than one that says so.
  select p.id into recipient
  from public.profiles p
  where lower(p.username) = clean_username
  limit 1;

  if recipient is null then
    raise exception 'No user found with username @%', clean_username
      using errcode = 'P0002';
  end if;

  -- Provisioned inline rather than through `ensure_coin_wallet`, which cannot
  -- do this: it returns early when `auth.uid()` differs from its argument
  -- (202608110001:145), so an admin calling it for someone else is a no-op and
  -- the UPDATE below would then match zero rows and report a null balance.
  --
  -- Only the balance row is created here. The wallet address is left to the
  -- recipient's next visit to a coin surface, which is the designed backfill
  -- path — minting one on their behalf from an admin session would attribute it
  -- to the wrong actor.
  insert into public.coins (user_id, balance)
  values (recipient, 0)
  on conflict (user_id) do nothing;

  -- Read-modify-write in one statement, so two grants landing together each
  -- take the row lock in turn and both are applied. Reading the balance into a
  -- variable first and writing back a computed total would lose one of them.
  update public.coins
     set balance = balance + coin_amount,
         updated_at = now()
   where user_id = recipient
  returning balance into new_balance;

  if new_balance is null then
    raise exception 'Could not credit @%', clean_username using errcode = 'XX000';
  end if;

  -- Same transaction as the credit, so a balance can never move without a
  -- ledger row explaining it. `granted_by` is the audit trail: it names the
  -- admin, which the description alone would not.
  insert into public.coin_transactions (user_id, transaction_type, amount, description, metadata)
  values (
    recipient,
    'admin_grant',
    coin_amount,
    coalesce(nullif(btrim(grant_note), ''), 'Premium Grant'),
    jsonb_build_object(
      'granted_by', caller,
      'granted_at', now(),
      'source', 'admin_grant_coins'
    )
  );

  return new_balance;
end $$;

-- PUBLIC gets EXECUTE on new functions by default, which would put this on the
-- anon key. The non-admin path raises rather than returning, so an anonymous
-- call could not grant anything — but it also has no business reaching the
-- function at all.
revoke execute on function public.admin_grant_coins(text, integer, text) from public;
revoke execute on function public.admin_grant_coins(text, integer, text) from anon;
grant execute on function public.admin_grant_coins(text, integer, text) to authenticated;

revoke execute on function public.guard_profile_is_admin() from public;
revoke execute on function public.guard_profile_is_admin() from anon;

-- ---------------------------------------------------------------------------
-- 5. After applying, promote yourself — from here, not from the app
--
--   update public.profiles set is_admin = true where username = 'your_username';
--
-- Run it in the SQL editor, where auth.uid() is null and the trigger above
-- stands aside. The app cannot do this, by design.
--
-- The page also posts to /api/admin/verify-pin, which compares against the
-- ADMIN_GRANT_PIN environment variable. Unset, that comparison fails closed and
-- the PIN step can never be passed.
-- ---------------------------------------------------------------------------
