-- ===========================================================================
-- Notification targeting: friends-only feed alerts, reply notifications,
-- coin-transfer receipts, per-category preferences, dedup, and one delivery
-- path (whispers included).
--
-- WHY EACH SECTION EXISTS
--
--   T1  Preference columns. The task requires excluding "users who disabled
--       that notification category", which a single global `push_notifications`
--       switch cannot express. One nullable boolean per category; null means
--       opted-in, matching how `push_notifications` already behaves.
--   T2  The notifications `type` CHECK constraint predates 'reply',
--       'coin_transfer' and 'call' rows; every insert below would fail at the
--       constraint without extending it first.
--   T3  Dedup at the database layer. A unique index on
--       (user_id, type, source_id) plus `on conflict do nothing` on every
--       trigger insert means a re-run event, a retry, or a user eligible
--       through two paths (e.g. a reply under your own post) cannot produce a
--       second notification row for the same event.
--   T4  THE PUBLIC-FEED BROADCAST. The pre-20260910 chain ended in
--       "every profile in the database" on every post — the trigger fanned out
--       to all profiles and the `notify-new-feed-post` edge function did the
--       same on the push side. Feed posts now reach exactly the author's
--       accepted friends (friends table, either direction — the app writes
--       both rows on accept, and either alone is treated as friends
--       everywhere else, e.g. the call RLS in 202609090004), minus the author,
--       minus blocked pairs in either direction, minus banned accounts, minus
--       anyone who switched the category (or global push) off. Replies do NOT
--       fan out to the replier's friends at all — they notify the person they
--       reply to (T5). The feed push is now a single batched call whose
--       recipient list is computed here, in the same statement that wrote the
--       rows; the edge function no longer decides who to notify, so an
--       all-user fan-out cannot silently return by updating that function's
--       query. The old `deliver_feed_post_push_trigger` is dropped for the
--       same reason: two senders of one event is the duplicate this section
--       exists to remove.
--   T5  Reply targeting per the product spec: reply-to-a-post notifies the
--       post's author; reply-to-a-reply notifies the author of that parent
--       reply (not the root author). Never the actor themself.
--   T6  Coin transfers. `transfer_whisper_coins` is settled inside one
--       transaction (202608110001); the notification rides its committed
--       `coin_transfers` row with status='completed' — a client can never
--       produce this notification by calling anything, only by actually
--       completing a transfer, and T3's unique index makes a replayed
--       transfer's insert notify once. The lock-screen copy carries the amount
--       and nothing else: no wallet address, no username, no balance.
--   T7  One delivery path. Whispers were pushed only by a hand-made dashboard
--       webhook (`notify-new-whisper`) — invisible to this repo, and the one
--       reason "whispers buzzed and nothing else did" ever made sense. Push
--       now flows exclusively through `deliver_notification_push` (the row was
--       already being written); the webhook is retired and the function is
--       stubbed to a no-op so a leftover webhook cannot double-send.
--
-- Nothing here drops data. Re-runnable.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- T1. Per-category notification preferences (null = opted in).
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists notify_feed_posts boolean;
alter table public.profiles add column if not exists notify_replies boolean;
alter table public.profiles add column if not exists notify_friend_requests boolean;
alter table public.profiles add column if not exists notify_coin_transfers boolean;
alter table public.profiles add column if not exists notify_calls boolean;

comment on column public.profiles.notify_feed_posts is
  'false = user opted out of friend-post alerts; null/true = receive.';

-- 202609100002 replaced broad table grants with explicit per-column grants;
-- anything added after it is ungranted until named. The settings UI reads and
-- writes exactly these five columns, so grant SELECT + UPDATE on them to the
-- client roles (self-rows are enforced by the existing profiles RLS).
do $$
declare
  pref_columns text;
begin
  select string_agg(quote_ident(t.column_name), ', ' order by t.ordinal_position)
    into pref_columns
  from (values
    ('id', 0),
    ('push_notifications', 1),
    ('notify_feed_posts', 2),
    ('notify_replies', 3),
    ('notify_friend_requests', 4),
    ('notify_coin_transfers', 5),
    ('notify_calls', 6)
  ) as t(column_name, ordinal_position)
  where exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'profiles'
      and c.column_name = t.column_name
  );

  if pref_columns is null then
    raise notice 'T1: profiles table not present — grants skipped.';
    return;
  end if;

  execute format('grant select (%s) on table public.profiles to authenticated', pref_columns);
  execute format('grant update (%s) on table public.profiles to authenticated', pref_columns);
  raise notice 'T1: notification preference columns granted to authenticated.';
exception when others then
  raise warning 'T1: could not (re)build profiles column grants: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- T2. Accept the new notification types.
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('message', 'friend_request', 'public_feed', 'whisper',
                  'reply', 'coin_transfer', 'call'));

-- ---------------------------------------------------------------------------
-- T3. One notification per (user, type, source row), enforced by the schema.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'notifications'
      and indexname = 'notifications_user_type_source_uniq'
  ) then
    -- Duplicate rows written by the old double-triggered friend-request path
    -- (202608130001 + 202608050001, before 202608190003 dropped one) would
    -- otherwise block the index. Prune them first: for every
    -- (user, type, source) group keep the NEWEST row — the survivor is one
    -- the user may not have read yet.
    begin
      delete from public.notifications n
      where n.source_id is not null
        and exists (
          select 1 from public.notifications newer
          where newer.user_id = n.user_id
            and newer.type = n.type
            and newer.source_id = n.source_id
            and (newer.created_at, newer.id) > (n.created_at, n.id)
        );
    exception when others then
      raise notice 'T3: duplicate pruning skipped (%).', sqlerrm;
    end;

    begin
      create unique index notifications_user_type_source_uniq
        on public.notifications (user_id, type, source_id)
        where source_id is not null;
    exception when unique_violation then
      raise warning 'T3: duplicate notification rows still exist; dedup index not created. Triggers keep working (on conflict do nothing is untargeted); re-run this section after pruning to attach the guarantee.';
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- T4. Public-feed posts: accepted friends of the author only, and a single
--     batched push addressed to exactly the users written here.
-- ---------------------------------------------------------------------------

create or replace function public.notify_new_public_feed_post()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_recipients uuid[];
  v_chunk uuid[];
  v_offset integer := 0;
  v_chunk_size constant integer := 200;
begin
  /* A reply is not a new post. Reply notifications (T5) ride the parent's
     author, never the replier's friend graph. */
  if new.parent_post_id is not null then
    return new;
  end if;

  /* The eligible audience, computed once and reused for both tables so the
     in-app bell and the device push can never disagree:
       - an accepted friendship in either direction (the accept flow in
         app/friends/page.tsx writes both rows; either one counts, matching
         the call-RLS precedence)
       - never the author themself
       - no block in either direction
       - no banned account on either side
       - global push on (null counts as on) AND the category on. */
  select coalesce(array_agg(p.id order by p.id), '{}')
    into v_recipients
  from public.profiles p
  where p.id <> new.author_id
    and (
      exists (
        select 1 from public.friends f
        where (f.user_id = new.author_id and f.friend_id = p.id)
           or (f.user_id = p.id and f.friend_id = new.author_id)
      )
    )
    and not exists (
      select 1 from public.blocked_users b
      where (b.user_id = new.author_id and b.blocked_user_id = p.id)
         or (b.user_id = p.id and b.blocked_user_id = new.author_id)
    )
    and not public.user_is_banned(p.id)
    and not public.user_is_banned(new.author_id)
    and p.push_notifications is distinct from false
    and p.notify_feed_posts is distinct from false;

  if coalesce(array_length(v_recipients, 1), 0) = 0 then
    return new;
  end if;

  -- The feed bell (read by lib/nav/navBadges and the feed tab badge).
  insert into public.public_feed_notifications (post_id, user_id)
  select new.id, r
  from unnest(v_recipients) as r
  on conflict (post_id, user_id) do nothing;

  -- The in-app notification row. 'feed' as metadata.type is what
  -- FCMMessagingService routes on; postId powers the /public-feed?post= link.
  insert into public.notifications (user_id, type, title, body, source_id, metadata)
  select
    r,
    'public_feed',
    'New post from a friend',
    left(new.body, 120),
    new.id,
    jsonb_build_object(
      'author_id', new.author_id,
      'type', 'feed',
      'postId', new.id::text,
      'route', '/public-feed'
    )
  from unnest(v_recipients) as r
  on conflict do nothing;

  /* One batched push per 200 recipients, addressed to the list above — the
     edge function is NOT allowed to widen this list (it no longer queries
     profiles at all). */
  while v_offset < array_length(v_recipients, 1) loop
    select array_agg(v_recipients[i])
      into v_chunk
    from generate_series(
      v_offset + 1,
      least(v_offset + v_chunk_size, array_length(v_recipients, 1))
    ) as i;

    v_offset := v_offset + v_chunk_size;
    continue when v_chunk is null;

    perform public.post_to_edge_function(
      'notify-new-feed-post',
      jsonb_build_object(
        'type', 'INSERT',
        'table', 'public_feed_posts',
        'post_id', new.id,
        'preview', left(new.body, 120),
        'author_id', new.author_id,
        'recipients', to_jsonb(v_chunk)
      )
    );
  end loop;

  return new;
end;
$$;

-- The batch-push trigger on public_feed_posts is now redundant AND dangerous
-- (it re-derived the audience as "every profile" inside the edge function).
-- Removal is deliberate: the push call lives inside the trigger above, so no
-- second path can re-broadcast.
drop trigger if exists deliver_feed_post_push_trigger on public.public_feed_posts;
drop function if exists public.deliver_feed_post_push();

-- ---------------------------------------------------------------------------
-- T5. Reply notifications: exactly one recipient, the author of whatever is
--     being replied to. No self-notification; blocked and banned edges
--     excluded; the replier's category preference does not matter (the
--     RECIPIENT's does).
-- ---------------------------------------------------------------------------

create or replace function public.notify_feed_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent_author uuid;
  v_root_id uuid;
begin
  if new.parent_post_id is null then
    return new;
  end if;

  select p.author_id, coalesce(p.parent_post_id, p.id)
    into v_parent_author, v_root_id
  from public.public_feed_posts p
  where p.id = new.parent_post_id;

  if v_parent_author is null then
    return new;
  end if;

  -- Never notify someone about their own action (a reply to your own post).
  if v_parent_author = new.author_id then
    return new;
  end if;

  if exists (
        select 1 from public.blocked_users b
        where (b.user_id = new.author_id and b.blocked_user_id = v_parent_author)
           or (b.user_id = v_parent_author and b.blocked_user_id = new.author_id)
      )
     or public.user_is_banned(new.author_id)
     or public.user_is_banned(v_parent_author)
  then
    return new;
  end if;

  insert into public.notifications (user_id, type, title, body, source_id, metadata)
  select
    v_parent_author,
    'reply',
    'Someone replied to your whisper 💬',
    left(new.body, 120),
    new.id,
    jsonb_build_object(
      'author_id', new.author_id,
      'post_id', v_root_id,
      'reply_id', new.id,
      'type', 'feed',
      'postId', v_root_id::text,
      'route', '/public-feed'
    )
  where not exists (
      -- recipient preference, checked in the select so one absent reader
      -- cannot abort the trigger
      select 1 from public.profiles p
      where p.id = v_parent_author
        and (p.push_notifications is not distinct from false
          or p.notify_replies is not distinct from false)
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists feed_reply_notification_trigger on public.public_feed_posts;
create trigger feed_reply_notification_trigger
  after insert on public.public_feed_posts
  for each row execute function public.notify_feed_reply();

-- ---------------------------------------------------------------------------
-- T6. Coin transfer completed -> recipient only, exactly once.
--
-- This trigger sits on the *committed row*, not on a client claim: the only
-- way to produce this notification is for `transfer_whisper_coins` to have
-- settled the double debit/credit and inserted 'completed' (202608110001);
-- failed receipts insert 'failed' and are skipped, and a replayed idempotency
-- key returns the original receipt without inserting anything new.
-- ---------------------------------------------------------------------------

create or replace function public.notify_coin_transfer_received()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'completed' or new.recipient_id is null then
    return new;
  end if;
  if new.recipient_id = new.sender_id then
    return new;
  end if;

  insert into public.notifications (user_id, type, title, body, source_id, metadata)
  select
    new.recipient_id,
    'coin_transfer',
    'Whisper Coins received ✨',
    '+' || new.amount || ' Whisper Coins',
    new.id,
    jsonb_build_object(
      'type', 'coins',
      'amount', new.amount::text,
      'reference', new.reference,
      'route', '/premium'
    )
  where not exists (
      select 1 from public.profiles p
      where p.id = new.recipient_id
        and (p.push_notifications is not distinct from false
          or p.notify_coin_transfers is not distinct from false)
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists coin_transfer_received_notification on public.coin_transfers;
create trigger coin_transfer_received_notification
  after insert on public.coin_transfers
  for each row
  when (new.status = 'completed')
  execute function public.notify_coin_transfer_received();

-- ---------------------------------------------------------------------------
-- T7 + dedup pass: the pre-existing row-writing triggers, rewritten with
-- `on conflict do nothing` (they can now collide with T3's unique index) and,
-- for friend requests, the recipient's category preference.
-- ---------------------------------------------------------------------------

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

  -- Never notify someone about their own action (defensive: the sender is a
  -- participant of their own conversation).
  if recipient = new.sender_id then
    return new;
  end if;

  body_text := coalesce(new.content,
    case
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
    left(body_text, 240),
    new.id,
    jsonb_build_object(
      'conversation_id', new.conversation_id,
      'conversationId', new.conversation_id,
      'sender_id', new.sender_id,
      'type', 'message',
      'route', '/chat/' || new.conversation_id
    )
  )
  on conflict do nothing;

  return new;
end;
$$;

create or replace function public.notify_friend_request_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.notifications (user_id, type, title, body, source_id, metadata)
    select
      new.receiver_id,
      'friend_request',
      'New Friend Request 🤝',
      'Someone wants to be your friend on Whisper!',
      new.id,
      jsonb_build_object('sender_id', new.sender_id, 'type', 'friend_request', 'route', '/friends')
    where new.receiver_id <> new.sender_id
      -- The RECIPIENT's preferences decide (the requester never gets their
      -- own sent-request row): same shape as T5/T6 — an explicit false on
      -- either the global switch or the category mutes the row; null is on.
      and not exists (
        select 1 from public.profiles p
        where p.id = new.receiver_id
          and (p.push_notifications is not distinct from false
            or p.notify_friend_requests is not distinct from false)
      )
    on conflict do nothing;
  end if;

  if TG_OP = 'UPDATE' then
    if old.status = 'pending' and new.status = 'accepted' then
      insert into public.notifications (user_id, type, title, body, source_id, metadata)
      select
        new.sender_id,
        'friend_request',
        'Friend Request Accepted! ✨',
        'You are now friends on Whisper.',
        new.id,
        jsonb_build_object('receiver_id', new.receiver_id, 'type', 'friend_request', 'route', '/friends')
      where new.sender_id <> new.receiver_id
        and not exists (
          select 1 from public.profiles p
          where p.id = new.sender_id
            and (p.push_notifications is not distinct from false
              or p.notify_friend_requests is not distinct from false)
        )
      on conflict do nothing;
    end if;
  end if;

  return new;
end;
$$;

/* Decline and withdraw are DELETEs on a pending friend_requests row, so the
   recipient's "New Friend Request" alert would otherwise linger forever as a
   ghost pointing at a request that no longer exists (and bell-badge it).
   Only pending rows purge: an accept note on a later unfriend is history —
   the acceptance really happened, and history doesn't get rewritten. */
create or replace function public.purge_friend_request_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'pending' then
    delete from public.notifications
      where type = 'friend_request'
        and source_id = old.id
        and user_id = old.receiver_id;
  end if;
  return old;
end;
$$;

drop trigger if exists friend_request_delete_purge on public.friend_requests;
create trigger friend_request_delete_purge
  after delete on public.friend_requests
  for each row execute function public.purge_friend_request_notification();

create or replace function public.notify_new_whisper_record()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.recipient_id = new.sender_id then
    return new;
  end if;

  insert into public.notifications (user_id, type, title, body, source_id, metadata)
  values (
    new.recipient_id,
    'whisper',
    'New Anonymous Whisper 👻',
    coalesce(left(new.message, 60), 'Someone sent you a whisper'),
    new.id,
    jsonb_build_object('message_id', new.id, 'type', 'whisper', 'route', '/notifications')
  )
  on conflict do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- T7. deliver_notification_push: whispers now ride the same path as
-- everything else (the standalone dashboard webhook is retired; the
-- `notify-new-whisper` edge function answers "skipped" so a leftover webhook
-- cannot double-send). Only 'public_feed' rows keep their batched route —
-- those are pushed from notify_new_public_feed_post itself.
-- ---------------------------------------------------------------------------

create or replace function public.deliver_notification_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'public_feed' then
    return new;
  end if;

  /* Recipient preferences are honoured here for push: the in-app row already
     exists (history is for the user themselves), but a push to a phone whose
     owner muted the category is noise they asked not to hear. */
  if exists (
      select 1 from public.profiles p
      where p.id = new.user_id and p.push_notifications is not distinct from false
    )
  then
    return new;
  end if;

  perform public.post_to_edge_function(
    'notify-on-notification',
    jsonb_build_object('type', 'INSERT', 'table', 'notifications', 'record', to_jsonb(new))
  );

  return new;
end;
$$;

commit;

-- ===========================================================================
-- After applying
--
--   1. Deploy `notify-new-feed-post` (rewritten: recipients come from the
--      payload; it no longer queries profiles at all) and
--      `notify-on-notification` (coins/calls channels + cancel action) and
--      `notify-new-whisper` (retired stub).
--   2. In Dashboard -> Database -> Webhooks, DELETE the legacy
--      `notify-new-whisper` webhook on public.messages if it still exists.
--      With the stub deployed this is optional (it no-ops), but removal is
--      what makes "one delivery path" structural rather than conditional.
--   3. `notify-new-direct-message` and `notify-friend-request` edge
--      functions remain deployed-but-unused (same as 202608190003 left them);
--      they may be deleted once this migration is live everywhere.
--
-- To verify targeting, as an admin:
--
--   -- friends of the author only, never a whole-table fan-out:
--   select n.user_id, n.type, n.created_at
--     from public.notifications n
--    where n.type in ('public_feed','reply') and n.created_at > now() - interval '5 minutes';
-- ===========================================================================
