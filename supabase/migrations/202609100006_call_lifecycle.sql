-- ===========================================================================
-- Call lifecycle done properly: a server-authoritative state machine,
-- incoming-call alerts, durable expiry, chat-persistent outcomes, and a
-- locked-down realtime signaling topic.
--
--   C1  `call_logs` gains `call_id` (client-generated UUID, the idempotency
--       key) and a real `status` machine — ringing / answered / declined /
--       canceled / missed / expired / completed / busy — because a boolean
--       `missed` cannot "distinguish missed, declined, cancelled and
--       completed", and the app needs all five in the chat timeline. The
--       legacy `missed` column is kept in sync for older readers.
--   C2  Clients can no longer write to `call_logs` at all (policies and table
--       grants both gone; SELECT stays for the timeline). All transitions run
--       through definer RPCs that re-check identity, accepted friendship,
--       blocks and bans on EVERY call — the old RLS UPDATE policy let either
--       participant set ANY column, so a caller could flip `missed` back to
--       false and re-fire it to spam the other side, and a callee could mark
--       their own missed call "completed". One RPC, one legal transition
--       table, one notification per event.
--   C3  Incoming-call alert: an opt-in-gated `notifications` row typed 'call'
--       for the callee (route: the conversation; Android renders it on the
--       `calls` channel with a full-screen intent — see
--       FCMMessagingService.java in this same commit). It is written by the
--       start RPC, so it can only exist for a call the server actually
--       accepted. Answering marks it read; any terminal transition sends a
--       data-only "cancel" so a device still showing the ring clears it —
--       stale alerts after hang-up are the difference between a phone
--       feature and a prank.
--   C4  Missed is a TIMEOUT, never a presence verdict: only the caller's own
--       45s give-up (outcome 'missed') or the server sweeper (expired) marks
--       a call unreached. "Recipient appears offline" marks nothing.
--   C5  Expiry does not depend on any browser being alive: the caller's timer
--       still ends the UX, but `expire_stale_calls()` (service role, wired to
--       the Vercel cron /api/calls/sweep) and a lazy sweep inside
--       `start_call_log` close ringing rows even when the caller's tab dies,
--       the phone reboots, or the network drops mid-ring.
--   C6  Realtime broadcast channels were unauthenticated: ANY signed-in user
--       who knew (or guessed) a conversation uuid could subscribe to
--       `whisper-call:<id>` and inject offer/answer/end signals — ringing a
--       device, hijacking media negotiation, or hanging up calls they are not
--       in. Realtime `broadcast` does not go through table RLS at all; the
--       fix is the documented `realtime.messages` policy layer: call topics
--       require conversation participation, everything else is left as-is so
--       typing/presence keep working the moment this is applied.
--       A push notification is an ALERT — answering still requires the live,
--       channel-authorized 'offer' plus the callee's tap.
--
-- Nothing here drops data. Re-runnable.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- C1. Status machine + idempotency key on the log.
-- ---------------------------------------------------------------------------

alter table public.call_logs add column if not exists call_id uuid;
alter table public.call_logs add column if not exists status text not null default 'ringing'
  check (status in ('ringing','answered','declined','canceled','missed','expired','completed','busy'));

do $$
begin
  if not exists (
    select 1 from pg_indexes where schemaname='public'
      and tablename='call_logs' and indexname='call_logs_call_id_key'
  ) then
    create unique index call_logs_call_id_key on public.call_logs (call_id)
      where call_id is not null;
  end if;
exception when others then
  raise notice 'C1: call_id unique index skipped (%).', sqlerrm;
end $$;

-- Backfill rows that predate the machine. Anything still 'ringing' with no
-- ended_at and older than a minute is an orphan — call it expired.
do $$
begin
  update public.call_logs set
    status = case
      when ended_at is not null and missed then 'missed'
      when ended_at is not null then 'completed'
      when started_at > now() - interval '60 seconds' then 'ringing'
      else 'expired'
    end
  where status = 'ringing';
exception when others then
  raise notice 'C1: call_logs backfill skipped (%).', sqlerrm;
end $$;

-- Keep `missed` honest after the backfill (rows swept to expired count too).
update public.call_logs set missed = true where status in ('missed','expired') and not missed;

create index if not exists call_logs_open_idx
  on public.call_logs (status, started_at)
  where status in ('ringing','answered');

-- ---------------------------------------------------------------------------
-- C2. Table lockdown: reads stay, direct writes go.
-- ---------------------------------------------------------------------------

revoke insert, update, delete on table public.call_logs from public, anon, authenticated;

drop policy if exists "Callers can log calls inside accepted friendships" on public.call_logs;
drop policy if exists "Participants can close call logs" on public.call_logs;
-- SELECT policy from 202609090004 remains: participants can read their own
-- conversation's call entries, which is what the chat timeline needs.

-- The old missed-transition trigger is replaced by the RPCs below (single
-- writer), so drop it; keeping both would double every missed notification.
drop trigger if exists call_log_missed_notification on public.call_logs;

-- ---------------------------------------------------------------------------
-- C3/C4. start_call_log: the ONLY way a call begins.
-- ---------------------------------------------------------------------------

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

  -- Incoming-call alert for the callee, gated on their preferences. The
  -- unique index from 202609100004 makes the (user, type, source) triple
  -- structurally once-per-call; `on conflict` keeps a legacy database without
  -- it from raising inside this transaction.
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
    and p.push_notifications is distinct from false
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

-- ---------------------------------------------------------------------------
-- C3/C4. end_call_log: the ONLY way a call changes state after it starts.
--
-- The legal transition table:
--   caller: ringing -> canceled (hung up before anyone answered — shows in
--                    the callee's chat as "Call cancelled", NOT as missed)
--           ringing -> missed   (their own 45s give-up; the ONLY missed push)
--           answered -> completed (either side hangs up a live call)
--   callee: ringing -> answered (call live; incoming alert marked read)
--           ringing -> declined / busy
-- Anything else no-ops (already final on another device, replay, or the
-- peer's action won the race). Idempotence is the point: two phones, two
-- timers, zero duplicate entries.
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
    when v_me = v_log.caller_id and v_log.status = 'ringing'
         and p_outcome in ('canceled', 'missed') then p_outcome
    when v_log.status = 'answered' and p_outcome = 'completed'
         then 'completed'  -- either participant may end a live call
    when v_me = v_log.callee_id and v_log.status = 'ringing'
         and p_outcome in ('answered', 'declined', 'busy') then p_outcome
    else null
  end;

  if v_next is null then
    return jsonb_build_object('status', v_log.status, 'ignored', true,
                              'id', v_log.id, 'call_id', v_log.call_id);
  end if;

  update public.call_logs
     set status = v_next,
         missed = (v_next in ('missed', 'expired')),
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

  /* Retire the device alert on every terminal transition: answering on
     another phone, declining, hang-up, busy. Data-only — no banner, no
     sound; FCMMessagingService cancels the notification whose id derives from
     this call_id, and every device of the peer converges on "no ringing". */
  /* The cancel goes to the CALLEE's devices — that is where the ringing
     notification was posted, on every device of theirs, not just the one that
     acted. The caller sees no alert to retract (start never alerted them). */
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
-- C5. Sweep for orphaned ringing rows — the no-browser-needed backstop.
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
-- C6. Lock the signaling topic to conversation participants.
--
-- `realtime.messages` is where broadcast traffic is authorized once RLS is
-- enabled on it. Two policies, deliberately ordered by intent:
--   * whisper-call:*  — only members of the conversation named in the topic.
--   * everything else — unchanged (typing indicators etc. keep working).
-- Both SELECT (subscribe/receive) and INSERT (broadcast) share the predicate.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'C6: realtime.messages not present (older Realtime); skipping channel policies.';
    return;
  end if;

  alter table realtime.messages enable row level security;

  drop policy if exists "whisper-call topics require participants" on realtime.messages;
  create policy "whisper-call topics require participants" on realtime.messages
    for all to authenticated
    using (
      realtime.topic() like 'whisper-call:%'
      and exists (
        select 1 from public.conversations c
        where c.id = nullif(split_part(realtime.topic(), ':', 2), '')::uuid
          and (c.user_a = auth.uid() or c.user_b = auth.uid())
      )
      and nullif(split_part(realtime.topic(), ':', 2), '') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    )
    with check (
      realtime.topic() like 'whisper-call:%'
      and exists (
        select 1 from public.conversations c
        where c.id = nullif(split_part(realtime.topic(), ':', 2), '')::uuid
          and (c.user_a = auth.uid() or c.user_b = auth.uid())
      )
    );

  drop policy if exists "non-call whisper topics allowed" on realtime.messages;
  create policy "non-call whisper topics allowed" on realtime.messages
    for all to authenticated
    using (realtime.topic() not like 'whisper-call:%')
    with check (realtime.topic() not like 'whisper-call:%');

  raise notice 'C6: whisper-call topics are now participant-only.';
exception when others then
  raise warning 'C6: could not attach realtime channel policies (%). Realtime authorization must be configured at the platform level.', sqlerrm;
end $$;

-- The stale-overlay dismissal subscribes to call_logs changes on the chat
-- page (a call answered on device A must fall off device B's screen), which
-- needs the table in the realtime publication — participants only, via the
-- existing SELECT policy.
do $$
begin
  if to_regclass('public.call_logs') is not null then
    alter publication supabase_realtime add table public.call_logs;
  end if;
exception when duplicate_object then
  null;
when others then
  raise notice 'C7: could not add call_logs to the realtime publication (%).', sqlerrm;
end $$;

commit;

-- ===========================================================================
-- After applying
--
--   * Deploy the Next.js call client from the same release; it now drives
--     start_call_log / end_call_log instead of table writes. An app build that
--     predates this migration will see direct call_logs inserts fail (RLS)
--     and fall back to signaling-only calls — no missed-call bookkeeping
--     until it updates. The web shell self-updates (server.url); the native
--     stores need the release.
--   * Vercel cron (vercel.json, shipped here) hits /api/calls/sweep every
--     minute with CRON_SECRET; the route calls expire_stale_calls() with the
--     service role only.
--   * Verify:
--       - a non-participant cannot broadcast on whisper-call:<their-conv>:
--         (their channel join fails authorization; Realtime drops broadcasts)
--       - a non-friend calling a user is refused by start_call_log;
--       - double end_call_log returns {ignored:true} the second time.
-- ===========================================================================
