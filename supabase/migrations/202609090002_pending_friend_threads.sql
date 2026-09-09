-- Friend-request messaging gates: pending threads, accept-before-reply,
-- and thread teardown when the request dies.
--
-- THE RULES (and where each is enforced — the UI is never the only guard)
--
--   (a) After A sends a friend request to B, A may open and send into the
--       pending thread with B. Sending still requires the existing one-time
--       coin unlock, exactly as for any conversation.
--           enforced by: can_send_direct_message gaining a
--           "sender of the pending request" arm, and ensure_pending_conversation
--           (definer) creating the thread row.
--   (b) B MUST accept the request before B can reply. B's composer is locked
--       client-side, but the database is the gate: a receiver of a pending
--       request is NOT a friend and is NOT the request's sender, so the
--       insert policy refuses their rows no matter what the UI shows.
--           enforced by: the same can_send_direct_message rewrite — the
--           relationship arm only matches friendship (either direction) or
--           being the PENDING REQUEST'S SENDER.
--   (c) Once accepted, the thread is a normal friend conversation and BOTH
--       sides still need the existing UNLOCK_CHAT_COST unlock before sending.
--           enforced by: the chat_unlocks clause, unchanged — nothing here
--           grants or skips an unlock.
--   (d) If the request is declined or withdrawn, the pending thread stops
--       accepting messages (no pending request and no friendship, so the
--       insert policy refuses) and is hidden — deleted, the same way every
--       other removal in this app works: the row goes away, the realtime
--       DELETE events clear both inboxes and any open thread. A request row
--       is removed by DELETE (see the friend_requests delete policies), so
--       the teardown hangs off the same event.
--
-- WHY THE RELATIONSHIP ARM WAS ABSENT BEFORE
--
-- can_send_direct_message used to check participant + unlock + no block +
-- not banned, and trusted the UI for the "these two are actually friends"
-- part. Every conversation in the app was between friends in practice
-- (startChat is friend-only; connect_with_foreigner and accept_friend_request
-- create the friendship first), so the hole was latent. Making the pending
-- thread a real sendable surface requires the relationship to be a fact the
-- database holds — so it is now, which also closes the latent hole.
--
-- Friendship is matched in EITHER direction: the UI's accept flow historically
-- wrote a one-directional friends row (the RPC flows write both), and legacy
-- data has both shapes. A gate that assumed two rows would have silently
-- locked out half the friend pairs in the database.
--
-- No data is dropped. Existing conversations and unlocks are untouched.

-- ---------------------------------------------------------------------------
-- 1. The send gate, extended
--
-- Body is 202609080001's definition verbatim — participant, unlock, no block
-- either way, not banned — plus one OR'd relationship arm. Same signature,
-- same grants, so the "Conversation members can send unlocked direct
-- messages" policy picks the new definition up with no policy change.
-- ---------------------------------------------------------------------------

create or replace function public.can_send_direct_message(target_conversation_id uuid, target_sender_id uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = target_conversation_id
      and target_sender_id in (c.user_a, c.user_b)
      and exists (
        select 1 from public.chat_unlocks u
        where u.user_id = target_sender_id and u.conversation_id = target_conversation_id
      )
      and not exists (
        select 1
        from public.blocked_users b
        where (b.user_id = c.user_a and b.blocked_user_id = c.user_b)
           or (b.user_id = c.user_b and b.blocked_user_id = c.user_a)
      )
      and not public.user_is_banned(target_sender_id)
      -- The relationship arm. The other participant is derived once, here:
      -- either the friend (accepted, in either row direction) or the sender
      -- of the still-pending request. A receiver of a pending request
      -- matches neither — that is rule (b) in one clause.
      and exists (
        select 1
        from public.friends f
        where (
            (f.user_id = target_sender_id and f.friend_id = (case when c.user_a = target_sender_id then c.user_b else c.user_a end))
         or (f.user_id = (case when c.user_a = target_sender_id then c.user_b else c.user_a end) and f.friend_id = target_sender_id)
        )
        union
        select 1
        from public.friend_requests r
        where r.status = 'pending'
          and r.sender_id = target_sender_id
          and r.receiver_id = (case when c.user_a = target_sender_id then c.user_b else c.user_a end)
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Opening the pending thread.
--
-- Definer on purpose: the conversations insert policy in production is not
-- in this repository's history, and a pending pair is NOT a friend pair —
-- assuming the policy admits them would be an unreviewed guess. The RPC
-- checks the only thing that matters (a pending request exists in either
-- direction) and writes the row itself. The UI's startChat keeps its direct
-- insert for friends; the pending rows call this instead, and fall back to
-- the old path if a pre-migration database doesn't have the function.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_pending_conversation(target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  user_a uuid;
  user_b uuid;
  conversation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'Cannot open a thread with yourself' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.friend_requests r
    where r.status = 'pending'
      and least(r.sender_id, r.receiver_id) = least(auth.uid(), target_user_id)
      and greatest(r.sender_id, r.receiver_id) = greatest(auth.uid(), target_user_id)
  ) then
    raise exception 'There is no pending friend request between you two.' using errcode = 'P0002';
  end if;

  if public.user_is_banned(auth.uid()) then
    raise exception 'Your account has been restricted from using Whisper.' using errcode = 'WH001';
  end if;

  select least(auth.uid(), target_user_id), greatest(auth.uid(), target_user_id)
    into user_a, user_b;

  insert into public.conversations (user_a, user_b, user_a_label, user_b_label, last_message_at)
  values (user_a, user_b, 'Anonymous Friend', 'Anonymous Friend', now())
  on conflict (user_a, user_b) do update
    set last_message_at = public.conversations.last_message_at
  returning id into conversation_id;

  return conversation_id;
end;
$$;

revoke all on function public.ensure_pending_conversation(uuid) from public;
revoke all on function public.ensure_pending_conversation(uuid) from anon;
grant execute on function public.ensure_pending_conversation(uuid) to authenticated;

comment on function public.ensure_pending_conversation(uuid) is
  'Opens (or returns) the conversation for a pair with a pending friend request. The only way a non-friend pair gets a sendable thread; rule (a).';

-- ---------------------------------------------------------------------------
-- 3. Teardown when the request dies.
--
-- A pending request row is removed by DELETE (decline and cancel both delete
-- — that is the existing convention), so the teardown hangs off the same
-- event. The guards are all of them load-bearing:
--
--   old.status = 'pending'   — accepted requests never leave via DELETE; an
--                              accepted friendship's thread must survive.
--   no friendship either way — if the pair is friends through some other
--                              path, their thread is a friend thread, not a
--                              pending one, and deleting it would destroy a
--                              real conversation.
--
-- direct_messages goes first, explicitly, because the FK cascade behaviour of
-- a table created before this repository's history is not something to bet a
-- user's messages on. chat_unlocks cascades by its own FK (on delete
-- cascade), which is what re-arms the coin paywall if the pair re-friends
-- later and gets a fresh thread — the unlock was for THIS thread.
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_pending_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
-- `pair_*` rather than `user_*`: the conversations columns are named
-- user_a/user_b, and a local of the same name would make `where user_a =
-- user_a` a self-comparison — true for every row in the table.
declare
  pair_a uuid;
  pair_b uuid;
  conversation_id uuid;
begin
  if old.status is distinct from 'pending' then
    return old;
  end if;

  select least(old.sender_id, old.receiver_id), greatest(old.sender_id, old.receiver_id)
    into pair_a, pair_b;

  if exists (
    select 1
    from public.friends f
    where (f.user_id = pair_a and f.friend_id = pair_b)
       or (f.user_id = pair_b and f.friend_id = pair_a)
  ) then
    return old;
  end if;

  select id into conversation_id
  from public.conversations
  where user_a = pair_a and user_b = pair_b
  for update;

  if conversation_id is null then
    return old;
  end if;

  delete from public.direct_messages where conversation_id = conversation_id;
  delete from public.conversations where id = conversation_id;

  return old;
end;
$$;

do $$
begin
  drop trigger if exists friend_request_pending_thread_cleanup on public.friend_requests;
  create trigger friend_request_pending_thread_cleanup
    after delete on public.friend_requests
    for each row execute function public.cleanup_pending_thread();
  raise notice 'Pending-thread teardown attached to public.friend_requests.';
exception when undefined_table then
  raise warning 'Pending-thread teardown skipped: public.friend_requests does not exist in this environment.';
end $$;
