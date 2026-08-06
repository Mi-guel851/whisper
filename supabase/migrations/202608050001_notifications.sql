-- Notifications table, voice note audio support, and saved user theme preference.

alter table public.direct_messages
  add column if not exists audio_path text;

alter table public.direct_messages
  add column if not exists audio_viewed_at timestamptz;

alter table public.profiles
  add column if not exists theme_preference text not null default 'dark';

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('message','friend_request','public_feed')),
  title text not null,
  body text,
  source_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

drop policy if exists "Users can view own notifications" on public.notifications;
create policy "Users can view own notifications" on public.notifications for select using (auth.uid() = user_id);

drop policy if exists "Users can insert notifications" on public.notifications;
create policy "Users can insert notifications" on public.notifications for insert with check (auth.uid() = user_id);

drop policy if exists "Users can manage own notifications" on public.notifications;
create policy "Users can mark own notifications read" on public.notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete own notifications" on public.notifications;
create policy "Users can delete own notifications" on public.notifications for delete using (auth.uid() = user_id);

create or replace function public.notify_new_direct_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  recipient uuid;
  body_text text;
begin
  select case when user_a = new.sender_id then user_b else user_a end
    into recipient
    from public.conversations
    where id = new.conversation_id;

  if recipient is null then
    return new;
  end if;

  body_text := coalesce(new.content,
    case
      when new.audio_path is not null then '🎙️ Voice note'
      when new.image_path is not null then '📷 Photo'
      else 'New message'
    end
  );

  insert into public.notifications (user_id, type, title, body, source_id, metadata)
  values (recipient, 'message', 'New message', body_text, new.id, jsonb_build_object('conversation_id', new.conversation_id, 'sender_id', new.sender_id));

  return new;
end;
$$;

drop trigger if exists direct_message_notification_trigger on public.direct_messages;
create trigger direct_message_notification_trigger
  after insert on public.direct_messages
  for each row execute function public.notify_new_direct_message();

create or replace function public.notify_new_friend_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, title, body, source_id, metadata)
  values (new.receiver_id, 'friend_request', 'New friend request', 'Someone wants to connect with you.', new.id, jsonb_build_object('sender_id', new.sender_id));
  return new;
end;
$$;

drop trigger if exists friend_request_notification_trigger on public.friend_requests;
create trigger friend_request_notification_trigger
  after insert on public.friend_requests
  for each row execute function public.notify_new_friend_request();

create or replace function public.notify_new_public_feed_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.public_feed_notifications (post_id, user_id)
  select new.id, p.id
  from public.profiles p
  where p.id <> new.author_id
  on conflict (post_id, user_id) do nothing;

  insert into public.notifications (user_id, type, title, body, source_id, metadata)
  select p.id, 'public_feed', 'New public post', left(new.body, 120), new.id, jsonb_build_object('author_id', new.author_id)
  from public.profiles p
  where p.id <> new.author_id;

  return new;
end;
$$;

drop trigger if exists public_feed_notification_trigger on public.public_feed_posts;
create trigger public_feed_notification_trigger
  after insert on public.public_feed_posts
  for each row execute function public.notify_new_public_feed_post();

create or replace function public.spend_coins_for_voice_note(target_conversation_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  current_balance integer;
  is_participant boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select exists(select 1 from public.conversations where id = target_conversation_id and (user_a = auth.uid() or user_b = auth.uid())) into is_participant;
  if not is_participant then raise exception 'Conversation not found'; end if;

  perform public.ensure_coin_wallet(auth.uid());

  update public.coins set balance = balance - 20, updated_at = now()
  where user_id = auth.uid() and balance >= 20 returning balance into current_balance;

  if current_balance is null then raise exception 'You need 20 coins to send a voice note.'; end if;

  insert into public.coin_transactions (user_id, transaction_type, amount, description, metadata)
  values (auth.uid(), 'spend', -20, 'Send voice note', jsonb_build_object('conversation_id', target_conversation_id));

  return current_balance;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;
