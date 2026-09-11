-- ===========================================================================
-- The incoming-call ring must reach an app that is already open, even for a
-- user who has push notifications switched off.
--
-- WHY
--
-- `start_call_log` writes the callee's `notifications` row typed 'call'. That
-- row does two jobs: it is the payload for the FCM push, and it is the event
-- the open app renders the full-screen incoming-call overlay from
-- (components/calls/CallSessionProvider.tsx subscribes to INSERTs on it).
--
-- Until now the insert was gated on BOTH `push_notifications` and
-- `notify_calls`. So turning push off — a choice about a device's lock screen
-- — also silently disabled in-app ringing: a callee sitting on the dashboard
-- with the app in front of them never saw the call at all. The only ring they
-- could get was the live broadcast offer, which requires that exact
-- conversation's chat page to be open.
--
-- WHAT CHANGES
--
-- The row is gated on `notify_calls` alone. Push delivery is unaffected and
-- stays preference-correct, because notify-on-notification re-reads
-- `profiles.push_notifications` and skips the send when it is false
-- (supabase/functions/notify-on-notification/index.ts). So:
--
--   push off, calls on  -> ring in the app, no push      (was: nothing at all)
--   push on,  calls on  -> ring in the app, plus a push  (unchanged)
--   calls off           -> no row, no ring, no push      (unchanged)
--
-- The body of `start_call_log` is otherwise byte-identical to the version in
-- 202609100006; only the WHERE clause and its comment differ. Re-runnable.
-- ===========================================================================

begin;

create or replace function public.start_call_log(p_call_id uuid, p_conversation_id uuid)
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

  -- Calls exist only between ACCEPTED friends. The `friends` table is the
  -- acceptance record (pending requests never reach it), checked in either
  -- direction so a half-removed friendship cannot still start calls.
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

  -- C5, lazy half: any call of ours still 'ringing' beyond its window was
  -- orphaned by a dead tab/device. Expire it first so state is honest.
  update public.call_logs cl
     set status = 'expired', ended_at = coalesce(ended_at, now()), missed = true
   where cl.status = 'ringing'
     and cl.started_at < now() - interval '60 seconds'
     and (cl.caller_id = v_me or cl.callee_id = v_me);

  -- The peer is genuinely busy right now (ringing elsewhere, or on a live
  -- call): refuse before creating any row, so a busy attempt cannot become a
  -- phantom missed entry.
  if exists (
    select 1 from public.call_logs cl
    where (cl.callee_id = v_peer and cl.status = 'ringing' and cl.started_at > now() - interval '60 seconds')
       or (cl.caller_id = v_peer and cl.status = 'answered')
       or (cl.callee_id = v_peer and cl.status = 'answered')
  ) then
    return jsonb_build_object('status', 'busy');
  end if;

  insert into public.call_logs (call_id, conversation_id, caller_id, callee_id, status)
  values (p_call_id, p_conversation_id, v_me, v_peer, 'ringing')
  on conflict (call_id) where call_id is not null do nothing;

  if not found then
    -- Retry with a call_id the server already has: hand back the original.
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

  -- Incoming-call alert for the callee. The
  -- unique index from 202609100004 makes the (user, type, source) triple
  -- structurally once-per-call; `on conflict` keeps a legacy database without
  -- it from raising inside this transaction.
  --
  -- 202609110002: gated on `notify_calls` ALONE, not on `push_notifications`.
  -- This row is not only a push — it is what the open app renders the
  -- full-screen ring from. Gating it on the global push switch meant a user who
  -- had turned push off never saw an incoming call even while staring at the
  -- app, which is not a preference anyone asked for. Push delivery is still
  -- preference-correct: notify-on-notification re-reads `push_notifications`
  -- and skips the send, so the row existing changes nothing about what reaches
  -- a device. `notify_calls` stays the one switch that removes the ring.
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

revoke all on function public.start_call_log(uuid, uuid) from public, anon;
grant execute on function public.start_call_log(uuid, uuid) to authenticated;

commit;
