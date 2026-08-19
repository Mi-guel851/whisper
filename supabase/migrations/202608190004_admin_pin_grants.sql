-- Move admin coin granting from a database flag to the PIN, safely.
--
--
-- WHY THIS EXISTS
--
-- 202608190002 gated granting on `profiles.is_admin`, which meant one manual SQL
-- statement per admin account before the page would open at all. The PIN already
-- lives in the environment, so the flag was a second source of truth that had to
-- be kept in sync by hand -- and when it was not, the page bounced to /dashboard
-- with no explanation.
--
-- The catch is that the PIN cannot guard the old design. `handlePinSubmit` posts
-- to /api/admin/verify-pin and, on success, flips a React boolean. That boolean
-- is a rendering decision in the browser; it protects nothing. The grant itself
-- ran as `supabase.rpc('admin_grant_coins')` from the page using the visitor's
-- own JWT, so the only real authorization was the `is_admin` check inside the
-- function. Delete that check to honour the PIN and any signed-in user could open
-- devtools, call the RPC directly, skip the PIN screen that never guarded it, and
-- mint themselves an unlimited balance in an app that sells coins for money.
--
-- So authorization moves to where the PIN can actually be checked: the server.
-- This function becomes callable *only* with the service role key, which exists
-- only in server environment variables and never reaches a browser. The PIN is
-- verified in app/api/admin/grant-coins/route.ts before that key is used. The
-- browser now has no path to a balance change at all, which is a stronger
-- position than 202608190002 left things in, not a weaker one.
--
-- `profiles.is_admin` is deliberately not referenced here, so this migration
-- stands on its own whether or not 202608190002 was ever applied, and admin
-- access no longer requires touching the database.
--
--
-- ONE-TIME SETUP
--
--   Set ADMIN_GRANT_PIN in the server environment (Vercel -> Settings ->
--   Environment Variables) and redeploy. The route refuses every PIN with a
--   configuration error when it is unset, rather than comparing against
--   undefined and reporting "Incorrect PIN" for a correct one.


-- ---------------------------------------------------------------------------
-- 1. Allow 'grant' in the ledger
--
-- Repeated from 202608190002 so this file is self-sufficient. Derived from the
-- values already present, exactly as 202608110001 does, so VALIDATE cannot fail
-- on a transaction_type written by a path that never made it into this folder.
-- Re-running is harmless: the set is rebuilt from the table each time.
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
-- 2. The grant, server-side only
--
-- Dropped rather than replaced because the signature changes: the acting user is
-- now passed in. Under the service role `auth.uid()` is null -- the key is a JWT
-- with a `role` claim and no `sub` -- so without this parameter the ledger would
-- lose track of who issued every grant.
--
-- `granted_by_user` is audit metadata, never authorization. It is supplied by the
-- caller, so treating it as proof of anything would let a caller name someone
-- else; the thing being trusted is possession of the service role key.
-- ---------------------------------------------------------------------------

drop function if exists public.admin_grant_coins(text, integer, text);

create or replace function public.admin_grant_coins(
  target_username text,
  coin_amount integer,
  grant_note text default 'Premium Grant',
  granted_by_user uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_username text := lower(btrim(coalesce(target_username, '')));
  matches integer;
  target uuid;
  new_balance integer;
begin
  -- The whole security model in one statement. A browser always carries a user
  -- JWT, so auth.uid() is non-null there and this refuses. It is null only for
  -- the service role, in a migration, and in the SQL editor -- all places that
  -- already require credentials a visitor does not have. Combined with the
  -- revokes in section 3, there is no route from a page to a balance change.
  if auth.uid() is not null then
    raise exception 'admin_grant_coins is server-side only; call /api/admin/grant-coins';
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
  -- provision anyone but the caller whenever there is a session. Here there is no
  -- session, so it would pass -- but it reads auth.uid() to decide whose wallet to
  -- make, which is null, so it still would not create this one. The
  -- wallet_address is left for that function to mint the next time the recipient
  -- opens their own wallet.
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
    jsonb_build_object(
      'granted_by', granted_by_user,
      'source', 'admin_pin_grant'
    )
  );

  return new_balance;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. Unreachable from any browser
--
-- EXECUTE is granted to PUBLIC by default. `authenticated` is revoked on purpose
-- and is the point of this migration: the function refuses a user session in its
-- first statement anyway, but an endpoint that can be called at all is an
-- endpoint worth probing, and PostgREST only exposes what is granted.
-- ---------------------------------------------------------------------------

revoke all on function public.admin_grant_coins(text, integer, text, uuid) from public;
revoke all on function public.admin_grant_coins(text, integer, text, uuid) from anon;
revoke all on function public.admin_grant_coins(text, integer, text, uuid) from authenticated;
grant execute on function public.admin_grant_coins(text, integer, text, uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 4. What this does not change
--
-- `profiles.is_admin` and its guard trigger from 202608190002 are left exactly as
-- they are. Nothing here needs the column, but app/admin/page.tsx still reads it
-- to gate the stats dashboard, and that page also calls an `admin_stats` RPC that
-- exists in no migration in this folder -- so /admin depends on objects that were
-- created by hand in the dashboard. Left alone deliberately: converting it to the
-- PIN is a separate change, and dropping the column would break it outright.
-- ---------------------------------------------------------------------------
