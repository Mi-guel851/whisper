-- Admin coin grants: the schema /admin/grant-coins was written against.
--
-- WHY THAT PAGE REDIRECTS TO THE DASHBOARD
--
-- app/admin/grant-coins/page.tsx gates itself on `profiles.is_admin` and grants
-- through an RPC called `admin_grant_coins`. Neither exists. The column was
-- never added and the function was never written, so the guard's select comes
-- back with an error, `profile` is null, `!profile?.is_admin` is true, and the
-- page bounces to /dashboard before rendering. Nothing is broken in the page --
-- it is asking the database for something that was never built.
--
-- app/api/admin/verify-pin/route.ts reads the same column with the service role,
-- so the PIN gate would have failed for the same reason.
--
-- AFTER APPLYING THIS, TWO MANUAL STEPS ARE STILL REQUIRED
--
--   1. Grant yourself the flag. This cannot be done from the app -- see the
--      trigger in section 2 -- so run it here in the SQL editor:
--
--        update public.profiles set is_admin = true where username = 'your_username';
--
--   2. Set ADMIN_GRANT_PIN in the environment (Vercel project settings, and
--      .env.local for dev). Without it the PIN gate rejects every attempt,
--      because `pin !== process.env.ADMIN_GRANT_PIN` is true for undefined.

-- ---------------------------------------------------------------------------
-- 1. The flag
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Nobody can promote themselves
--
-- `profiles` is client-writable -- that is how /profile saves a bio -- and RLS
-- there grants UPDATE on the whole row, not on a column list. Without this
-- trigger any signed-in user could send `{is_admin: true}` for their own id
-- from the browser with the anon key and then call admin_grant_coins for an
-- unlimited balance. The PIN does not help: it gates the page's UI, but the RPC
-- is reachable directly from any client.
--
-- auth.uid() is null for the service role, for migrations, and in the SQL
-- editor. So the flag stays settable exactly where a human with database access
-- is already in control, and is refused everywhere a session could reach it.
-- ---------------------------------------------------------------------------

create or replace function public.guard_profile_is_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Coerced rather than raised: signup inserts the profile row, and a hard
    -- error there would break account creation over a field no client sends.
    new.is_admin := false;
    return new;
  end if;

  if new.is_admin is distinct from old.is_admin then
    raise exception 'is_admin cannot be changed from a client session';
  end if;

  return new;
end;
$$;

-- Compared by value rather than declared as `update of is_admin`, because that
-- form fires whenever the column appears in the statement -- and PostgREST
-- sends every key in the request body, changed or not.
drop trigger if exists guard_profile_is_admin_trigger on public.profiles;
create trigger guard_profile_is_admin_trigger
  before insert or update on public.profiles
  for each row execute function public.guard_profile_is_admin();

-- ---------------------------------------------------------------------------
-- 3. Ledger type for a grant
--
-- Derived from the values already present, exactly as 202608110001 does, so
-- VALIDATE cannot fail on a transaction_type written by a path that never made
-- it into this folder, and no existing type is suddenly rejected.
-- ---------------------------------------------------------------------------

do $$
declare
  literals text;
begin
  select string_agg(quote_literal(v), ', ' order by v) into literals
  from (
    select distinct unnest(
      coalesce(
        (select array_agg(distinct transaction_type)
           from public.coin_transactions
          where transaction_type is not null),
        '{}'::text[]
      )
      || array['purchase', 'spend', 'refund', 'transfer_in', 'transfer_out', 'grant']
    ) as v
  ) s;

  alter table public.coin_transactions
    drop constraint if exists coin_transactions_type_check;

  execute format(
    'alter table public.coin_transactions add constraint coin_transactions_type_check
       check (transaction_type in (%s)) not valid', literals);

  execute 'alter table public.coin_transactions validate constraint coin_transactions_type_check';
end $$;

-- ---------------------------------------------------------------------------
-- 4. The grant
--
-- SECURITY DEFINER because it credits a wallet the caller does not own, which
-- RLS correctly forbids. The admin check is therefore the only thing standing
-- between a signed-in user and an arbitrary balance, and it runs first.
--
-- Argument names are part of the contract: PostgREST matches RPC parameters by
-- name, and page.tsx sends target_username / coin_amount / grant_note.
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
  clean_username text := lower(btrim(coalesce(target_username, '')));
  matches integer;
  target uuid;
  new_balance integer;
begin
  if caller is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles where id = caller and is_admin
  ) then
    raise exception 'Not authorized';
  end if;

  if clean_username = '' then
    raise exception 'Enter a username.';
  end if;

  if coin_amount is null or coin_amount <= 0 then
    raise exception 'Enter a coin amount greater than zero.';
  end if;

  -- Guards against a mistyped amount rather than against abuse: `balance` is a
  -- 32-bit integer, and a slipped keypress could otherwise push a wallet close
  -- enough to the type's ceiling that a later purchase overflows.
  if coin_amount > 1000000 then
    raise exception 'A single grant is capped at 1,000,000 coins.';
  end if;

  -- Counted before resolving so a case-only duplicate cannot silently credit
  -- whichever row the planner happened to return first.
  select count(*), min(id) into matches, target
  from public.profiles
  where lower(username) = clean_username;

  if matches = 0 then
    raise exception 'No user with the username @%.', clean_username;
  end if;

  if matches > 1 then
    raise exception 'More than one account matches @%. Resolve it in the dashboard.', clean_username;
  end if;

  -- Not ensure_coin_wallet(): since 202608110001 that function refuses to
  -- provision anyone but the caller whenever there is a session, so from here it
  -- would return without doing anything and the update below would match no
  -- row. The wallet_address is left for that function to mint the next time the
  -- recipient opens their own wallet, where the guard passes.
  insert into public.coins (user_id, balance)
  values (target, 0)
  on conflict (user_id) do nothing;

  update public.coins
     set balance = balance + coin_amount,
         updated_at = now()
   where user_id = target
  returning balance into new_balance;

  insert into public.coin_transactions
    (user_id, transaction_type, amount, description, metadata)
  values (
    target,
    'grant',
    coin_amount,
    coalesce(nullif(btrim(grant_note), ''), 'Premium Grant'),
    jsonb_build_object('granted_by', caller, 'source', 'admin_grant_coins')
  );

  return new_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Reachable only by a signed-in session
--
-- EXECUTE is granted to PUBLIC by default, which would expose this to the anon
-- role. The function would still refuse -- auth.uid() is null there -- but an
-- endpoint that can be called at all is an endpoint worth probing.
-- ---------------------------------------------------------------------------

revoke all on function public.admin_grant_coins(text, integer, text) from public;
revoke all on function public.admin_grant_coins(text, integer, text) from anon;
grant execute on function public.admin_grant_coins(text, integer, text) to authenticated;

revoke all on function public.guard_profile_is_admin() from public;
revoke all on function public.guard_profile_is_admin() from anon;
