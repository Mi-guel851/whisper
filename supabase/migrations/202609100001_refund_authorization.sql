-- SECURITY: the old authenticated refund RPC could mint arbitrary coins without
-- a preceding debit. Apply this migration before deploying the paired API change.
begin;

-- Revoke every overload of money-crediting server functions, including functions
-- created outside migrations. Never leave an old signature callable by clients.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('refund_whisper_coins', 'purchase_whisper_coins', 'credit_verified_payment')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end $$;

-- A refund is a server decision after a verified debit and a failed insert.
-- The target is the auth.getUser()-verified caller, never a request-body user id.
create or replace function public.refund_whisper_coins_for(
  p_user_id uuid, p_amount integer, p_description text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare new_balance integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_user_id is null or p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    raise exception 'Invalid refund' using errcode = '22023';
  end if;
  update public.coins
    set balance = balance + p_amount, updated_at = now()
    where user_id = p_user_id
    returning balance into new_balance;
  if new_balance is null then
    raise exception 'Wallet not found' using errcode = 'P0002';
  end if;
  insert into public.coin_transactions (user_id, transaction_type, amount, description)
    values (p_user_id, 'refund', p_amount,
      left(coalesce(nullif(btrim(p_description), ''), 'Refund'), 200));
  return new_balance;
end;
$$;
revoke all on function public.refund_whisper_coins_for(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.refund_whisper_coins_for(uuid, integer, text) to service_role;
commit;
