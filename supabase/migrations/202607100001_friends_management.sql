-- Friends management system
create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> receiver_id)
);

create unique index if not exists friend_requests_pending_unique
  on public.friend_requests (least(requester_id, receiver_id), greatest(requester_id, receiver_id))
  where status = 'pending';

create index if not exists friend_requests_receiver_idx on public.friend_requests (receiver_id, status, created_at desc);
create index if not exists friend_requests_requester_idx on public.friend_requests (requester_id, status, created_at desc);

create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_id <> friend_id),
  unique (user_id, friend_id)
);

create index if not exists friends_user_idx on public.friends (user_id, created_at desc);
create index if not exists friends_friend_idx on public.friends (friend_id);
create unique index if not exists conversations_user_pair_unique on public.conversations (user_a, user_b);

alter table public.friend_requests enable row level security;
alter table public.friends enable row level security;

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
  for select using (auth.uid() = requester_id or auth.uid() = receiver_id);

drop policy if exists "Users can send friend requests" on public.friend_requests;
create policy "Users can send friend requests" on public.friend_requests
  for insert with check (auth.uid() = requester_id and requester_id <> receiver_id and status = 'pending');

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
  requester_username text;
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

  insert into public.friends (user_id, friend_id)
  values (request_row.requester_id, request_row.receiver_id), (request_row.receiver_id, request_row.requester_id)
  on conflict (user_id, friend_id) do nothing;

  select least(request_row.requester_id, request_row.receiver_id), greatest(request_row.requester_id, request_row.receiver_id)
  into user_a, user_b;

  select username into requester_username from public.profiles where id = request_row.requester_id;
  select username into receiver_username from public.profiles where id = request_row.receiver_id;

  insert into public.conversations (user_a, user_b, user_a_label, user_b_label, last_message_at)
  values (
    user_a,
    user_b,
    case when user_a = request_row.requester_id then coalesce(receiver_username, 'Friend') else coalesce(requester_username, 'Friend') end,
    case when user_b = request_row.requester_id then coalesce(receiver_username, 'Friend') else coalesce(requester_username, 'Friend') end,
    now()
  )
  on conflict (user_a, user_b) do update set last_message_at = public.conversations.last_message_at
  returning id into conversation_id;

  insert into public.chat_unlocks (user_id, conversation_id)
  values (request_row.requester_id, conversation_id), (request_row.receiver_id, conversation_id)
  on conflict (user_id, conversation_id) do nothing;

  return conversation_id;
end;
$$;
