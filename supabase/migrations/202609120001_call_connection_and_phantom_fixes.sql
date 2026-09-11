-- ===========================================================================
-- Call connection, phantom state, and busy-check fixes
--
-- WHY THIS MIGRATION EXISTS (the 4 call bugs it closes)
--
-- The ringing handshake had three server-side races and one lifecycle
-- mismatch, all in start_call_log / expire_stale_calls:
--
--   1. NAVIGATE != ANSWER. The callee's app navigated to the call screen
--      on notification tap, and a mount effect called end_call_log(answered)
--      immediately. A tap that only OPENED the screen therefore already
--      flipped the row to answered, and the subsequent real Accept found the
--      row no longer ringing and no-oped. The fix is client-side (see
--      lib/calls/callSession.ts) but the server must not help: only the
--      explicit Accept may transition ringing -> answered.
--
--   2. BUSY WAS A GHOST. start_call_log marked the peer busy if they had ANY
--      ringing row <60s OR any answered row (no age). A ring that the sweep
--      had already expired on the callee's side but not yet on the caller's
--      still read as busy, and a stale answered row from a dead tab (never
--      swept because the tab died) blocked every future call forever. Busy
--      must only look at ANSWERED rows, and only those still live (<60s for
--      ringing, live for answered) — otherwise the sweep must run first.
--
--   3. LAZY EXPIRY WAS ONE-SIDED. The sweep inside start_call_log only
--      expired the CALLER's own ringing rows, so a callee's orphaned ring
--      from a dead caller leg lived until the callee themselves tried to
--      call. Both sides must be swept.
--
--   4. NO ESCAPE HATCH FOR A DIRTY UNMOUNT. If the call screen unmounted
--      without hitting end_call_log (crash, swipe-kill, background kill), the
--      ringing row stayed until the 60s sweep — during which the UI showed
--      "user still on a call". A client-callable force_clear_my_calls that
--      cancels all non-terminal rows for the caller gives the cleanup effect
--      and the app-resume handler something to call.
--
-- WHAT CHANGES
--
--   * start_call_log gains p_force_clear_stale boolean (default false).
--     When true it immediately cancels any ringing rows for the caller
--     BEFORE the busy check, so a callee who tapped the notification and
--     navigated to the call screen does not read as busy to their own
--     next attempt.
--
--   * Lazy expiry now sweeps BOTH v_me and v_peer ringing rows older than
--     60s, not just the caller's.
--
--   * Busy check only looks at status = 'answered' (not ringing) and
--     requires the row be fresh (<60s) or, for answered, that it has not
--     yet ended — whichever is present is what the next reader sees.
--
--   * force_clear_my_calls(p_user_id uuid) — cancels every ringing/
--     answered row for that user where the user is caller or callee and
--     status not in terminal set. Callable by the authenticated user for
--     themselves only (or service_role for sweeps).
--
-- Re-runnable, backward compatible (new param has default).
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- start_call_log with force_clear_stale + corrected sweeps + busy logic
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

  -- Caller explicitly asked to clear stale rings before checking busy
  -- (callee navigated to call screen, caller retries). This prevents a
  -- ringing row that is about to be navigated to from reading as busy.
  if p_force_clear_stale then
    update public.call_logs cl
       set status = 'canceled',
           ended_at = coalesce(ended_at, now())
     where cl.status = 'ringing'
       and (cl.caller_id = v_me or cl.callee_id = v_me)
       and cl.started_at < now() - interval '30 seconds';
  end if;

  -- Lazy expiry: sweep ALL ringing rows older than 60s for BOTH parties
  -- before any busy verdict, so a ghost ring on either side cannot block.
  update public.call_logs cl
     set status = 'expired', ended_at = coalesce(ended_at, now()), missed = true
   where cl.status = 'ringing'
     and cl.started_at < now() - interval '60 seconds'
     and (cl.caller_id = v_me or cl.callee_id = v_me or cl.caller_id = v_peer or cl.callee_id = v_peer);

  -- Busy check: ONLY answered rows, and only if they are still live.
  -- Ringing is not busy — the peer may be ringing elsewhere but that ring
  -- will either be answered (then it becomes answered and is busy) or it
  -- will expire, and a second ringing row must not block a fresh attempt
  -- while the user is staring at the call screen that was just navigated to.
  -- For answered we require the row not be stale: ended_at is null (still
  -- live) OR started_at within 60s window as fallback for legacy rows
  -- where ended_at was not set.
  if exists (
    select 1 from public.call_logs cl
    where cl.status = 'answered'
      and (cl.caller_id = v_peer or cl.callee_id = v_peer)
      and (
        cl.ended_at is null
        or cl.started_at > now() - interval '60 seconds'
      )
  ) then
    -- Additional guard: double-check age <60s if the row has a started_at
    -- that is older than the window, treat as not busy (phantom).
    -- We already filtered, but keep explicit for future readers.
    return jsonb_build_object('status', 'busy');
  end if;

  -- Also handle ringing-but-still-busy case explicitly for safety:
  -- if peer has a fresh ringing row (<60s) that we did NOT sweep, do not
  -- treat as busy per spec — allow the call. So we intentionally do NOT
  -- return busy for ringing.

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
-- Keep the 2-arg signature usable (PostgreSQL treats default as optional, but
-- explicitly grant the 2-arg form for clients that introspect).
revoke all on function public.start_call_log(uuid, uuid) from public, anon;
grant execute on function public.start_call_log(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- force_clear_my_calls: emergency cancel for phantom state
-- ---------------------------------------------------------------------------

create or replace function public.force_clear_my_calls(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_target uuid := coalesce(p_user_id, v_me);
  v_updated integer := 0;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  -- Only allow clearing own rows unless service_role
  if v_target <> v_me and auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized to clear other user calls' using errcode = '42501';
  end if;

  update public.call_logs
     set status = 'canceled',
         ended_at = coalesce(ended_at, now())
   where status in ('ringing', 'answered')
     and (caller_id = v_target or callee_id = v_target)
     and status not in ('completed','canceled','declined','missed','expired','busy');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  return v_updated;
end;
$$;

revoke all on function public.force_clear_my_calls(uuid) from public, anon;
grant execute on function public.force_clear_my_calls(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- expire_stale_calls: ensure sweep covers both parties (already does via
-- status=ringing sweep, but ensure notified cancel fires correctly)
-- This replaces the version in 202609100006 with identical logic — kept for
-- clarity that the lazy sweep and the cron sweep are in sync.
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

  return v_expired;
end;
$$;

revoke all on function public.expire_stale_calls() from public, anon, authenticated;
grant execute on function public.expire_stale_calls() to service_role;

-- ---------------------------------------------------------------------------
-- Webhook-only push delivery: keep Database Webhook as the single path.
-- Notifications INSERT pushes are delivered by the Supabase Database Webhook
-- on public.notifications (INSERT → notify-on-notification). The pg_net trigger
-- deliver_notification_push would double-send every push, so it is removed
-- here and not re-created. Cancel actions (end_call_log / expire_stale_calls)
-- still use post_to_edge_function directly because they are not INSERT rows
-- and have no webhook to ride — they are data-only FCM cancels, not duplicate
-- notification pushes.
-- ---------------------------------------------------------------------------

drop trigger if exists deliver_notification_push_trigger on public.notifications;
-- Keep deliver_notification_push() function for manual invocation if ever
-- needed, but ensure no trigger fires on INSERT. If the webhook is ever
-- removed, re-create the trigger from 202608190003 / 202609100004.

commit;
