-- Voice notes (WhatsApp-style) and pinned messages.
--
-- Three things were failing in the chat because the database side was never
-- provisioned:
--
--   1. `pinned_messages` had no RLS policies, so every insert from the client
--      was rejected. The UI swallowed the error, so pinning looked like it did
--      nothing at all.
--   2. Voice notes were uploaded into `view-once-photos`, a bucket provisioned
--      for images. Any MIME allowlist on it rejects `audio/*` outright.
--   3. Coins were spent in one statement and the message inserted in another,
--      from the client. A failure between the two charged the sender for a
--      voice note that never arrived.
--
-- Everything here is idempotent — safe to run against a database that already
-- has some of it.

-- ---------------------------------------------------------------------------
-- 1. Voice note columns
-- ---------------------------------------------------------------------------

alter table public.direct_messages
  add column if not exists audio_path text;

alter table public.direct_messages
  add column if not exists audio_viewed_at timestamptz;

-- Duration is recorded at capture time rather than derived on read: the client
-- already knows it, and probing an <audio> element for it costs a network
-- round trip per bubble before the waveform can even be laid out.
alter table public.direct_messages
  add column if not exists audio_duration_ms integer;

-- Amplitude peaks sampled live while recording, 0-100, ~10/sec. Stored so the
-- receiver's waveform is the *sender's* actual waveform rather than a decode of
-- the file on every open — decoding a 60s clip on a mid-range phone to draw
-- 40 bars is not worth the main-thread time.
alter table public.direct_messages
  add column if not exists audio_waveform jsonb;

-- WebM/Opus on Chromium, MP4/AAC on WebKit. The container the sender actually
-- produced has to travel with the row, or playback guesses wrong.
alter table public.direct_messages
  add column if not exists audio_mime text;

-- ---------------------------------------------------------------------------
-- 2. Pinned messages
-- ---------------------------------------------------------------------------

create table if not exists public.pinned_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, message_id)
);

alter table public.pinned_messages
  add column if not exists expires_at timestamptz;

create index if not exists pinned_messages_conversation_idx
  on public.pinned_messages (conversation_id);

alter table public.pinned_messages enable row level security;

-- Pins are a property of the conversation, not of the person who set them —
-- WhatsApp shows one pin bar to both sides. So the policy is participation,
-- not authorship, and either participant may unpin.
create or replace function public.is_conversation_participant(target_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversations
    where id = target_conversation_id
      and (user_a = auth.uid() or user_b = auth.uid())
  );
$$;

drop policy if exists "Participants can view pins" on public.pinned_messages;
create policy "Participants can view pins" on public.pinned_messages
  for select using (public.is_conversation_participant(conversation_id));

drop policy if exists "Participants can pin" on public.pinned_messages;
create policy "Participants can pin" on public.pinned_messages
  for insert with check (
    pinned_by = auth.uid()
    and public.is_conversation_participant(conversation_id)
  );

drop policy if exists "Participants can update pins" on public.pinned_messages;
create policy "Participants can update pins" on public.pinned_messages
  for update using (public.is_conversation_participant(conversation_id))
  with check (public.is_conversation_participant(conversation_id));

drop policy if exists "Participants can unpin" on public.pinned_messages;
create policy "Participants can unpin" on public.pinned_messages
  for delete using (public.is_conversation_participant(conversation_id));

-- Expiry is swept lazily rather than by a scheduled job, mirroring how
-- `public_feed_posts` handles its own expiry. Called by the client on chat open,
-- which is the only moment a stale pin could be observed.
create or replace function public.sweep_expired_pins(target_conversation_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.pinned_messages
  where conversation_id = target_conversation_id
    and expires_at is not null
    and expires_at <= now();
$$;

grant execute on function public.sweep_expired_pins(uuid) to authenticated;
grant execute on function public.is_conversation_participant(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Message reactions (defensive — the client has always assumed this exists)
-- ---------------------------------------------------------------------------

create table if not exists public.message_reactions (
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_reactions enable row level security;

drop policy if exists "Participants can view reactions" on public.message_reactions;
create policy "Participants can view reactions" on public.message_reactions
  for select using (
    exists (
      select 1 from public.direct_messages m
      where m.id = message_id
        and public.is_conversation_participant(m.conversation_id)
    )
  );

drop policy if exists "Participants can react" on public.message_reactions;
create policy "Participants can react" on public.message_reactions
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.direct_messages m
      where m.id = message_id
        and public.is_conversation_participant(m.conversation_id)
    )
  );

drop policy if exists "Users can change own reaction" on public.message_reactions;
create policy "Users can change own reaction" on public.message_reactions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Users can remove own reaction" on public.message_reactions;
create policy "Users can remove own reaction" on public.message_reactions
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Voice message storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-messages',
  'voice-messages',
  false,
  16777216, -- 16MB; a 5 minute Opus note is well under 3MB
  array[
    'audio/webm', 'audio/webm;codecs=opus',
    'audio/ogg',  'audio/ogg;codecs=opus',
    'audio/mp4',  'audio/aac', 'audio/mpeg', 'audio/wav'
  ]
)
on conflict (id) do update
  set allowed_mime_types = excluded.allowed_mime_types,
      file_size_limit    = excluded.file_size_limit;

-- Objects are keyed `<conversation_id>/<uuid>.<ext>`. Parsing that segment in a
-- policy has to tolerate a malformed name without raising, or a single junk
-- object breaks every policy evaluation on the bucket.
create or replace function public.conversation_id_from_object(object_name text)
returns uuid language plpgsql immutable as $$
declare
  segment text := split_part(object_name, '/', 1);
begin
  if segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return segment::uuid;
end;
$$;

grant execute on function public.conversation_id_from_object(text) to authenticated;

drop policy if exists "Participants can upload voice notes" on storage.objects;
create policy "Participants can upload voice notes" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'voice-messages'
    and public.is_conversation_participant(public.conversation_id_from_object(name))
  );

drop policy if exists "Participants can read voice notes" on storage.objects;
create policy "Participants can read voice notes" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'voice-messages'
    and public.is_conversation_participant(public.conversation_id_from_object(name))
  );

drop policy if exists "Participants can delete voice notes" on storage.objects;
create policy "Participants can delete voice notes" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'voice-messages'
    and public.is_conversation_participant(public.conversation_id_from_object(name))
  );

-- The legacy bucket still holds view-once audio sent before this migration, and
-- the photo path shares it. Widen its allowlist rather than migrate the rows.
update storage.buckets
set allowed_mime_types = array[
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic',
  'audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus',
  'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/wav'
]
where id = 'view-once-photos';

-- ---------------------------------------------------------------------------
-- 5. Sending a voice note atomically
-- ---------------------------------------------------------------------------

-- Replaces the client-side "spend, then insert" pair. Those were two round
-- trips with no transaction around them: a dropped connection between them
-- charged 20 coins for a message that was never created. One function, one
-- transaction, and the charge and the message succeed or fail together.
--
-- `spend_coins_for_voice_note` is kept below for backward compatibility with any
-- client still calling it directly.
create or replace function public.send_voice_note(
  target_conversation_id uuid,
  storage_path text,
  duration_ms integer,
  waveform jsonb,
  mime_type text,
  caption text default null,
  reply_to uuid default null,
  view_once boolean default false
)
returns public.direct_messages
language plpgsql security definer set search_path = public as $$
declare
  voice_cost constant integer := 20;
  current_balance integer;
  inserted public.direct_messages;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_conversation_participant(target_conversation_id) then
    raise exception 'Conversation not found';
  end if;

  if storage_path is null or length(trim(storage_path)) = 0 then
    raise exception 'Missing audio';
  end if;

  perform public.ensure_coin_wallet(auth.uid());

  update public.coins
    set balance = balance - voice_cost, updated_at = now()
  where user_id = auth.uid() and balance >= voice_cost
  returning balance into current_balance;

  if current_balance is null then
    raise exception 'You need % coins to send a voice note.', voice_cost;
  end if;

  insert into public.coin_transactions (user_id, transaction_type, amount, description, metadata)
  values (
    auth.uid(), 'spend', -voice_cost, 'Send voice note',
    jsonb_build_object('conversation_id', target_conversation_id)
  );

  insert into public.direct_messages (
    conversation_id, sender_id, content, reply_to_id,
    audio_path, audio_duration_ms, audio_waveform, audio_mime, is_view_once
  )
  values (
    target_conversation_id, auth.uid(), nullif(trim(coalesce(caption, '')), ''), reply_to,
    storage_path, duration_ms, waveform, mime_type, coalesce(view_once, false)
  )
  returning * into inserted;

  update public.conversations
    set last_message_at = now(), last_message_sender_id = auth.uid()
  where id = target_conversation_id;

  return inserted;
end;
$$;

grant execute on function public.send_voice_note(uuid, text, integer, jsonb, text, text, uuid, boolean) to authenticated;

create or replace function public.spend_coins_for_voice_note(target_conversation_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  current_balance integer;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_conversation_participant(target_conversation_id) then
    raise exception 'Conversation not found';
  end if;

  perform public.ensure_coin_wallet(auth.uid());

  update public.coins set balance = balance - 20, updated_at = now()
  where user_id = auth.uid() and balance >= 20 returning balance into current_balance;

  if current_balance is null then raise exception 'You need 20 coins to send a voice note.'; end if;

  insert into public.coin_transactions (user_id, transaction_type, amount, description, metadata)
  values (auth.uid(), 'spend', -20, 'Send voice note', jsonb_build_object('conversation_id', target_conversation_id));

  return current_balance;
end;
$$;

grant execute on function public.spend_coins_for_voice_note(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Realtime
-- ---------------------------------------------------------------------------

-- Without this the pin bar only updates for whoever tapped the pin; the other
-- side sees it on next open. Same for reactions.
do $$
begin
  alter publication supabase_realtime add table public.pinned_messages;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.message_reactions;
exception when duplicate_object then null;
end $$;
