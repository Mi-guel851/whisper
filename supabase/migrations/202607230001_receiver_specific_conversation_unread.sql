alter table public.conversations
  add column if not exists last_message_sender_id uuid references auth.users(id) on delete set null;

update public.conversations c
set last_message_sender_id = latest.sender_id
from (
  select distinct on (conversation_id) conversation_id, sender_id
  from public.direct_messages
  order by conversation_id, created_at desc
) latest
where c.id = latest.conversation_id
  and c.last_message_sender_id is null;

create index if not exists conversations_last_message_sender_id_idx
  on public.conversations (last_message_sender_id);
