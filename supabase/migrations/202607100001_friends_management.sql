-- Friends management system
create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sender_id <> receiver_id)
);

create unique index if not exists friend_requests_pending_unique
  on public.friend_requests (least(sender_id, receiver_id), greatest(sender_id, receiver_id))
  where status = 'pending';

create index if not exists friend_requests_receiver_idx on public.friend_requests (receiver_id, status, created_at desc);
create index if not exists friend_requests_sender_idx on public.friend_requests (sender_id, status, created_at desc);

create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  source text not null default 'request',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id <> friend_id),
  unique (user_id, friend_id)
);

create table if not exists public.blocked_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id <> blocked_user_id),
  unique (user_id, blocked_user_id)
);

alter table public.friends add column if not exists source text not null default 'request';
alter table public.friends add column if not exists updated_at timestamptz not null default now();
alter table public.blocked_users add column if not exists updated_at timestamptz not null default now();

create index if not exists friends_user_idx on public.friends (user_id, created_at desc);
create index if not exists friends_friend_idx on public.friends (friend_id);
create unique index if not exists conversations_user_pair_unique on public.conversations (user_a, user_b);

alter table public.friend_requests enable row level security;
alter table public.friends enable row level security;
alter table public.blocked_users enable row level security;

do $$
begin
  alter publication supabase_realtime add table public.friend_requests;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.friends;
exception when duplicate_object then null;
end $$;

drop policy if exists "Users can view related friend requests" on public.friend_requests;
create policy "Users can view related friend requests" on public.friend_requests
  for select using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "Users can send friend requests" on public.friend_requests;
create policy "Users can send friend requests" on public.friend_requests
  for insert with check (
    auth.uid() = sender_id
    and sender_id <> receiver_id
    and status = 'pending'
    and (select p1.country from public.profiles p1 where p1.id = sender_id) is not distinct from (select p2.country from public.profiles p2 where p2.id = receiver_id)
    and not exists (
      select 1 from public.blocked_users b
      where (b.user_id = sender_id and b.blocked_user_id = receiver_id)
         or (b.user_id = receiver_id and b.blocked_user_id = sender_id)
    )
    and not exists (select 1 from public.friends f where f.user_id = sender_id and f.friend_id = receiver_id)
  );

drop policy if exists "Receivers can update friend requests" on public.friend_requests;
create policy "Receivers can update friend requests" on public.friend_requests
  for update using (auth.uid() = receiver_id) with check (auth.uid() = receiver_id);

drop policy if exists "Users can view own friendships" on public.friends;
create policy "Users can view own friendships" on public.friends
  for select using (auth.uid() = user_id);

create or replace function public.accept_friend_request(request_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  request_row public.friend_requests%rowtype;
  user_a uuid;
  user_b uuid;
  conversation_id uuid;
  sender_username text;
  receiver_username text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into request_row
  from public.friend_requests
  where id = request_id and receiver_id = auth.uid() and status = 'pending'
  for update;

  if not found then raise exception 'Friend request not found'; end if;

  update public.friend_requests
  set status = 'accepted', updated_at = now()
  where id = request_id;

  insert into public.friends (user_id, friend_id, source)
  values (request_row.sender_id, request_row.receiver_id, 'request'), (request_row.receiver_id, request_row.sender_id, 'request')
  on conflict (user_id, friend_id) do nothing;

  select least(request_row.sender_id, request_row.receiver_id), greatest(request_row.sender_id, request_row.receiver_id)
  into user_a, user_b;

  select username into sender_username from public.profiles where id = request_row.sender_id;
  select username into receiver_username from public.profiles where id = request_row.receiver_id;

  insert into public.conversations (user_a, user_b, user_a_label, user_b_label, last_message_at)
  values (
    user_a,
    user_b,
    case when user_a = request_row.sender_id then coalesce(receiver_username, 'Friend') else coalesce(sender_username, 'Friend') end,
    case when user_b = request_row.sender_id then coalesce(receiver_username, 'Friend') else coalesce(sender_username, 'Friend') end,
    now()
  )
  on conflict (user_a, user_b) do update set last_message_at = public.conversations.last_message_at
  returning id into conversation_id;

  insert into public.chat_unlocks (user_id, conversation_id)
  values (request_row.sender_id, conversation_id), (request_row.receiver_id, conversation_id)
  on conflict (user_id, conversation_id) do nothing;

  return conversation_id;
end;
$$;

-- Friend request workflow helpers and guards.
drop policy if exists "Requesters can cancel own pending friend requests" on public.friend_requests;
create policy "Requesters can cancel own pending friend requests" on public.friend_requests
  for update using (auth.uid() = sender_id and status = 'pending')
  with check (auth.uid() = sender_id and status = 'cancelled');

create or replace function public.send_friend_request(target_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  request_id uuid;
  sender_country text;
  receiver_country text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if target_user_id = auth.uid() then raise exception 'Cannot add yourself'; end if;

  select country into sender_country from public.profiles where id = auth.uid();
  select country into receiver_country from public.profiles where id = target_user_id;

  if receiver_country is null then raise exception 'User not found'; end if;
  if sender_country is distinct from receiver_country then raise exception 'You can only add users in your country'; end if;

  if exists (
    select 1 from public.blocked_users
    where (user_id = auth.uid() and blocked_user_id = target_user_id)
       or (user_id = target_user_id and blocked_user_id = auth.uid())
  ) then
    raise exception 'Cannot send request';
  end if;

  if exists (select 1 from public.friends where user_id = auth.uid() and friend_id = target_user_id) then
    raise exception 'Already friends';
  end if;

  select id into request_id
  from public.friend_requests
  where status = 'pending'
    and least(sender_id, receiver_id) = least(auth.uid(), target_user_id)
    and greatest(sender_id, receiver_id) = greatest(auth.uid(), target_user_id)
  limit 1;

  if request_id is not null then
    return request_id;
  end if;

  insert into public.friend_requests (sender_id, receiver_id, status)
  values (auth.uid(), target_user_id, 'pending')
  returning id into request_id;

  return request_id;
end;
$$;

create or replace function public.ensure_friend_conversation(friend_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  user_a uuid;
  user_b uuid;
  conversation_id uuid;
  my_username text;
  friend_username text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  if not exists (select 1 from public.friends where user_id = auth.uid() and friend_id = friend_user_id) then
    raise exception 'Friendship not found';
  end if;

  select least(auth.uid(), friend_user_id), greatest(auth.uid(), friend_user_id) into user_a, user_b;
  select username into my_username from public.profiles where id = auth.uid();
  select username into friend_username from public.profiles where id = friend_user_id;

  insert into public.conversations (user_a, user_b, user_a_label, user_b_label, last_message_at)
  values (
    user_a,
    user_b,
    case when user_a = auth.uid() then coalesce(friend_username, 'Friend') else coalesce(my_username, 'Friend') end,
    case when user_b = auth.uid() then coalesce(friend_username, 'Friend') else coalesce(my_username, 'Friend') end,
    now()
  )
  on conflict (user_a, user_b) do update set last_message_at = public.conversations.last_message_at
  returning id into conversation_id;

  insert into public.chat_unlocks (user_id, conversation_id)
  values (auth.uid(), conversation_id), (friend_user_id, conversation_id)
  on conflict (user_id, conversation_id) do nothing;

  return conversation_id;
end;
$$;

create or replace function public.can_send_direct_message(target_conversation_id uuid, target_sender_id uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = target_conversation_id
      and target_sender_id in (c.user_a, c.user_b)
      and not exists (
        select 1
        from public.blocked_users b
        where (b.user_id = c.user_a and b.blocked_user_id = c.user_b)
           or (b.user_id = c.user_b and b.blocked_user_id = c.user_a)
      )
  );
$$;

drop policy if exists "Conversation members can send unblocked direct messages" on public.direct_messages;
create policy "Conversation members can send unblocked direct messages" on public.direct_messages
  for insert with check (auth.uid() = sender_id and public.can_send_direct_message(conversation_id, sender_id));


drop policy if exists "Users can view related blocks" on public.blocked_users;
create policy "Users can view related blocks" on public.blocked_users
  for select using (auth.uid() = user_id or auth.uid() = blocked_user_id);

drop policy if exists "Users can block others" on public.blocked_users;
create policy "Users can block others" on public.blocked_users
  for insert with check (auth.uid() = user_id and user_id <> blocked_user_id);

-- Connect with Foreigners: immediate paid foreign friendship using the existing coin wallet.
do $$
begin
  alter publication supabase_realtime add table public.coins;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.coin_transactions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.conversations;
exception when duplicate_object then null;
end $$;

create or replace function public.connect_with_foreigner(target_user_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  current_balance integer;
  sender_country text;
  target_country text;
  user_a uuid;
  user_b uuid;
  conversation_id uuid;
  sender_username text;
  target_username text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if target_user_id = auth.uid() then raise exception 'Cannot connect with yourself'; end if;

  perform pg_advisory_xact_lock(hashtextextended(least(auth.uid(), target_user_id)::text || ':' || greatest(auth.uid(), target_user_id)::text, 0));

  select country, username into sender_country, sender_username from public.profiles where id = auth.uid();
  select country, username into target_country, target_username from public.profiles where id = target_user_id;

  if target_country is null then raise exception 'User not found'; end if;
  if sender_country is not distinct from target_country then raise exception 'This user is not foreign'; end if;

  if exists (
    select 1 from public.blocked_users
    where (user_id = auth.uid() and blocked_user_id = target_user_id)
       or (user_id = target_user_id and blocked_user_id = auth.uid())
  ) then
    raise exception 'Cannot connect with this user';
  end if;

  if exists (select 1 from public.friends where user_id = auth.uid() and friend_id = target_user_id) then
    raise exception 'Already connected';
  end if;

  if exists (
    select 1 from public.friend_requests
    where status = 'pending'
      and least(sender_id, receiver_id) = least(auth.uid(), target_user_id)
      and greatest(sender_id, receiver_id) = greatest(auth.uid(), target_user_id)
  ) then
    raise exception 'A pending request already exists';
  end if;

  perform public.ensure_coin_wallet(auth.uid());
  select balance into current_balance from public.coins where user_id = auth.uid() for update;
  if current_balance < 50 then raise exception 'Not enough coins.'; end if;

  update public.coins
  set balance = balance - 50, updated_at = now()
  where user_id = auth.uid()
  returning balance into current_balance;

  insert into public.coin_transactions (user_id, transaction_type, amount, description, metadata)
  values (auth.uid(), 'spend', -50, 'Connect with Foreigner', jsonb_build_object('connected_user_id', target_user_id));

  insert into public.friends (user_id, friend_id, source)
  values (auth.uid(), target_user_id, 'foreign'), (target_user_id, auth.uid(), 'foreign')
  on conflict (user_id, friend_id) do nothing;

  select least(auth.uid(), target_user_id), greatest(auth.uid(), target_user_id) into user_a, user_b;

  insert into public.conversations (user_a, user_b, user_a_label, user_b_label, last_message_at)
  values (
    user_a,
    user_b,
    case when user_a = auth.uid() then coalesce(target_username, 'Friend') else coalesce(sender_username, 'Friend') end,
    case when user_b = auth.uid() then coalesce(target_username, 'Friend') else coalesce(sender_username, 'Friend') end,
    now()
  )
  on conflict (user_a, user_b) do update set last_message_at = public.conversations.last_message_at
  returning id into conversation_id;

  return current_balance;
end;
$$;
