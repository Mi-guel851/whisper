-- ===========================================================================
-- Blocking someone from the inbox.
--
-- WHY AN RPC AND NOT A TABLE WRITE
--
-- `blocked_users` has carried a SELECT policy and an INSERT policy since
-- 202607100001, but no DELETE policy — so the app could add a block and never
-- take one back, and "block" would have been a one-way door built out of a
-- missing grant. Worse, a block that only inserts a row is a block in name
-- only: the pair would still be friends, their calls would still be allowed
-- (start_call_log requires an accepted friendship), and a pending friend
-- request would still sit in the other person's list.
--
-- So the block lives here, as one transition with one writer:
--
--   blocked_users   the block itself, idempotent on (user_id, blocked_user_id)
--   friends         both directions — a friendship is two rows in this schema
--   friend_requests both directions — a pending request from someone you just
--                   blocked must not stay in your list, nor yours in theirs
--   call_logs       ringing legs only, cancelled: if they are ringing you right
--                   now, the block answers for you. A LIVE call is deliberately
--                   left alone — ending someone's audio mid-sentence is not a
--                   side effect a menu item should have
--
-- and, from this migration on, the block is actually enforced on new whispers
-- by a BEFORE INSERT guard on `messages` (the RLS policies on that table live
-- in the dashboard, not in this repository, so a guard that any client path
-- must pass is the only enforcement that can be version-controlled).
--
-- Unblocking is the inverse and nothing else: the friendship is NOT restored
-- (that is a deliberate act, a new request), and the conversation history is
-- untouched in both directions.
--
-- Re-runnable. Nothing is dropped or rewritten destructively.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- The table layer: the blocker may remove their own block.
--
-- The definer functions below would work without this (they run as the owner),
-- but a permission that only exists inside a function is a trap for the next
-- reader: this is the rule the table itself states, so unblocking cannot be
-- "fixed" later by a client-side delete that silently affects zero rows.
-- Only the blocker may remove the block — the blocked person cannot unblock
-- themselves, which is the whole point of blocking.
-- ---------------------------------------------------------------------------

drop policy if exists "Users can remove their own blocks" on public.blocked_users;
create policy "Users can remove their own blocks" on public.blocked_users
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- block_user
-- ---------------------------------------------------------------------------

create or replace function public.block_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_already boolean := false;
  v_friendships integer := 0;
  v_requests integer := 0;
  v_rings integer := 0;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_user_id is null then
    raise exception 'A user is required' using errcode = '22023';
  end if;
  if p_user_id = v_me then
    raise exception 'You cannot block yourself.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.blocked_users b
    where b.user_id = v_me and b.blocked_user_id = p_user_id
  ) into v_already;

  insert into public.blocked_users (user_id, blocked_user_id)
  values (v_me, p_user_id)
  on conflict (user_id, blocked_user_id) do nothing;

  /* Both directions: a friendship is stored as one row in whichever direction
     it was accepted, and a half-removed friendship is exactly the state that
     lets a "blocked" person still start a call (start_call_log accepts either
     direction of the pair). */
  delete from public.friends f
   where (f.user_id = v_me and f.friend_id = p_user_id)
      or (f.user_id = p_user_id and f.friend_id = v_me);
  get diagnostics v_friendships = row_count;

  /* Pending requests both ways, including an already-accepted request row:
     the friendship itself is gone above, and a leftover "accepted" request
     would let the pair re-add each other with one tap. */
  delete from public.friend_requests r
   where (r.sender_id = v_me and r.receiver_id = p_user_id)
      or (r.sender_id = p_user_id and r.receiver_id = v_me);
  get diagnostics v_requests = row_count;

  /* Ringing only. `end_call_log`'s transition table is the app's writer; this
     is a system-level cancellation of calls that are still in the air, which
     is why it touches nothing that has been answered. */
  update public.call_logs cl
     set status = 'canceled',
         ended_at = coalesce(cl.ended_at, now())
   where cl.status = 'ringing'
     and ((cl.caller_id = v_me and cl.callee_id = p_user_id)
       or (cl.caller_id = p_user_id and cl.callee_id = v_me));
  get diagnostics v_rings = row_count;

  return jsonb_build_object(
    'status', case when v_already then 'already_blocked' else 'blocked' end,
    'user_id', p_user_id,
    'removed_friendships', v_friendships,
    'removed_requests', v_requests,
    'canceled_rings', v_rings
  );
end;
$$;

revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- unblock_user — the inverse, and nothing more.
-- ---------------------------------------------------------------------------

create or replace function public.unblock_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_removed integer := 0;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_user_id is null then
    raise exception 'A user is required' using errcode = '22023';
  end if;

  delete from public.blocked_users b
   where b.user_id = v_me and b.blocked_user_id = p_user_id;
  get diagnostics v_removed = row_count;

  return jsonb_build_object(
    'status', case when v_removed > 0 then 'unblocked' else 'not_blocked' end,
    'user_id', p_user_id
  );
end;
$$;

revoke all on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Enforcement: a block refuses new whispers, from either side.
--
-- Written against `to_jsonb(new)` rather than named columns on purpose: this
-- table's DDL lives outside this repository (created in the dashboard, with
-- its RLS), and the two facts that matter here — who sent it and who receives
-- it — are read defensively so a column rename cannot turn this guard into a
-- runtime error on every insert. A row with no identifiable recipient is not
-- a whisper between two people and is left alone.
--
-- Raising rather than silently dropping: a sender who is blocked must be told,
-- not shown a "sent" bubble for a message nothing will ever deliver.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_no_blocked_whispers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid := nullif(to_jsonb(new)->>'sender_id', '')::uuid;
  v_recipient uuid := nullif(to_jsonb(new)->>'recipient_id', '')::uuid;
  v_conversation uuid := nullif(to_jsonb(new)->>'conversation_id', '')::uuid;
  v_a uuid;
  v_b uuid;
begin
  if v_conversation is not null and (v_sender is null or v_recipient is null) then
    select c.user_a, c.user_b into v_a, v_b
      from public.conversations c where c.id = v_conversation;
    v_sender := coalesce(v_sender, v_a);
    v_recipient := coalesce(v_recipient, v_b);
  end if;

  if v_sender is null or v_recipient is null or v_sender = v_recipient then
    return new;
  end if;

  if exists (
    select 1 from public.blocked_users b
    where (b.user_id = v_sender and b.blocked_user_id = v_recipient)
       or (b.user_id = v_recipient and b.blocked_user_id = v_sender)
  ) then
    raise exception 'This conversation is blocked.' using errcode = '42501';
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.messages') is null then
    raise notice 'messages table not present; block guard skipped.';
    return;
  end if;
  drop trigger if exists whisper_block_guard on public.messages;
  create trigger whisper_block_guard
    before insert on public.messages
    for each row execute function public.enforce_no_blocked_whispers();
  raise notice 'Blocked pairs can no longer whisper to each other.';
end $$;

commit;

-- ===========================================================================
-- After applying
--
--   * The inbox's long-press menu offers Block (and Unblock, once blocked).
--   * Verify:
--       - block_user(uuid) is idempotent: the second call returns
--         {"status":"already_blocked"} and changes nothing;
--       - a blocked pair cannot insert into `messages` (42501) in either
--         direction, and neither can they start a call (friendship gone);
--       - unblock_user(uuid) returns the pair to "no block, no friendship" —
--         they can request each other again, which is the intended door back.
-- ===========================================================================
