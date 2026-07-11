-- Whisper Coins premium system
create table if not exists public.coins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coin_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('purchase','spend','refund')),
  amount integer not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, conversation_id)
);

create table if not exists public.anonymous_sender_reveals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);

alter table public.messages add column if not exists sender_user_id uuid references auth.users(id) on delete set null;
alter table public.messages add column if not exists sender_username text;
alter table public.messages add column if not exists sender_email_name text;

alter table public.coins enable row level security;
alter table public.coin_transactions enable row level security;
alter table public.chat_unlocks enable row level security;
alter table public.anonymous_sender_reveals enable row level security;

drop policy if exists "Users can read own coins" on public.coins;
create policy "Users can read own coins" on public.coins for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own coins row" on public.coins;
create policy "Users can insert own coins row" on public.coins for insert with check (auth.uid() = user_id);

drop policy if exists "Users can read own coin transactions" on public.coin_transactions;
create policy "Users can read own coin transactions" on public.coin_transactions for select using (auth.uid() = user_id);

drop policy if exists "Users can read own chat unlocks" on public.chat_unlocks;
create policy "Users can read own chat unlocks" on public.chat_unlocks for select using (auth.uid() = user_id);

drop policy if exists "Users can read own sender reveals" on public.anonymous_sender_reveals;
create policy "Users can read own sender reveals" on public.anonymous_sender_reveals for select using (auth.uid() = user_id);

create or replace function public.ensure_coin_wallet(target_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.coins (user_id, balance) values (target_user, 0)
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.purchase_whisper_coins(coin_amount integer, package_label text)
returns integer language plpgsql security definer set search_path = public as $$
declare current_balance integer;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if coin_amount <= 0 then raise exception 'Invalid coin amount'; end if;
  perform public.ensure_coin_wallet(auth.uid());
  update public.coins set balance = balance + coin_amount, updated_at = now()
  where user_id = auth.uid() returning balance into current_balance;
  insert into public.coin_transactions (user_id, transaction_type, amount, description, metadata)
  values (auth.uid(), 'purchase', coin_amount, package_label, jsonb_build_object('provider','placeholder'));
  return current_balance;
end;
$$;

create or replace function public.unlock_chat_with_coins(target_conversation_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare current_balance integer;
declare is_participant boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select exists(select 1 from public.conversations where id = target_conversation_id and (user_a = auth.uid() or user_b = auth.uid())) into is_participant;
  if not is_participant then raise exception 'Conversation not found'; end if;
  perform public.ensure_coin_wallet(auth.uid());
  if exists(select 1 from public.chat_unlocks where user_id = auth.uid() and conversation_id = target_conversation_id) then
    select balance into current_balance from public.coins where user_id = auth.uid();
    return current_balance;
  end if;
  update public.coins set balance = balance - 40, updated_at = now()
  where user_id = auth.uid() and balance >= 40 returning balance into current_balance;
  if current_balance is null then raise exception 'You need 40 coins to unlock this conversation.'; end if;
  insert into public.chat_unlocks (user_id, conversation_id) values (auth.uid(), target_conversation_id);
  insert into public.coin_transactions (user_id, transaction_type, amount, description, metadata)
  values (auth.uid(), 'spend', -40, 'Unlock Chat', jsonb_build_object('conversation_id', target_conversation_id));
  return current_balance;
end;
$$;

create or replace function public.reveal_sender_with_coins(target_message_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare current_balance integer;
declare owns_message boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select exists(select 1 from public.messages where id = target_message_id and recipient_id = auth.uid()) into owns_message;
  if not owns_message then raise exception 'Message not found'; end if;
  perform public.ensure_coin_wallet(auth.uid());
  if exists(select 1 from public.anonymous_sender_reveals where user_id = auth.uid() and message_id = target_message_id) then
    select balance into current_balance from public.coins where user_id = auth.uid();
    return current_balance;
  end if;
  update public.coins set balance = balance - 40, updated_at = now()
  where user_id = auth.uid() and balance >= 40 returning balance into current_balance;
  if current_balance is null then raise exception 'You need 40 coins to unlock this conversation.'; end if;
  insert into public.anonymous_sender_reveals (user_id, message_id) values (auth.uid(), target_message_id);
  insert into public.coin_transactions (user_id, transaction_type, amount, description, metadata)
  values (auth.uid(), 'spend', -40, 'Reveal Sender', jsonb_build_object('message_id', target_message_id));
  return current_balance;
end;
$$;
