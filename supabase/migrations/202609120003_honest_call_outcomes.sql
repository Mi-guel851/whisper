-- ===========================================================================
-- An honest call log, and no more permanently-busy users.
--
-- THE TWO BUGS
--
-- 1. A CALL THAT NEVER CONNECTED WAS LOGGED AS A CALL.
--
--    `end_call_log` had one word for "this ended after someone picked up":
--    `completed`. But "picked up" and "connected" are different events, and
--    the client only kept one flag for both. Two people behind carrier NAT
--    with no relay between them get as far as Accept, sit on "Connecting…"
--    for 25 seconds, and the row was then written
--
--        status = 'completed', started_at = <the ring>, ended_at = <give-up>
--
--    which the chat timeline renders as "Voice call · 0:25" — a duration for
--    a conversation that never carried a word. The client now keeps the two
--    apart (see `connected` in lib/calls/callSession.ts) and reports
--    `failed`, and this migration gives that word somewhere to live.
--
--    `answered_at` is added for the same reason from the other direction:
--    the duration of a real call is the time between picking up and hanging
--    up, not between the ring starting and hanging up. Rows that predate this
--    have no `answered_at` and the client falls back to `started_at`.
--
-- 2. A DEAD CALL MADE A USER UNREACHABLE FOREVER.
--
--    `start_call_log` refused a call as "busy" when the peer had ANY row with
--    status = 'answered' and ended_at IS NULL. A call whose device died
--    mid-conversation — app swiped away, phone off, WebView killed — never
--    reached end_call_log, so its row stayed 'answered' with a NULL ended_at
--    indefinitely, and nothing swept it: expire_stale_calls only looked at
--    'ringing' rows. The result was a user nobody could ever call again, with
--    every caller told "They're on another call right now."
--
--    The lazy sweep inside start_call_log and the cron sweep now both close
--    orphaned 'answered' rows, and the busy check only believes an 'answered'
--    row that is plausibly still live.
--
-- Also here: start_call_log collapses to ONE signature. Two overloads had
-- accumulated (202609100006's 2-arg, 202609120001's 3-arg with a default), so
-- a client calling it with two arguments silently ran the older body and its
-- older busy logic. One function, one behaviour.
--
-- Nothing here drops data. Re-runnable.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The new vocabulary: `failed`, and the moment the call was actually taken.
-- ---------------------------------------------------------------------------

alter table public.call_logs add column if not exists answered_at timestamptz;

/* Backfill: a row that completed was answered at some point. `started_at` is
   the only estimate available for history, and the client reads this column
   as a preference over `started_at` rather than a requirement. */
update public.call_logs
   set answered_at = started_at
 where answered_at is null
   and status in ('answered', 'completed');

/* `status` carries a CHECK constraint created inline in 202609100006, so the
   new value means replacing the constraint rather than editing it. */
alter table public.call_logs drop constraint if exists call_logs_status_check;
alter table public.call_logs add constraint call_logs_status_check
  check (status in ('ringing','answered','declined','canceled','missed','expired','completed','busy','failed'));

drop index if exists public.call_logs_open_idx;
create index call_logs_open_idx
  on public.call_logs (status, started_at)
  where status in ('ringing','answered');

-- ---------------------------------------------------------------------------
-- 2. end_call_log: `failed` is a legal ending, answering stamps its time.
-- ---------------------------------------------------------------------------

create or replace function public.end_call_log(p_call_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_log public.call_logs;
  v_next text;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_call_id is null or p_outcome is null then
    raise exception 'call_id and outcome are required' using errcode = '22023';
  end if;

  select * into v_log from public.call_logs
  where call_id = p_call_id and (caller_id = v_me or callee_id = v_me)
  for update;

  if not found then
    raise exception 'Call not found' using errcode = 'P0002';
  end if;

  v_next := case
    -- The caller ending a call nobody took. `failed` is legal from `ringing`
    -- too: the callee's `answered` write and the caller's give-up are a race,
    -- and the loser of it must still be able to close the row honestly.
    when v_me = v_log.caller_id and v_log.status = 'ringing'
         and p_outcome in ('canceled', 'missed', 'failed') then p_outcome
    -- A call that was picked up. Either participant may end it, as either a
    -- call that happened or a call that never connected.
    when v_log.status = 'answered'
         and p_outcome in ('completed', 'failed') then p_outcome
    -- The callee's own verdict on a ring.
    when v_me = v_log.callee_id and v_log.status = 'ringing'
         and p_outcome in ('answered', 'declined', 'busy', 'failed') then p_outcome
    else null
  end;

  if v_next is null then
    return jsonb_build_object('status', v_log.status, 'ignored', true,
                              'id', v_log.id, 'call_id', v_log.call_id);
  end if;

  update public.call_logs
     set status = v_next,
         missed = (v_next in ('missed', 'expired')),
         answered_at = case when v_next = 'answered'
                            then coalesce(answered_at, now())
                            else answered_at end,
         ended_at = case when v_next = 'answered' then ended_at else now() end
   where id = v_log.id;

  if v_next = 'answered' then
    -- The alert already reached them; retire it from the unread list instead
    -- of leaving an "Incoming call" row for a call they just took.
    update public.notifications set is_read = true
     where source_id = v_log.id and type = 'call' and user_id = v_me;
  end if;

  if v_next in ('missed', 'expired') then
    -- The chat-visible "missed" for the callee. Title/body deliberately say
    -- nothing sensitive: no caller name, no balance, no message text.
    insert into public.notifications (user_id, type, title, body, source_id, metadata)
    select
      v_log.callee_id,
      'message',
      'Missed Voice Call 📞',
      'An anonymous friend called you while you were away.',
      v_log.id,
      jsonb_build_object(
        'conversation_id', v_log.conversation_id,
        'conversationId', v_log.conversation_id,
        'caller_id', v_log.caller_id,
        'call_id', v_log.call_id,
        'type', 'message',
        'route', '/chat/' || v_log.conversation_id
      )
    from public.profiles p
    where p.id = v_log.callee_id
      and p.push_notifications is distinct from false
      and p.notify_calls is distinct from false
    on conflict do nothing;
  end if;

  /* A call that never connected is NOT a missed call — both people were
     there, and one of them pressed a button. No missed-call row for it; the
     chat timeline carries the entry, and the device banner is retired by the
     cancel below like every other ending. */
  perform public.post_to_edge_function(
    'notify-on-notification',
    jsonb_build_object(
      'action', 'cancel',
      'user_id', v_log.callee_id,
      'call_id', v_log.call_id
    )
  );

  return jsonb_build_object('status', v_next, 'id', v_log.id, 'call_id', v_log.call_id);
end;
$$;

revoke all on function public.end_call_log(uuid, text) from public, anon;
grant execute on function public.end_call_log(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. start_call_log: one signature, and a busy check that cannot be a trap.
--
--    Body otherwise identical to 202609120001 (the version the client calls),
--    plus the orphan sweep for BOTH non-terminal statuses.
-- ---------------------------------------------------------------------------

/* The 2-arg overload from 202609100006 is dropped on purpose: with both
   present, a two-argument call resolved to the older body. One function with
   a defaulted parameter serves both call shapes. */
drop function if exists public.start_call_log(uuid, uuid);

create or replace function public.start_call_log(
  p_call_id uuid,
  p_conversation_id uuid,
  p_force_clear_stale boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_convo record;
  v_peer uuid;
  v_log public.call_logs;
  v_ring_id uuid;
  -- Beyond this, an 'answered' row is an orphan, not a live call. Four hours
  -- is far longer than any call this app sees and far shorter than "forever",
  -- which is what an un-swept row used to mean for the peer's dialability.
  v_live_window interval := interval '4 hours';
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_call_id is null or p_conversation_id is null then
    raise exception 'call_id and conversation_id are required' using errcode = '22023';
  end if;

  select * into v_convo from public.conversations
  where id = p_conversation_id and (user_a = v_me or user_b = v_me);
  if not found then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  v_peer := case when v_convo.user_a = v_me then v_convo.user_b else v_convo.user_a end;

  if not exists (
    select 1 from public.friends f
    where (f.user_id = v_me and f.friend_id = v_peer)
       or (f.user_id = v_peer and f.friend_id = v_me)
  ) then
    raise exception 'Calls are only available between accepted friends.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.blocked_users b
    where (b.user_id = v_me and b.blocked_user_id = v_peer)
       or (b.user_id = v_peer and b.blocked_user_id = v_me)
  ) then
    raise exception 'Cannot start a call.' using errcode = '42501';
  end if;

  if public.user_is_banned(v_me) or public.user_is_banned(v_peer) then
    raise exception 'This account cannot place calls.' using errcode = 'WH001';
  end if;

  -- Caller asked to clear stale rings before the busy check (a callee who
  -- tapped the notification and landed on the call screen must not read as
  -- busy to their own next attempt).
  if p_force_clear_stale then
    update public.call_logs cl
       set status = 'canceled',
           ended_at = coalesce(ended_at, now())
     where cl.status = 'ringing'
       and (cl.caller_id = v_me or cl.callee_id = v_me)
       and cl.started_at < now() - interval '30 seconds';
  end if;

  -- Lazy expiry, both parties, both non-terminal statuses. `ringing` past its
  -- window is a dead ring; `answered` past the live window is a call whose
  -- device died without ever reaching end_call_log.
  update public.call_logs cl
     set status = 'expired', ended_at = coalesce(ended_at, now()), missed = true
   where cl.status = 'ringing'
     and cl.started_at < now() - interval '60 seconds'
     and (cl.caller_id = v_me or cl.callee_id = v_me or cl.caller_id = v_peer or cl.callee_id = v_peer);

  update public.call_logs cl
     set status = 'failed', ended_at = coalesce(ended_at, now())
   where cl.status = 'answered'
     and cl.ended_at is null
     and cl.started_at < now() - v_live_window
     and (cl.caller_id = v_me or cl.callee_id = v_me or cl.caller_id = v_peer or cl.callee_id = v_peer);

  -- Busy is a live call, and only a live call. An `answered` row with no end
  -- used to be busy indefinitely, which is how one dead call made a user
  -- permanently unreachable.
  if exists (
    select 1 from public.call_logs cl
    where cl.status = 'answered'
      and (cl.caller_id = v_peer or cl.callee_id = v_peer)
      and cl.ended_at is null
      and cl.started_at > now() - v_live_window
  ) then
    return jsonb_build_object('status', 'busy');
  end if;

  insert into public.call_logs (call_id, conversation_id, caller_id, callee_id, status)
  values (p_call_id, p_conversation_id, v_me, v_peer, 'ringing')
  on conflict (call_id) where call_id is not null do nothing;

  if not found then
    select * into v_log from public.call_logs where call_id = p_call_id;
    if not found or v_log.caller_id <> v_me then
      raise exception 'Call not found' using errcode = 'P0002';
    end if;
    return jsonb_build_object(
      'status', v_log.status, 'id', v_log.id, 'call_id', v_log.call_id,
      'started_at', v_log.started_at, 'conversation_id', v_log.conversation_id,
      'replayed', true
    );
  end if;

  select * into v_log from public.call_logs where call_id = p_call_id;

  insert into public.notifications (user_id, type, title, body, source_id, metadata)
  select
    v_peer,
    'call',
    'Incoming call 📞',
    'A friend is calling you on Whisper.',
    v_log.id,
    jsonb_build_object(
      'type', 'call',
      'call_id', v_log.call_id,
      'callId', v_log.call_id,
      'conversation_id', v_log.conversation_id,
      'conversationId', v_log.conversation_id,
      'caller_id', v_me,
      'route', '/chat/' || v_log.conversation_id
    )
  from public.profiles p
  where p.id = v_peer
    and p.notify_calls is distinct from false
  on conflict do nothing
  returning id into v_ring_id;

  return jsonb_build_object(
    'status', 'ringing', 'id', v_log.id, 'call_id', v_log.call_id,
    'started_at', v_log.started_at, 'conversation_id', v_log.conversation_id,
    'callee_id', v_peer,
    'alerted', v_ring_id is not null
  );
end;
$$;

revoke all on function public.start_call_log(uuid, uuid, boolean) from public, anon;
grant execute on function public.start_call_log(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The cron sweep: orphaned answered rows too, so a dead call stops
--    blocking the next one even if nobody ever opens the app again.
-- ---------------------------------------------------------------------------

create or replace function public.expire_stale_calls()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired integer := 0;
  v_row record;
  v_orphans integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  for v_row in
    select id, call_id, callee_id, caller_id, conversation_id
    from public.call_logs
    where status = 'ringing'
      and started_at < now() - interval '60 seconds'
    for update
  loop
    update public.call_logs
       set status = 'expired', ended_at = now(), missed = true
     where id = v_row.id;

    insert into public.notifications (user_id, type, title, body, source_id, metadata)
    select
      v_row.callee_id,
      'message',
      'Missed Voice Call 📞',
      'An anonymous friend called you while you were away.',
      v_row.id,
      jsonb_build_object(
        'conversation_id', v_row.conversation_id,
        'conversationId', v_row.conversation_id,
        'caller_id', v_row.caller_id,
        'call_id', v_row.call_id,
        'type', 'message',
        'route', '/chat/' || v_row.conversation_id
      )
    from public.profiles p
    where p.id = v_row.callee_id
      and p.push_notifications is distinct from false
      and p.notify_calls is distinct from false
    on conflict do nothing;

    perform public.post_to_edge_function(
      'notify-on-notification',
      jsonb_build_object('action', 'cancel', 'user_id', v_row.callee_id, 'call_id', v_row.call_id)
    );

    v_expired := v_expired + 1;
  end loop;

  /* Orphaned answered rows. Nobody is notified — this is bookkeeping for a
     call that already ended somewhere we cannot see — but the row must close,
     because an open one is what made the user permanently busy. */
  update public.call_logs
     set status = 'failed', ended_at = now()
   where status = 'answered'
     and ended_at is null
     and started_at < now() - interval '4 hours';

  GET DIAGNOSTICS v_orphans = ROW_COUNT;

  return v_expired + v_orphans;
end;
$$;

revoke all on function public.expire_stale_calls() from public, anon, authenticated;
grant execute on function public.expire_stale_calls() to service_role;

commit;

-- ===========================================================================
-- After applying
--
--   * Deploy the Next.js client from the same release. It reports `failed`
--     for a picked-up call that never connected; an older database would
--     reject the outcome as an illegal transition and the engine would fall
--     back to its legacy update, so the two must ship together.
--   * The cron sweep (/api/calls/sweep, vercel.json) now also closes orphaned
--     answered rows. It runs DAILY on a Hobby plan, so it is the backstop, not
--     the fix: dialability is restored the moment anyone tries to call, by the
--     lazy sweep inside start_call_log, and for the user's own rows the moment
--     they next open the app, which calls force_clear_my_calls.
--   * Verify:
--       - end_call_log(<a ringing call>, 'failed') writes status 'failed';
--       - an answered row older than 4h no longer makes start_call_log return
--         {status:'busy'};
--       - select count(*) from call_logs where status='answered' and
--         ended_at is null and started_at < now() - interval '4 hours'  ->  0
-- ===========================================================================
