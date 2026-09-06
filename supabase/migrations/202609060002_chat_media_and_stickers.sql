-- Chat media messages (GIFs + stickers) and user-created stickers.
--
-- Two additions, both extending the existing direct-message architecture
-- rather than creating a parallel one:
--
--   1. `direct_messages` learns to carry a media attachment that is *not* a
--      view-once photo: a GIF or a sticker. These are ordinary messages — they
--      go through the same insert path, the same RLS policy
--      (`can_send_direct_message`), the same realtime channel and the same
--      read/delivery receipts. Only the rendering differs.
--
--   2. `user_stickers` stores stickers a user has created. The image bytes live
--      in Cloudinary under `whisper/stickers/<user-id>/…` (the same
--      owner-in-the-path convention every other Cloudinary folder uses, which
--      is what lets /api/cloudinary/destroy authorize deletion); this table is
--      only the index of them.
--
-- Everything here is idempotent — safe to run against a database that already
-- has some of it.

-- ---------------------------------------------------------------------------
-- 1. Media columns on direct_messages
-- ---------------------------------------------------------------------------

alter table public.direct_messages
  add column if not exists media_url text;

-- 'gif' or 'sticker'. A discriminator column rather than sniffing the URL,
-- because the two render completely differently (a sticker has no bubble).
alter table public.direct_messages
  add column if not exists media_kind text;

-- Intrinsic dimensions, recorded at send time. The bubble reserves the right
-- aspect ratio before the image loads, so a GIF arriving over a slow
-- connection cannot reflow the thread under the reader's thumb.
alter table public.direct_messages
  add column if not exists media_width integer;

alter table public.direct_messages
  add column if not exists media_height integer;

-- The kind is constrained to the two values the client knows how to render,
-- and the URL is pinned to the sources the app actually uses: our Cloudinary
-- cloud (the normal case — GIFs are re-hosted there on send, created stickers
-- are uploaded there), the app's own bundled sticker packs (a same-origin
-- `/stickers/...` path), plus the two GIF CDNs as a fallback for when a
-- re-host fails mid-send. Anything else is refused at the database, so a
-- hostile client cannot make another user's browser load an arbitrary URL.
-- The client double-checks the same allowlist before rendering
-- (`lib/chatMedia.ts`) — defense in both places.
do $$ begin
  alter table public.direct_messages
    add constraint direct_messages_media_kind_check
    check (media_kind is null or media_kind in ('gif', 'sticker'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.direct_messages
    add constraint direct_messages_media_url_check
    check (
      media_url is null
      or (
        char_length(media_url) <= 600
        and (
          media_url ~ '^https://res\.cloudinary\.com/'
          or media_url ~ '^https://media\.tenor\.com/'
          or media_url ~ '^https://media[0-9]*\.giphy\.com/'
          or media_url ~ '^/stickers/[a-zA-Z0-9/._-]+$'
        )
      )
    );
exception when duplicate_object then null; end $$;

-- A kind without a URL (or vice versa) is a row the client cannot render.
do $$ begin
  alter table public.direct_messages
    add constraint direct_messages_media_pair_check
    check ((media_url is null) = (media_kind is null));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.direct_messages
    add constraint direct_messages_media_dims_check
    check (
      (media_width is null or media_width between 1 and 4096)
      and (media_height is null or media_height between 1 and 4096)
    );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. User-created stickers
-- ---------------------------------------------------------------------------

create table if not exists public.user_stickers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Sticker'
    check (char_length(name) between 1 and 64),
  -- Cloudinary only. Created stickers are always uploaded by us, so unlike
  -- message media there is no fallback host to allow.
  media_url text not null
    check (media_url ~ '^https://res\.cloudinary\.com/' and char_length(media_url) <= 600),
  mime_type text not null default 'image/png'
    check (mime_type in ('image/png', 'image/webp', 'image/gif')),
  is_animated boolean not null default false,
  width integer check (width between 1 and 2048),
  height integer check (height between 1 and 2048),
  created_at timestamptz not null default now()
);

create index if not exists user_stickers_user_idx
  on public.user_stickers (user_id, created_at desc);

alter table public.user_stickers enable row level security;

-- Stickers are strictly personal: you see yours, you make yours, you delete
-- yours. Nobody reads another user's collection — when a sticker is *sent*,
-- its URL travels on the message row, which has its own conversation-scoped
-- policies, so the recipient never needs to read this table.
drop policy if exists "Users can view their own stickers" on public.user_stickers;
create policy "Users can view their own stickers" on public.user_stickers
  for select using (auth.uid() = user_id);

drop policy if exists "Users can create their own stickers" on public.user_stickers;
create policy "Users can create their own stickers" on public.user_stickers
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own stickers" on public.user_stickers;
create policy "Users can update their own stickers" on public.user_stickers
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own stickers" on public.user_stickers;
create policy "Users can delete their own stickers" on public.user_stickers
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. Notification body for media messages
-- ---------------------------------------------------------------------------

-- Same function as 202608190003, with the two new media kinds described.
-- Without this, a sticker with no caption falls through to 'New message',
-- which is technically true and unhelpfully vague.
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
      when new.media_kind = 'sticker' then '💟 Sent you a sticker'
      when new.media_kind = 'gif' then '🎞️ Sent you a GIF'
      when new.audio_path is not null then '🎙️ Sent you a voice note'
      when new.image_path is not null then '📷 Sent you a photo'
      else 'New message'
    end
  );

  insert into public.notifications (user_id, type, title, body, source_id, metadata)
  values (
    recipient,
    'message',
    'New Inbox Message 💬',
    body_text,
    new.id,
    jsonb_build_object(
      'conversation_id', new.conversation_id,
      'conversationId', new.conversation_id,
      'sender_id', new.sender_id,
      'type', 'message'
    )
  );

  return new;
end;
$$;
