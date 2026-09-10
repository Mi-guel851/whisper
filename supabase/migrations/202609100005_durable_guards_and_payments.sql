-- ===========================================================================
-- Durable rate limiting, payment-credit idempotency, and recovery-session
-- revocation. Server-side counterparts of the Next.js changes shipped in the
-- same pass (lib/apiGuard.ts, /api/paystack/verify, /api/reset-with-phrase).
--
--   R1  The app's abuse counters live in ONE serverless instance's memory
--       (documented as best-effort in lib/apiGuard.ts). Vercel scales the app
--       across instances, so every budget below is only a floor until the
--       counters live where the data does. A fixed-window counter in Postgres,
--       claimed with one atomic INSERT ... ON CONFLICT, is that move: two
--       warm instances, ten, or a cold start mid-attack all share one budget.
--       Applied to the routes that actually matter: recovery, admin auth,
--       payments, posting, media viewing, and TURN minting.
--   R2  `credit_verified_payment` was created outside this repo's migrations;
--       /api/paystack/verify calls it, but the repo could neither show nor
--       test its replay behavior (flagged "must be checked" in the 2026-09-10
--       review). This is the canonical, repo-owned definition: service-role
--       only, an advisory lock on the reference, an idempotent skip when the
--       reference was already credited (returning the current balance rather
--       than erroring, so a double-tapped Paystack callback stays a no-op),
--       and a guarded credit so a missing wallet cannot half-apply. The
--       partial unique index on coin_transactions(reference) for 'purchase'
--       rows (202609070001 S7b) remains the last line; this function is the
--       first one.
--   R3  Password reset by recovery phrase must end the OLD sessions. GoTrue's
--       invalidation on admin password updates varies by version, so the
--       route now explicitly revokes: deletes the user's auth.sessions /
--       refresh-token rows (the same mechanism the dashboard's "sign out"
--       uses). Access tokens already issued remain valid until their ~1h
--       expiry — that is a platform property, stated here rather than hidden.
--
-- Nothing here drops data. Re-runnable.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- R1. Durable fixed-window rate limiter.
-- ---------------------------------------------------------------------------

create table if not exists public.rate_limit_windows (
  bucket       text   not null,
  identity     text   not null,
  window_start bigint not null,   -- epoch seconds, floored to the window
  hits         integer not null,
  primary key (bucket, identity, window_start)
);

comment on table public.rate_limit_windows is
  'Durable abuse counters shared by every API instance. Counters only: no query text, no identifiers beyond the bucket key the route chooses.';

-- Nobody touches the table except the definer function below.
alter table public.rate_limit_windows enable row level security;
revoke all on table public.rate_limit_windows from public, anon, authenticated;
grant select, insert, update, delete on table public.rate_limit_windows to service_role;

create or replace function public.rate_limit_consume(
  p_bucket text,
  p_identity text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now bigint := floor(extract(epoch from clock_timestamp()))::bigint;
  v_window bigint := greatest(1, least(coalesce(p_window_seconds, 60), 86_400));
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 100_000));
  v_window_start bigint := (v_now / v_window) * v_window;
  v_hits integer;
begin
  -- Server-side only: the client roles have no reason to consume a bucket and
  -- a callable limiter is a self-service bypass.
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_bucket is null or length(btrim(p_bucket)) = 0 or length(p_bucket) > 64
     or p_identity is null or length(btrim(p_identity)) = 0 or length(p_identity) > 256
  then
    raise exception 'Invalid limiter arguments' using errcode = '22023';
  end if;

  insert into public.rate_limit_windows as rlw (bucket, identity, window_start, hits)
  values (p_bucket, p_identity, v_window_start, 1)
  on conflict (bucket, identity, window_start)
  do update set hits = rlw.hits + 1
  returning rlw.hits into v_hits;

  -- Opportunistic pruning, keyed to this row's own keys so it stays an
  -- index-prefix delete: only this (bucket, identity)'s expired windows.
  if v_hits % 50 = 0 then
    delete from public.rate_limit_windows
    where bucket = p_bucket and identity = p_identity
      and window_start < v_window_start;
  end if;

  if v_hits <= v_limit then
    return jsonb_build_object('allowed', true, 'hits', v_hits);
  end if;

  return jsonb_build_object(
    'allowed', false,
    'hits', v_hits,
    'retry_after_seconds', greatest(1, (v_window_start + v_window - v_now)::int)
  );
end;
$$;

revoke all on function public.rate_limit_consume(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.rate_limit_consume(text, text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- R2. The canonical, hardened payment-credit function.
-- ---------------------------------------------------------------------------

-- Same signature the route calls today
-- (target_user, payment_reference, currency_code, amount_minor_units,
--  coin_amount), so deploying this is a replacement, not a rewire.
create or replace function public.credit_verified_payment(
  target_user uuid,
  payment_reference text,
  currency_code text,
  amount_minor_units bigint,
  coin_amount integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
  v_amount bigint := coalesce(amount_minor_units, 0);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if target_user is null then
    raise exception 'target_user required' using errcode = '22023';
  end if;
  if payment_reference is null
     or payment_reference !~ '^[a-zA-Z0-9_-]{1,200}$' then
    raise exception 'Invalid payment reference' using errcode = '22023';
  end if;
  if coin_amount is null or coin_amount <= 0 or coin_amount > 1000000 then
    raise exception 'Invalid coin amount' using errcode = '22023';
  end if;
  if v_amount <= 0 or v_amount > 1000000000000 then
    raise exception 'Invalid amount' using errcode = '22023';
  end if;

  /* Serialize on the reference before checking, so two simultaneous
     verifications of one Paystack reference queue instead of both passing the
     "already credited?" test and both crediting. Transaction-scoped lock:
     released at commit, when the ledger row becomes visible. */
  perform pg_advisory_xact_lock(hashtextextended(payment_reference, 0));

  -- Replay guard: the reference credits at most one purchase row, ever.
  -- A replay returns the CURRENT balance unchanged — the route can answer the
  -- second callback with the same success the first one got, instead of
  -- double-crediting or surfacing a scary error for a harmless double-tap.
  if exists (
    select 1 from public.coin_transactions
    where reference = payment_reference
      and transaction_type = 'purchase'
  ) then
    select balance into new_balance from public.coins where user_id = target_user;
    return coalesce(new_balance, 0);
  end if;

  perform public.ensure_coin_wallet(target_user);

  -- Guarded credit: `returning` is what proves the wallet exists and moved;
  -- a missing wallet raises instead of writing a ledger row nobody owns.
  update public.coins
     set balance = balance + coin_amount, updated_at = now()
   where user_id = target_user
  returning balance into new_balance;

  if new_balance is null then
    raise exception 'Wallet not found' using errcode = 'P0002';
  end if;

  insert into public.coin_transactions (user_id, transaction_type, amount, description, reference, metadata)
  values (
    target_user, 'purchase', coin_amount,
    left(coalesce(nullif(btrim(currency_code), ''), 'NGN') || ' coin purchase', 200),
    payment_reference,
    jsonb_build_object('amount_minor_units', v_amount, 'currency', upper(left(coalesce(currency_code, 'NGN'), 3)))
  );

  return new_balance;
end;
$$;

revoke all on function public.credit_verified_payment(uuid, text, text, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.credit_verified_payment(uuid, text, text, bigint, integer)
  to service_role;

-- The S7b uniqueness net, re-asserted here in case that section was skipped.
do $$
begin
  begin
    create unique index if not exists coin_transactions_purchase_reference_uniq
      on public.coin_transactions (reference)
      where reference is not null and transaction_type = 'purchase';
  exception when unique_violation then
    raise warning 'R2: duplicate purchase references already exist; unique index not created. Deduplicate coin_transactions and re-run this section.';
  end;
exception when others then
  raise notice 'R2: purchase reference index skipped (%).', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- R3. Recovery-driven session revocation.
-- ---------------------------------------------------------------------------

/*
  Deletes a user's auth sessions so every device must sign in again with the
  new password. Best-effort by design: on deployments where the role running
  this cannot write to the `auth` schema, it warns instead of failing a
  completed password reset — an unlocked account the attacker can no longer
  log into with the OLD password is still ahead of a 500 mid-recovery.

  Honest limits, repeated in the report:
    - already-issued access tokens are stateless JWTs and live until expiry
      (~1 hour) even after this runs;
    - GoTrue's own "invalidate sessions on password change" behavior, if the
      project has it, makes this a second belt.
*/
create or replace function public.revoke_user_sessions(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_user is null then
    raise exception 'Invalid user' using errcode = '22023';
  end if;

  begin
    if to_regclass('auth.refresh_tokens') is not null then
      delete from auth.refresh_tokens
      where session_id in (select id from auth.sessions where user_id = p_user);
    end if;
    if to_regclass('auth.sessions') is not null then
      delete from auth.sessions where user_id = p_user;
    end if;
    -- A revoked-JWT denylist is not on offer; `updated_at` at least lets any
    -- middleware comparing token age against the profile change behave.
    update auth.users set updated_at = now() where id = p_user;
  exception when insufficient_privilege then
    raise warning 'revoke_user_sessions: cannot write to the auth schema on this deployment; enable session invalidation on password change in the Supabase dashboard (Auth -> Security).';
    return false;
  end;

  return true;
end;
$$;

revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

commit;

-- ===========================================================================
-- After applying
--
--   * Deploy the paired Next.js changes (durable consume() + the reset route's
--     revocation call). Until then the SQL is dormant and the in-memory floor
--     still applies — safe either direction.
--   * Verify, as `anon` and `authenticated`:
--       select * from public.rate_limit_windows;                     -- denied
--       select public.rate_limit_consume('x','y',1,60);              -- denied
--       select public.credit_verified_payment(...);                  -- denied
--     and as service role (Postgres editor): all three succeed.
--   * Paystack test mode: one successful checkout credited once; a second
--     verify with the same reference returns the same balance with no extra
--     ledger row; a different account cannot claim it (ownership is enforced
--     in /api/paystack/verify before this function is ever reached).
-- ===========================================================================
