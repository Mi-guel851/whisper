-- ---------------------------------------------------------------------------
-- Inbox ordering: make conversations.last_message_at server-authoritative.
--
-- The inbox (app/inbox/page.tsx) orders the chat list by
-- conversations.last_message_at, and the row timestamp is the same column.
-- Until now that column was written ONLY by the sending device, as a
-- fire-and-forget PostgREST update a few lines after the message insert
-- (app/chat/[conversationId]/page.tsx), stamped with the phone's own clock.
--
-- Any one of these left a chat sitting in the wrong place — the message
-- arrived, the list didn't move:
--
--   * the device's update request dropped (flaky cellular, app killed in the
--     gap between the two round trips, a 5xx on the second request);
--   * the device clock skew. A phone 30 minutes slow stamped "now" as an hour
--     ago, so the chat the user JUST had sorted below yesterday's chats.
--
-- The column now belongs to the database: a trigger on direct_messages
-- stamps the conversation from the inserted row's own created_at — server
-- time, atomic with the insert, impossible to lose. The chat page's
-- client-side writes are removed in the same change; keeping them would let
-- a skewed device clock overwrite the authoritative value a millisecond
-- later. Realtime still fires for both participants (the trigger's UPDATE is
-- a conversations change), so both inboxes re-sort.
--
-- A one-shot repair re-derives the stamp for every existing conversation, so
-- the list is correct the moment this applies — not just for new messages.
-- ---------------------------------------------------------------------------

create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         last_message_sender_id = new.sender_id
   where id = new.conversation_id;
  return new;
end;
$$;

-- Invoked by the trigger engine only. A direct CALL would still be bound by
-- the same reality as the insert itself: the insert policy on
-- direct_messages requires auth.uid() = sender_id AND
-- can_send_direct_message(conversation_id, sender_id), so no caller can make
-- the trigger touch a conversation they are not already in.
revoke all on function public.touch_conversation_on_message() from public, anon, authenticated;

drop trigger if exists direct_messages_touch_conversation on public.direct_messages;
create trigger direct_messages_touch_conversation
  after insert on public.direct_messages
  for each row
  execute function public.touch_conversation_on_message();

-- One-shot repair: every conversation's stamp re-derived from its newest
-- message. `id desc` breaks two messages sharing a created_at the same way
-- the inbox preview does. Conversations whose messages were all deleted are
-- untouched — there is no last message to point at.
update public.conversations c
   set last_message_at = m.created_at,
       last_message_sender_id = m.sender_id
  from (
    select distinct on (conversation_id) conversation_id, created_at, sender_id
    from public.direct_messages
    order by conversation_id, created_at desc, id desc
  ) m
 where c.id = m.conversation_id;

-- ---------------------------------------------------------------------------
-- Exact previews: one row per conversation, from the database.
--
-- The inbox's windowed preview query (600 newest rows across all
-- conversations, first row per conversation wins) is correct unless one heavy
-- thread fills the whole window — then the quieter threads get no preview at
-- all and their rows read "Tap to open the conversation" instead of their
-- last message. This returns the true latest row per requested conversation.
--
-- definer skips RLS, so membership is re-asserted in the body — the same
-- shape unread_message_counts (202609070001) uses: only conversations the
-- caller is actually in.
-- ---------------------------------------------------------------------------
create or replace function public.inbox_message_previews(p_conversation_ids uuid[])
returns setof public.direct_messages
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (m.conversation_id) m.*
  from public.direct_messages m
  where m.conversation_id = any (coalesce(p_conversation_ids, '{}'))
    and exists (
      select 1 from public.conversations c
      where c.id = m.conversation_id
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  order by m.conversation_id, m.created_at desc, m.id desc;
$$;

revoke all on function public.inbox_message_previews(uuid[]) from public, anon;
grant execute on function public.inbox_message_previews(uuid[]) to authenticated;

-- Full `(conversation_id, created_at desc)` index: the unread one from
-- 202609070001 is partial (read_at is null) and cannot serve this scan. Also
-- serves the chat transcript's newest-first fetches.
create index if not exists direct_messages_conversation_time_idx
  on public.direct_messages (conversation_id, created_at desc);
