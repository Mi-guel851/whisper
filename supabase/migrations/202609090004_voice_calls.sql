-- 1:1 in-app voice calls: call logs + missed-call notifications.
--
-- WHAT THIS TABLE IS
--
-- A log, not a media store. The audio itself flows device-to-device over
-- WebRTC and never touches Supabase — there is nothing here to record, play
-- back or subpoena, because nothing was ever written. call_logs answers "did
-- this happen, when, and was it missed", which the app needs for the
-- missed-call notification and (someday) the in-app call history.
--
-- THE MISSED-CALL NOTIFICATION
--
-- Reuses the existing notify-* push pattern end to end: a notifications row
-- typed 'message' (so the FCM route, the messages vibration channel and the
-- /chat/<id> deep link all resolve exactly like an ordinary chat message)
-- with metadata carrying the conversation keys. The row insert fires the
-- pre-existing deliver_notification_push_trigger (202608190003), which
-- pg_net-posts to the notify-on-notification edge function — no new edge
-- function, no new webhook, no new channel to drift out of sync.
--
-- The trigger fires on the INSERT-or-UPDATE transition INTO missed=true
-- rather than on plain INSERT, because the honest lifecycle is: the caller
-- inserts the row when the call starts (missed=false), and only flips it to
-- missed if the call ends before the other side ever answered. A trigger
-- that fired on every call_log insert would notify for calls that connected
-- fine, and there is no way to un-send an FCM message.
--
-- RLS
--
--   select  — participants only (via the conversations join, the same shape
--             every read in this schema uses).
--   insert  — the CALLER, a participant, and only inside an ACCEPTED
--             friendship. That last clause mirrors the UI exactly (the call
--             button only renders for accepted friends) and stops a pending-
--             thread participant from spamming missed-call notifications at
--             the other side: a missed-call push is a friend-level thing.
--   update  — participants only (setting ended_at / missed).
--   delete  — no policy. A log that can be deleted by its subject is an
--             evidence store in name only.

create table if not exists public.call_logs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  missed boolean not null default false,
  created_at timestamptz not null default now(),
  check (caller_id <> callee_id)
);

create index if not exists call_logs_conversation_idx
  on public.call_logs (conversation_id, started_at desc);
create index if not exists call_logs_callee_idx
  on public.call_logs (callee_id, started_at desc);

alter table public.call_logs enable row level security;

drop policy if exists "Participants can view call logs" on public.call_logs;
create policy "Participants can view call logs" on public.call_logs
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = call_logs.conversation_id
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

drop policy if exists "Callers can log calls inside accepted friendships" on public.call_logs;
create policy "Callers can log calls inside accepted friendships" on public.call_logs
  for insert with check (
    auth.uid() = caller_id
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
    and exists (
      select 1 from public.friends f
      where (f.user_id = auth.uid() and f.friend_id = callee_id)
         or (f.user_id = callee_id and f.friend_id = auth.uid())
    )
  );

drop policy if exists "Participants can close call logs" on public.call_logs;
create policy "Participants can close call logs" on public.call_logs
  for update using (
    exists (
      select 1 from public.conversations c
      where c.id = call_logs.conversation_id
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = call_logs.conversation_id
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Missed-call notification
-- ---------------------------------------------------------------------------

create or replace function public.notify_missed_call()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.missed and not coalesce(old.missed, false) then
    insert into public.notifications (user_id, type, title, body, source_id, metadata)
    values (
      new.callee_id,
      'message',
      'Missed Voice Call 📞',
      'An anonymous friend called you while you were away.',
      new.id,
      -- snake_case for the in-app list, camelCase for the Android intent —
      -- the same dual spelling notify_new_direct_message uses, because
      -- FCMMessagingService reads data.get("conversationId").
      jsonb_build_object(
        'conversation_id', new.conversation_id,
        'conversationId', new.conversation_id,
        'caller_id', new.caller_id,
        'type', 'message'
      )
    );
  end if;
  return new;
end;
$$;

do $$
begin
  drop trigger if exists call_log_missed_notification on public.call_logs;
  create trigger call_log_missed_notification
    after insert or update of missed on public.call_logs
    for each row execute function public.notify_missed_call();
  raise notice 'Missed-call notification attached to public.call_logs.';
exception when undefined_table then
  raise warning 'Missed-call notification skipped: public.call_logs does not exist in this environment.';
end $$;
