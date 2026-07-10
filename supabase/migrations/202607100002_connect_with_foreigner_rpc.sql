-- Ensure the Connect With Foreigners RPC exists in environments that already have the
-- friends/coins schema but missed the original friends-management migration.
-- Reuses existing profiles, blocked_users, friend_requests, friends, conversations,
-- chat_unlocks, coins, and coin_transactions tables.

create or replace function public.connect_with_foreigner(target_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance integer;
  requester_country text;
  target_country text;
  user_a uuid;
  user_b uuid;
  conversation_id uuid;
  requester_username text;
  target_username text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'Cannot connect with yourself';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(least(auth.uid(), target_user_id)::text || ':' || greatest(auth.uid(), target_user_id)::text, 0));

  select country, username
  into requester_country, requester_username
  from public.profiles
  where id = auth.uid();

  select country, username
  into target_country, target_username
  from public.profiles
  where id = target_user_id;

  if target_country is null then
    raise exception 'User not found';
  end if;

  if requester_country is not distinct from target_country then
    raise exception 'This user is not foreign';
  end if;

  if exists (
    select 1
    from public.blocked_users
    where (blocker_id = auth.uid() and blocked_id = target_user_id)
       or (blocker_id = target_user_id and blocked_id = auth.uid())
  ) then
    raise exception 'Cannot connect with this user';
  end if;

  if exists (
    select 1
    from public.friends
    where user_id = auth.uid() and friend_id = target_user_id
  ) then
    raise exception 'Already connected';
  end if;

  if exists (
    select 1
    from public.friend_requests
    where status = 'pending'
      and least(requester_id, receiver_id) = least(auth.uid(), target_user_id)
      and greatest(requester_id, receiver_id) = greatest(auth.uid(), target_user_id)
  ) then
    raise exception 'A pending request already exists';
  end if;

  perform public.ensure_coin_wallet(auth.uid());

  select balance
  into current_balance
  from public.coins
  where user_id = auth.uid()
  for update;

  if current_balance < 50 then
    raise exception 'Not enough coins.';
  end if;

  update public.coins
  set balance = balance - 50,
      updated_at = now()
  where user_id = auth.uid()
  returning balance into current_balance;

  insert into public.coin_transactions (user_id, transaction_type, amount, description, metadata)
  values (auth.uid(), 'spend', -50, 'Connect with Foreigner', jsonb_build_object('connected_user_id', target_user_id));

  insert into public.friends (user_id, friend_id)
  values (auth.uid(), target_user_id), (target_user_id, auth.uid())
  on conflict (user_id, friend_id) do nothing;

  select least(auth.uid(), target_user_id), greatest(auth.uid(), target_user_id)
  into user_a, user_b;

  insert into public.conversations (user_a, user_b, user_a_label, user_b_label, last_message_at)
  values (
    user_a,
    user_b,
    case when user_a = auth.uid() then coalesce(target_username, 'Friend') else coalesce(requester_username, 'Friend') end,
    case when user_b = auth.uid() then coalesce(target_username, 'Friend') else coalesce(requester_username, 'Friend') end,
    now()
  )
  on conflict (user_a, user_b) do update
    set last_message_at = public.conversations.last_message_at
  returning id into conversation_id;

  insert into public.chat_unlocks (user_id, conversation_id)
  values (auth.uid(), conversation_id), (target_user_id, conversation_id)
  on conflict (user_id, conversation_id) do nothing;

  return current_balance;
end;
$$;

grant execute on function public.connect_with_foreigner(uuid) to authenticated;
