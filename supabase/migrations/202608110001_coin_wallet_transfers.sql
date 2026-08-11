-- ---------------------------------------------------------------------------
-- Whisper Coin wallet addresses + peer-to-peer coin transfers
--
-- Builds on 202607080001_whisper_coins.sql. Nothing here resets or rewrites an
-- existing balance: `coins.balance` is never touched by this migration, only
-- the new `wallet_address` column is backfilled.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Wallet address column
-- ---------------------------------------------------------------------------

alter table public.coins add column if not exists wallet_address text;

-- Uniqueness is enforced by the database, not by the generator, so two
-- concurrent signups can never end up sharing an address even if the random
-- draw collides — the loser gets a unique violation and redraws.
create unique index if not exists coins_wallet_address_key
  on public.coins (wallet_address)
  where wallet_address is not null;

-- ---------------------------------------------------------------------------
-- 2. Address generation + normalisation
--
-- Format: WHISPERS-XXXX-XXXX-XXXX-XXXX
-- The 16 payload characters are Crockford base32 (no I, L, O, U — the
-- characters people misread or that form unintended words), giving 80 bits of
-- entropy per address. No part of the address is derived from the user: it is
-- pure CSPRNG output, so it leaks nothing about the account behind it.
-- ---------------------------------------------------------------------------

create or replace function public.generate_wallet_address()
returns text
language plpgsql
volatile
-- `extensions` is on the path because Supabase installs pgcrypto there;
-- `public` covers self-hosted installs that put it in public instead.
set search_path = public, extensions
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  raw bytea;
  payload text := '';
  i integer;
begin
  raw := gen_random_bytes(16);
  -- 256 is an exact multiple of 32, so `% 32` introduces no modulo bias.
  for i in 0..15 loop
    payload := payload || substr(alphabet, (get_byte(raw, i) % 32) + 1, 1);
  end loop;

  return 'WHISPERS-'
    || substr(payload, 1, 4) || '-'
    || substr(payload, 5, 4) || '-'
    || substr(payload, 9, 4) || '-'
    || substr(payload, 13, 4);
end;
$$;

-- Accepts what a human might realistically paste — lowercase, missing dashes,
-- stray whitespace, or the O/0 and I/1 confusions Crockford base32 is designed
-- to absorb — and returns the canonical form, or null if it isn't a valid
-- Whispers address at all.
create or replace function public.normalize_wallet_address(input text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  cleaned text;
  payload text;
begin
  if input is null then return null; end if;

  cleaned := upper(regexp_replace(input, '[^a-zA-Z0-9]', '', 'g'));

  if cleaned like 'WHISPERS%' then
    payload := substr(cleaned, 9);
  else
    -- Tolerate a bare payload so a user who copied only the code half still
    -- gets a working paste rather than a format error.
    payload := cleaned;
  end if;

  -- Crockford aliases. Applied only to the payload, never to the "WHISPERS"
  -- prefix (which legitimately contains I and S).
  payload := translate(payload, 'ILO', '110');

  if payload !~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$' then
    return null;
  end if;

  return 'WHISPERS-'
    || substr(payload, 1, 4) || '-'
    || substr(payload, 5, 4) || '-'
    || substr(payload, 9, 4) || '-'
    || substr(payload, 13, 4);
end;
$$;

-- Shortened form for receipts and history rows: WHISPERS-A1B2…X9Y8
create or replace function public.mask_wallet_address(address text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when address is null then null
    when length(address) <= 18 then address
    else substr(address, 1, 13) || '…' || right(address, 4)
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Wallet provisioning
--
-- Replaces the original `ensure_coin_wallet`, which only created the balance
-- row. It now also assigns an address when one is missing, which is what
-- backfills every pre-existing user: their next visit to any coin surface
-- provisions the address without touching `balance`.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_coin_wallet(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt integer := 0;
begin
  if target_user is null then return; end if;

  -- A SECURITY DEFINER function that takes an arbitrary uuid is an oracle:
  -- calling it for someone else's id would provision their wallet, and whether
  -- it succeeded or hit a foreign-key error would confirm that the id belongs
  -- to a real user. Callers may only provision themselves.
  --
  -- auth.uid() is null inside migrations, the service role, and the other
  -- SECURITY DEFINER functions that call this — all of which must still work,
  -- so the guard only applies when there is a session to check against.
  if auth.uid() is not null and target_user is distinct from auth.uid() then
    return;
  end if;

  insert into public.coins (user_id, balance) values (target_user, 0)
  on conflict (user_id) do nothing;

  if exists (
    select 1 from public.coins
    where user_id = target_user and wallet_address is not null
  ) then
    return;
  end if;

  -- Retry on the (astronomically unlikely) collision the unique index catches.
  loop
    attempt := attempt + 1;
    begin
      update public.coins
        set wallet_address = public.generate_wallet_address(), updated_at = now()
      where user_id = target_user and wallet_address is null;
      return;
    exception when unique_violation then
      if attempt >= 5 then raise; end if;
    end;
  end loop;
end;
$$;

revoke execute on function public.ensure_coin_wallet(uuid) from public;
grant execute on function public.ensure_coin_wallet(uuid) to authenticated;
-- Server routes using the service key must keep working; `anon` has no reason
-- to provision a wallet, so it stays revoked.
grant execute on function public.ensure_coin_wallet(uuid) to service_role;

-- Backfill: give every existing wallet an address. Balances are untouched.
do $$
declare
  r record;
begin
  for r in select user_id from public.coins where wallet_address is null loop
    perform public.ensure_coin_wallet(r.user_id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Transfer ledger
-- ---------------------------------------------------------------------------

create table if not exists public.coin_transfers (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  sender_id uuid references auth.users(id) on delete set null,
  -- Null when the address didn't resolve to an account (a failed attempt).
  recipient_id uuid references auth.users(id) on delete set null,
  sender_address text,
  recipient_address text,
  amount integer not null check (amount >= 0),
  fee integer not null default 0 check (fee >= 0),
  status text not null check (status in ('completed', 'failed')),
  -- A settled transfer always moved a positive amount; a failed attempt is
  -- allowed to record 0, which is what the user actually tried to send.
  constraint coin_transfers_completed_amount_positive
    check (status <> 'completed' or amount > 0),
  failure_reason text,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists coin_transfers_sender_idx
  on public.coin_transfers (sender_id, created_at desc);
create index if not exists coin_transfers_recipient_idx
  on public.coin_transfers (recipient_id, created_at desc);

-- The duplicate-submission guard: a client that retries the same transfer
-- (double tap, flaky network, refresh mid-request) reuses its key and gets the
-- original receipt back instead of moving coins twice.
--
-- Only settled transfers claim a key — the failure paths park theirs in
-- `metadata` instead. A validation failure must not burn the key, or retrying
-- after fixing the address would replay the rejection forever.
create unique index if not exists coin_transfers_idempotency_key
  on public.coin_transfers (sender_id, idempotency_key)
  where idempotency_key is not null;

-- Deny by default. Receipts are served through
-- `get_transfer_receipt`, which strips user ids before returning — reading the
-- table directly would expose `sender_id`/`recipient_id` to the client.
alter table public.coin_transfers enable row level security;

-- ---------------------------------------------------------------------------
-- 5. Transaction-history plumbing
-- ---------------------------------------------------------------------------

-- Widen the type constraint for the two new ledger entries.
--
-- The allowed set is built from the values already in the table, unioned with
-- the five this codebase writes. Hard-coding the five is what broke the first
-- version of this migration: the live database contains a transaction_type
-- written by a path that was never checked into this folder, so VALIDATE failed
-- with 23514 and took the whole migration down. Deriving the set means
-- validation cannot fail and no legitimate existing type is suddenly rejected
-- on future inserts.
--
-- NOT VALID first, then VALIDATE, so the table is never held under ACCESS
-- EXCLUSIVE for a full verification scan.
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
      allowed || array['purchase', 'spend', 'refund', 'transfer_in', 'transfer_out']
    ) as v
  ) s;

  -- A previous failed run can leave this behind in the NOT VALID state, where
  -- re-adding it raises duplicate_object and re-validating raises 23514 again.
  alter table public.coin_transactions
    drop constraint if exists coin_transactions_type_check;

  execute format(
    'alter table public.coin_transactions add constraint coin_transactions_type_check
       check (transaction_type in (%s)) not valid', literals);

  execute 'alter table public.coin_transactions validate constraint coin_transactions_type_check';

  -- Dropped only once the replacement is in place, so there is no window where
  -- the column is unconstrained.
  alter table public.coin_transactions
    drop constraint if exists coin_transactions_transaction_type_check;
end $$;

-- Links the debit and the credit rows of one transfer.
alter table public.coin_transactions add column if not exists reference text;

-- Pagination on the store page reads (user_id, created_at desc, id desc).
create index if not exists coin_transactions_user_created_idx
  on public.coin_transactions (user_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- 6. The transfer itself
--
-- One function, one transaction. Either both balances move and both ledger
-- rows exist, or nothing happened.
--
-- Validation failures return a `failed` receipt rather than raising, so the
-- attempt is still recorded (a raise would roll back the very row recording
-- it). Genuine faults — not authenticated, wallet missing — still raise.
-- ---------------------------------------------------------------------------

create or replace function public.transfer_whisper_coins(
  recipient_address text,
  coin_amount integer,
  idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
-- Several parameters share a name with a column on coin_transfers. Resolving
-- an ambiguous reference to the column would silently compare a row value
-- against itself, so the directive above pins resolution to the parameter and
-- every column reference that needs the other meaning is qualified.
declare
  sender uuid := auth.uid();
  sender_wallet text;
  sender_balance integer;
  target_address text;
  target_user uuid;
  transfer_fee constant integer := 0; -- Whispers does not charge to transfer.
  new_reference text;
  new_balance integer;
  recipient_balance integer;
  existing public.coin_transfers;
  clean_key text;
begin
  if sender is null then
    raise exception 'Not authenticated';
  end if;

  clean_key := nullif(btrim(coalesce(idempotency_key, ''), E' \t\n\r'), '');

  -- An all-whitespace key is a client bug, not a request to skip the replay
  -- guard. Silently treating it as "no key" would hand back zero
  -- double-submit protection with nothing to notice.
  if idempotency_key is not null and clean_key is null then
    raise exception 'Invalid idempotency key';
  end if;

  if clean_key is not null then
    -- Serialize same-key requests before the replay check. Without this, two
    -- concurrent retries both miss each other's uncommitted row, both settle,
    -- and the loser dies on the unique index — which is precisely the
    -- double-submit this key exists to make invisible. The lock is
    -- transaction-scoped, so the loser waits here and then sees the committed
    -- original below.
    perform pg_advisory_xact_lock(
      hashtextextended(sender::text || ':' || clean_key, 0)
    );

    -- Replay of a request we already processed — hand back the original receipt.
    select * into existing from public.coin_transfers
    where sender_id = sender and coin_transfers.idempotency_key = clean_key;

    if found then
      select balance into new_balance from public.coins where user_id = sender;
      return jsonb_build_object(
        'status', existing.status,
        'reference', existing.reference,
        'amount', existing.amount,
        'fee', existing.fee,
        'sender_address', public.mask_wallet_address(existing.sender_address),
        'recipient_address', public.mask_wallet_address(existing.recipient_address),
        'created_at', existing.created_at,
        'balance', coalesce(new_balance, 0),
        'failure_reason', existing.failure_reason,
        'replayed', true
      );
    end if;
  end if;

  -- Provision before taking any ordered lock below. `ensure_coin_wallet` may
  -- UPDATE this user's `coins` row to assign an address, and that lock is held
  -- to end of transaction — doing it after the ordered acquisition would let a
  -- sender grab its own row out of order and deadlock with a crossing transfer.
  perform public.ensure_coin_wallet(sender);

  select wallet_address, balance into sender_wallet, sender_balance
  from public.coins where user_id = sender;

  -- 26 hex chars ≈ 104 bits. The earlier 16-char total left only 12 hex chars
  -- of entropy, which collides at a rate a `unique` reference column would
  -- surface as a failed transfer.
  new_reference := 'WSP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 26));

  target_address := public.normalize_wallet_address(recipient_address);

  -- --- Validation ---------------------------------------------------------
  -- Each branch records the failure and returns; none of them has debited
  -- anything at this point.

  if target_address is null then
    insert into public.coin_transfers (
      reference, sender_id, sender_address, recipient_address,
      amount, fee, status, failure_reason, idempotency_key, metadata
    ) values (
      new_reference, sender, sender_wallet, null,
      greatest(coalesce(coin_amount, 0), 0), transfer_fee, 'failed',
      'That is not a valid Whispers wallet address.', null, jsonb_build_object('idempotency_key', clean_key)
    );
    return jsonb_build_object(
      'status', 'failed', 'reference', new_reference,
      'amount', coalesce(coin_amount, 0), 'fee', transfer_fee,
      'sender_address', public.mask_wallet_address(sender_wallet),
      'recipient_address', null, 'created_at', now(),
      'balance', coalesce(sender_balance, 0),
      'failure_reason', 'That is not a valid Whispers wallet address.'
    );
  end if;

  if coin_amount is null or coin_amount <= 0 then
    insert into public.coin_transfers (
      reference, sender_id, sender_address, recipient_address,
      amount, fee, status, failure_reason, idempotency_key, metadata
    ) values (
      new_reference, sender, sender_wallet, target_address,
      greatest(coalesce(coin_amount, 0), 0), transfer_fee, 'failed',
      'Enter a whole number of coins greater than zero.', null, jsonb_build_object('idempotency_key', clean_key)
    );
    return jsonb_build_object(
      'status', 'failed', 'reference', new_reference,
      'amount', coalesce(coin_amount, 0), 'fee', transfer_fee,
      'sender_address', public.mask_wallet_address(sender_wallet),
      'recipient_address', public.mask_wallet_address(target_address),
      'created_at', now(), 'balance', coalesce(sender_balance, 0),
      'failure_reason', 'Enter a whole number of coins greater than zero.'
    );
  end if;

  if target_address = sender_wallet then
    insert into public.coin_transfers (
      reference, sender_id, recipient_id, sender_address, recipient_address,
      amount, fee, status, failure_reason, idempotency_key, metadata
    ) values (
      new_reference, sender, sender, sender_wallet, target_address,
      coin_amount, transfer_fee, 'failed',
      'You cannot send coins to your own wallet.', null, jsonb_build_object('idempotency_key', clean_key)
    );
    return jsonb_build_object(
      'status', 'failed', 'reference', new_reference,
      'amount', coin_amount, 'fee', transfer_fee,
      'sender_address', public.mask_wallet_address(sender_wallet),
      'recipient_address', public.mask_wallet_address(target_address),
      'created_at', now(), 'balance', coalesce(sender_balance, 0),
      'failure_reason', 'You cannot send coins to your own wallet.'
    );
  end if;

  select user_id into target_user from public.coins
  where wallet_address = target_address;

  if target_user is null then
    insert into public.coin_transfers (
      reference, sender_id, sender_address, recipient_address,
      amount, fee, status, failure_reason, idempotency_key, metadata
    ) values (
      new_reference, sender, sender_wallet, target_address,
      coin_amount, transfer_fee, 'failed',
      'No Whispers wallet matches that address.', null, jsonb_build_object('idempotency_key', clean_key)
    );
    return jsonb_build_object(
      'status', 'failed', 'reference', new_reference,
      'amount', coin_amount, 'fee', transfer_fee,
      'sender_address', public.mask_wallet_address(sender_wallet),
      'recipient_address', public.mask_wallet_address(target_address),
      'created_at', now(), 'balance', coalesce(sender_balance, 0),
      'failure_reason', 'No Whispers wallet matches that address.'
    );
  end if;

  -- --- Settlement ---------------------------------------------------------

  -- Lock both wallet rows before reading the balance we are about to spend.
  -- Always in ascending user_id order: two people sending to each other at the
  -- same instant would otherwise each hold the row the other needs and
  -- deadlock. Holding the locks is also what makes the balance check
  -- authoritative — a concurrent transfer cannot slip between check and debit.
  --
  -- Two separate statements, deliberately. `... where user_id in (a, b) order
  -- by user_id for update` reads like it would do the same thing and does not:
  -- Postgres applies the locking clause *above* the sort, and for a two-row
  -- primary-key lookup it will typically use an index scan and drop the sort
  -- node entirely, leaving rows locked in scan order. Sequential statements are
  -- the only construction that guarantees the order.
  if sender < target_user then
    perform 1 from public.coins where user_id = sender for update;
    perform 1 from public.coins where user_id = target_user for update;
  else
    perform 1 from public.coins where user_id = target_user for update;
    perform 1 from public.coins where user_id = sender for update;
  end if;

  select balance into sender_balance from public.coins where user_id = sender;

  if coalesce(sender_balance, 0) < coin_amount + transfer_fee then
    insert into public.coin_transfers (
      reference, sender_id, recipient_id, sender_address, recipient_address,
      amount, fee, status, failure_reason, idempotency_key, metadata
    ) values (
      new_reference, sender, target_user, sender_wallet, target_address,
      coin_amount, transfer_fee, 'failed',
      'Not enough coins for this transfer.', null, jsonb_build_object('idempotency_key', clean_key)
    );
    return jsonb_build_object(
      'status', 'failed', 'reference', new_reference,
      'amount', coin_amount, 'fee', transfer_fee,
      'sender_address', public.mask_wallet_address(sender_wallet),
      'recipient_address', public.mask_wallet_address(target_address),
      'created_at', now(), 'balance', coalesce(sender_balance, 0),
      'failure_reason', 'Not enough coins for this transfer.'
    );
  end if;

  -- The guard on the WHERE is redundant under the lock, but it means the debit
  -- can never write a negative balance even if this function is later called
  -- from a path that skipped the locking above.
  --
  -- The fee is debited alongside the amount. It is 0 today; charging it here
  -- rather than only reporting it means a future non-zero fee can't be
  -- silently uncollected while the receipt claims otherwise.
  update public.coins
    set balance = balance - (coin_amount + transfer_fee), updated_at = now()
  where user_id = sender and balance >= coin_amount + transfer_fee
  returning balance into new_balance;

  if new_balance is null then
    raise exception 'Not enough coins for this transfer.';
  end if;

  -- Checked, not assumed. `target_user` was resolved before the lock, so the
  -- account can have been deleted in between — the cascade would drop this
  -- row and the credit would quietly match zero rows, debiting the sender
  -- without paying anyone.
  update public.coins
    set balance = balance + coin_amount, updated_at = now()
  where user_id = target_user
  returning balance into recipient_balance;

  if recipient_balance is null then
    raise exception 'Recipient wallet no longer exists.';
  end if;

  insert into public.coin_transfers (
    reference, sender_id, recipient_id, sender_address, recipient_address,
    amount, fee, status, idempotency_key
  ) values (
    new_reference, sender, target_user, sender_wallet, target_address,
    coin_amount, transfer_fee, 'completed', clean_key
  );

  -- Two ledger rows sharing one reference. Descriptions carry the masked
  -- counterparty address only — never a name, username, or user id.
  --
  -- The sender's row is the full debit, fee included, so that summing a user's
  -- coin_transactions always reproduces their balance. The fee breakdown lives
  -- in metadata rather than a third row, which would double-count.
  insert into public.coin_transactions (
    user_id, transaction_type, amount, description, reference, metadata
  ) values (
    sender, 'transfer_out', -(coin_amount + transfer_fee),
    'Sent to ' || public.mask_wallet_address(target_address),
    new_reference,
    jsonb_build_object(
      'counterparty_address', public.mask_wallet_address(target_address),
      'direction', 'out',
      'sent', coin_amount,
      'fee', transfer_fee
    )
  ), (
    target_user, 'transfer_in', coin_amount,
    'Received from ' || public.mask_wallet_address(sender_wallet),
    new_reference,
    jsonb_build_object(
      'counterparty_address', public.mask_wallet_address(sender_wallet),
      'direction', 'in'
    )
  );

  return jsonb_build_object(
    'status', 'completed',
    'reference', new_reference,
    'amount', coin_amount,
    'fee', transfer_fee,
    'sender_address', public.mask_wallet_address(sender_wallet),
    'recipient_address', public.mask_wallet_address(target_address),
    'created_at', now(),
    'balance', new_balance,
    'failure_reason', null
  );
end;
$$;

grant execute on function public.transfer_whisper_coins(text, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Receipt lookup
--
-- Lets the store page re-open the receipt for a transfer already in history.
-- Returns masked addresses and no user ids, and only to the two participants.
-- ---------------------------------------------------------------------------

create or replace function public.get_transfer_receipt(transfer_reference text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.coin_transfers;
  viewer uuid := auth.uid();
begin
  if viewer is null then raise exception 'Not authenticated'; end if;

  select * into t from public.coin_transfers where reference = transfer_reference;
  if not found then return null; end if;
  if t.sender_id is distinct from viewer and t.recipient_id is distinct from viewer then
    return null;
  end if;

  return jsonb_build_object(
    'status', t.status,
    'reference', t.reference,
    'amount', t.amount,
    'fee', t.fee,
    'sender_address', public.mask_wallet_address(t.sender_address),
    'recipient_address', public.mask_wallet_address(t.recipient_address),
    'created_at', t.created_at,
    'failure_reason', t.failure_reason,
    'direction', case when t.sender_id = viewer then 'out' else 'in' end
  );
end;
$$;

grant execute on function public.get_transfer_receipt(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Realtime
--
-- Nothing to add. public.coins and public.coin_transactions are already in the
-- supabase_realtime publication (202607100001), which is what the store page
-- subscribes to, so a recipient sees an incoming transfer land without a poll.
--
-- coin_transfers is deliberately NOT published: it carries both sides of a
-- transfer on one row, and its deny-all RLS means realtime would filter every
-- event out anyway. Clients read it through get_transfer_receipt instead.
-- ---------------------------------------------------------------------------
