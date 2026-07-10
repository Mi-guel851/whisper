-- Harden friend requests and add atomic foreign friend connections.

create or replace function public.ensure_direct_conversation(left_user uuid, right_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  user_a_id uuid;
  user_b_id uuid;
  conversation_id uuid;
  user_a_other_label text;
  user_b_other_label text;
begin
  if left_user = right_user then
    raise exception 'Cannot create a conversation with yourself';
  end if;

  select least(left_user, right_user), greatest(left_user, right_user)
  into user_a_id, user_b_id;

  select coalesce(display_name, username, 'Friend') into user_a_other_label
  from public.profiles
  where id = user_b_id;

  select coalesce(display_name, username, 'Friend') into user_b_other_label
  from public.profiles
  where id = user_a_id;

  insert into public.conversations (user_a, user_b, user_a_label, user_b_label, last_message_at)
  values (user_a_id, user_b_id, user_a_other_label, user_b_other_label, now())
  on conflict (user_a, user_b) do update set last_message_at = public.conversations.last_message_at
  returning id into conversation_id;

  insert into public.chat_unlocks (user_id, conversation_id)
  values (left_user, conversation_id), (right_user, conversation_id)
  on conflict (user_id, conversation_id) do nothing;

  return conversation_id;
end;
$$;

create or replace function public.accept_friend_request(request_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  request_row public.friend_requests%rowtype;
  conversation_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into request_row
  from public.friend_requests
  where id = request_id and receiver_id = auth.uid() and status = 'pending'
  for update;

  if not found then raise exception 'Friend request not found'; end if;

  if exists (
    select 1 from public.blocked_users
    where (blocker_id = request_row.requester_id and blocked_id = request_row.receiver_id)
       or (blocker_id = request_row.receiver_id and blocked_id = request_row.requester_id)
  ) then
    raise exception 'Cannot accept a blocked user';
  end if;

  update public.friend_requests
  set status = 'accepted', updated_at = now()
  where id = request_id;

  insert into public.friends (user_id, friend_id)
  values (request_row.requester_id, request_row.receiver_id), (request_row.receiver_id, request_row.requester_id)
  on conflict (user_id, friend_id) do nothing;

  conversation_id := public.ensure_direct_conversation(request_row.requester_id, request_row.receiver_id);

  return conversation_id;
end;
$$;

create or replace function public.send_friend_request(target_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  caller uuid := auth.uid();
  existing_reverse_request uuid;
  accepted_conversation_id uuid;
  caller_country text;
  target_country text;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  if target_user is null or target_user = caller then raise exception 'Cannot send a friend request to yourself'; end if;

  select country into caller_country from public.profiles where id = caller;
  select country into target_country from public.profiles where id = target_user;

  if target_country is null then raise exception 'User not found'; end if;
  if caller_country is null or caller_country <> target_country then
    raise exception 'You can only search and add users from your country';
  end if;

  if exists (select 1 from public.friends where user_id = caller and friend_id = target_user) then
    return public.ensure_direct_conversation(caller, target_user);
  end if;

  if exists (
    select 1 from public.blocked_users
    where (blocker_id = caller and blocked_id = target_user)
       or (blocker_id = target_user and blocked_id = caller)
  ) then
    raise exception 'Cannot send a friend request to a blocked user';
  end if;

  select id into existing_reverse_request
  from public.friend_requests
  where requester_id = target_user and receiver_id = caller and status = 'pending'
  for update;

  if existing_reverse_request is not null then
    accepted_conversation_id := public.accept_friend_request(existing_reverse_request);
    return accepted_conversation_id;
  end if;

  if exists (
    select 1 from public.friend_requests
    where requester_id = caller and receiver_id = target_user and status = 'pending'
  ) then
    return null;
  end if;

  insert into public.friend_requests (requester_id, receiver_id, status)
  values (caller, target_user, 'pending')
  on conflict do nothing;

  return null;
end;
$$;

create or replace function public.list_foreign_connection_candidates(result_limit integer default 5)
returns table(id uuid, username text, display_name text, avatar_url text, country text)
language sql security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.avatar_url, p.country
  from public.profiles p
  join public.profiles me on me.id = auth.uid()
  where auth.uid() is not null
    and p.id <> auth.uid()
    and p.country is not null
    and me.country is not null
    and p.country <> me.country
    and not exists (select 1 from public.friends f where f.user_id = auth.uid() and f.friend_id = p.id)
    and not exists (
      select 1 from public.friend_requests fr
      where fr.status = 'pending'
        and ((fr.requester_id = auth.uid() and fr.receiver_id = p.id) or (fr.requester_id = p.id and fr.receiver_id = auth.uid()))
    )
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id) or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
  order by p.username asc
  limit greatest(1, least(coalesce(result_limit, 5), 50));
$$;

create or replace function public.connect_foreign_friend(target_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  caller uuid := auth.uid();
  caller_country text;
  target_country text;
  current_balance integer;
  conversation_id uuid;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  if target_user is null or target_user = caller then raise exception 'Cannot connect with yourself'; end if;

  perform public.ensure_coin_wallet(caller);

  select country into caller_country from public.profiles where id = caller;
  select country into target_country from public.profiles where id = target_user;

  if target_country is null then raise exception 'User not found'; end if;
  if caller_country is null or target_country = caller_country then
    raise exception 'Foreign connections require users from different countries';
  end if;

  if exists (select 1 from public.friends where user_id = caller and friend_id = target_user) then
    return public.ensure_direct_conversation(caller, target_user);
  end if;

  if exists (
    select 1 from public.friend_requests fr
    where fr.status = 'pending'
      and ((fr.requester_id = caller and fr.receiver_id = target_user) or (fr.requester_id = target_user and fr.receiver_id = caller))
  ) then
    raise exception 'Resolve the pending friend request first';
  end if;

  if exists (
    select 1 from public.blocked_users
    where (blocker_id = caller and blocked_id = target_user)
       or (blocker_id = target_user and blocked_id = caller)
  ) then
    raise exception 'Cannot connect with a blocked user';
  end if;

  select balance into current_balance
  from public.coins
  where user_id = caller
  for update;

  if current_balance is null or current_balance < 50 then
    raise exception 'Not enough coins.';
  end if;

  update public.coins
  set balance = balance - 50, updated_at = now()
  where user_id = caller
  returning balance into current_balance;

  insert into public.coin_transactions (user_id, transaction_type, amount, description, metadata)
  values (caller, 'spend', -50, 'Connect With Foreigner', jsonb_build_object('friend_id', target_user));

  insert into public.friends (user_id, friend_id)
  values (caller, target_user), (target_user, caller)
  on conflict (user_id, friend_id) do nothing;

  conversation_id := public.ensure_direct_conversation(caller, target_user);

  return conversation_id;
end;
$$;

create or replace function public.search_same_country_friend_candidates(search_query text, result_limit integer default 10)
returns table(id uuid, username text, display_name text, avatar_url text, country text)
language sql security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.avatar_url, p.country
  from public.profiles p
  join public.profiles me on me.id = auth.uid()
  where auth.uid() is not null
    and length(trim(coalesce(search_query, ''))) >= 2
    and p.id <> auth.uid()
    and p.country = me.country
    and p.username ilike '%' || trim(search_query) || '%'
    and not exists (select 1 from public.friends f where f.user_id = auth.uid() and f.friend_id = p.id)
    and not exists (
      select 1 from public.friend_requests fr
      where fr.status = 'pending'
        and ((fr.requester_id = auth.uid() and fr.receiver_id = p.id) or (fr.requester_id = p.id and fr.receiver_id = auth.uid()))
    )
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id) or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
  order by p.username asc
  limit greatest(1, least(coalesce(result_limit, 10), 25));
$$;
