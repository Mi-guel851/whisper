-- ---------------------------------------------------------------------------
-- Inbox activity rows: sort from the message that is actually last.
--
-- `conversations.last_message_at` is repaired by 202609100004 for new writes,
-- but this read remains exact when an older client or an interrupted legacy write
-- left that denormalized column behind. The lateral lookup returns the latest
-- message per conversation before the 300-row cap is applied, so a busy thread
-- cannot push a recently active quieter thread out of the inbox window.
-- ---------------------------------------------------------------------------

create or replace function public.inbox_conversations()
returns table (
  id uuid,
  user_a uuid,
  user_b uuid,
  user_a_last_read_at timestamptz,
  user_b_last_read_at timestamptz,
  last_message_at timestamptz,
  last_message_sender_id uuid,
  latest_message_at timestamptz,
  latest_message_sender_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.user_a,
    c.user_b,
    c.user_a_last_read_at,
    c.user_b_last_read_at,
    c.last_message_at,
    c.last_message_sender_id,
    latest.created_at as latest_message_at,
    latest.sender_id as latest_message_sender_id
  from public.conversations as c
  left join lateral (
    select dm.created_at, dm.sender_id
    from public.direct_messages as dm
    where dm.conversation_id = c.id
    order by dm.created_at desc, dm.id desc
    limit 1
  ) as latest on true
  where c.user_a = auth.uid() or c.user_b = auth.uid()
  order by coalesce(latest.created_at, c.last_message_at) desc nulls last, c.id
  limit 300;
$$;

revoke all on function public.inbox_conversations() from public, anon;
grant execute on function public.inbox_conversations() to authenticated;
