-- ===========================================================================
-- A user stops being "busy" when their call is dead, and a call that is over
-- stops ringing.
--
-- THREE BUGS, ALL ABOUT STATE OUTLIVING THE CALL
--
-- 1. "They're on another call" OUTLIVED THE CALL.
--
--    start_call_log called a peer busy while they had any `answered` row
--    with no end that was younger than FOUR HOURS (202609120003). Four hours
--    was chosen to be safer than a wrong busy verdict; the price was a user
--    whose app was killed mid-call — the WebView paused, the transport died,
--    end_call_log never ran — being told "on another call" by everyone who
--    tried to reach them for up to four hours, until their own app happened
--    to resume (force_clear_my_calls) or a daily cron swept the row.
--
--    A call this app carries is a voice chat the client closes at hang-up on
--    EITHER side; an `answered` row that is still open ten minutes after its
--    ring is a dead device, not a long conversation. The live window is now
--    TEN MINUTES. A genuinely long live call loses nothing: the callee's own
--    engine still answers a second offer with a `busy` signal, so a long call
--    is busy for the right reason (a person is on it), not by row age.
--
-- 2. A CANCELED CALL KEPT RINGING THE CALLEE'S APP.
--
--    The callee's `notifications` row typed 'call' is the ring: the open app
--    renders the overlay from its INSERT, and a cold start re-shows the ring
--    from any UNREAD row still inside the 60-second window. Only the
--    `answered` transition marked that row read. So when the caller hung up
--    (canceled), timed out (missed), or the sweep expired the ring, the row
--    stayed unread — and every path that looks for unread call rows rang the
--    dead call again. A tap on the stale push notification was the worst of
--    it: it built a fresh ring from the payload with no row check at all.
--
--    Every legal transition now retires the row. The UPDATE rides the
--    realtime publication: the open app's ring stands down on the same event
--    (cancelRing), and the cold-start query (is_read = false) simply finds
--    nothing. The client verifies payload rings against this same row
--    (lib/calls/callSession.ts) for the last race — a tap that lands after
--    the end.
--
-- 3. THE CRON SWEEP LEFT THE RING ROW BEHIND.
--
--    expire_stale_calls closed the call row and pushed the "missed" entry,
--    but the 'call' ring row it expired stayed unread — a missed call rang
--    again on the next cold start inside the window. The sweep marks it read
--    now, in the same loop that closes the row.
--
-- Nothing here drops data. Re-runnable: three create-or-replace of the
-- functions 202609120003 left in place, same signatures, same grants.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. start_call_log: a dead call is busy for ten minutes, not four hours.
--    Body otherwise identical to 202609120003.
-- ---------------------------------------------------------------------------

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
  -- Beyond this, an 'answered' row is an orphan, not a live call. Ten
  -- minutes is far longer than the ring + connect budget (60s + 25s) and
  -- far shorter than the four hours that used to make a killed device's
  -- owner unreachable. Live calls longer than this stay busy by the
  -- client's own busy signal, not by row age.
  v_live_window interval := interval '10 minutes';
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

  -- Busy is a live call, and only a live call.
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
-- 2. end_call_log: EVERY legal transition retires the callee's ring row.
--    Transition table and notifications otherwise identical to 202609120003.
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

  -- The ring row retires on EVERY legal transition, not just the answer.
  -- It is what the open app renders the overlay from and what a cold start
  -- looks for (unread 'call' rows inside the window); a call that is over —
  -- answered elsewhere, declined, canceled by the caller, missed, failed,
  -- completed — must never ring again. user_id is the CALLEE, not v_me: the
  -- caller's own hang-up is the event that reads the CALLEE's row. The UPDATE
  -- rides the realtime publication, so the overlay stands down on the same
  -- event (cancelRing) and the cold-start query finds nothing.
  update public.notifications set is_read = true
   where source_id = v_log.id and type = 'call' and user_id = v_log.callee_id;

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
-- 3. expire_stale_calls: the sweep retires the ring row it expires, and its
--    orphan window matches the busy check (ten minutes).
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

    -- The ring this expiry is about: an expired call must not ring again on
    -- the next cold start inside its window.
    update public.notifications set is_read = true
     where source_id = v_row.id and type = 'call';

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
     because an open one is what made the user busy. Ten minutes: the same
     window the lazy sweep inside start_call_log uses, so a killed device
     stops blocking its friends the moment anyone dials, and this sweep is
     only the backstop for a user who never returns. */
  update public.call_logs
     set status = 'failed', ended_at = now()
   where status = 'answered'
     and ended_at is null
     and started_at < now() - interval '10 minutes';

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
--   * Deploy the Next.js client from the same release: it verifies payload
--     rings against call_logs (a tap on a stale push no longer rings a dead
--     call), and it answers a second dialer with busy while it is already
--     ringing.
--   * Verify:
--       - a call the caller cancels: the callee's 'call' notifications row is
--         is_read = true the moment the row is canceled;
--       - an answered row 11 minutes old with ended_at NULL no longer makes
--         start_call_log return {status:'busy'} — and the lazy sweep closes
--         it as 'failed' in the same call;
--       - a live call (both clients up) is still busy to a third dial while
--         it lasts, via the engine's busy signal, and the row closes at
--         hang-up on either side.
-- ===========================================================================
