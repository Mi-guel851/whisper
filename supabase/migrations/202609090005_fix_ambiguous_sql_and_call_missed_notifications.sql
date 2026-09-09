-- Fix runtime ambiguity in recent friend/match RPCs, and make missed-call
-- notifications robust for offline callees.
--
-- Why this exists:
--   * PL/pgSQL gives OUT columns and local variables the same name-resolution
--     space as unqualified SQL columns. In find_match_candidates(), the returned
--     column `country_code` made `select country_code ...` ambiguous at runtime.
--   * ensure_pending_conversation() used local variables named `user_a` and
--     `user_b`, the same as public.conversations columns. Some PostgreSQL parse
--     positions (notably ON CONFLICT and VALUES inside PL/pgSQL) can resolve
--     that as an ambiguous reference.
--   * cleanup_pending_thread() had the classic `where conversation_id =
--     conversation_id` trap. It was intended to delete messages for the selected
--     conversation only; with identical names it is ambiguous/self-referential.
--   * notify_missed_call() referenced OLD in an INSERT trigger path. Missed-call
--     notifications are supposed to be created when a caller times out while the
--     callee is offline, so the trigger must be safe on both INSERT and UPDATE.
--
-- No data is dropped by this migration.

-- ---------------------------------------------------------------------------
-- 1. Find a Match: qualify the caller's country_code and every returned column.
-- ---------------------------------------------------------------------------

create or replace function public.find_match_candidates(p_page integer default 0)
returns table (
  profile_id   uuid,
  country_code text,
  active_recent boolean,
  rank_score   double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_my_country_code text;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select p_self.country_code
    into v_my_country_code
  from public.profiles as p_self
  where p_self.id = v_me;

  if v_my_country_code is null then
    return;
  end if;

  return query
  with ranked as (
    select
      p.id as profile_id,
      p.country_code as country_code,
      (coalesce(p.last_active_at, p.created_at) > now() - interval '24 hours') as active_recent,
      (
        (case when p.country_code = v_my_country_code then 200.0 else 0.0 end)
        + (case when coalesce(p.last_active_at, p.created_at) > now() - interval '24 hours'
               then 100.0 else 0.0 end)
        + greatest(0.0, 24.0 - extract(epoch from now() - coalesce(p.last_active_at, p.created_at)) / 3600.0)
        + (abs(hashtext(p.id::text || ':' || v_me::text || ':' || to_char(date_trunc('day', now()), 'YYYY-MM-DD'))) % 100) / 100.0
      ) as rank_score
    from public.profiles as p
    where p.id <> v_me
      and p.profile_completed is distinct from false
      and p.find_a_match_enabled is distinct from false
      and p.country_code is not null
      and not public.user_is_banned(p.id)
      and not exists (
        select 1 from public.blocked_users as b
        where (b.user_id = v_me and b.blocked_user_id = p.id)
           or (b.user_id = p.id and b.blocked_user_id = v_me)
      )
      and not exists (
        select 1 from public.friends as f
        where (f.user_id = v_me and f.friend_id = p.id)
           or (f.user_id = p.id and f.friend_id = v_me)
      )
      and not exists (
        select 1 from public.friend_requests as r
        where r.status = 'pending'
          and least(r.sender_id, r.receiver_id) = least(v_me, p.id)
          and greatest(r.sender_id, r.receiver_id) = greatest(v_me, p.id)
      )
  )
  select
    ranked.profile_id,
    ranked.country_code,
    ranked.active_recent,
    ranked.rank_score
  from ranked
  order by ranked.rank_score desc, ranked.profile_id
  limit 20
  offset greatest(0, least(coalesce(p_page, 0), 9)) * 20;
end;
$$;

revoke all on function public.find_match_candidates(integer) from public;
revoke all on function public.find_match_candidates(integer) from anon;
grant execute on function public.find_match_candidates(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Pending request thread: use pair_* variables, never user_a/user_b locals.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_pending_conversation(target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair_a uuid;
  v_pair_b uuid;
  v_conversation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'Cannot open a thread with yourself' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.friend_requests as r
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
    into v_pair_a, v_pair_b;

  insert into public.conversations (user_a, user_b, user_a_label, user_b_label, last_message_at)
  values (v_pair_a, v_pair_b, 'Anonymous Friend', 'Anonymous Friend', now())
  on conflict (user_a, user_b) do update
    set last_message_at = public.conversations.last_message_at
  returning public.conversations.id into v_conversation_id;

  return v_conversation_id;
end;
$$;

revoke all on function public.ensure_pending_conversation(uuid) from public;
revoke all on function public.ensure_pending_conversation(uuid) from anon;
grant execute on function public.ensure_pending_conversation(uuid) to authenticated;

-- Also patch the legacy friend-conversation helper, for any older clients or
-- manual calls that still use it instead of inserting the conversation row
-- directly from the Friends/Inbox pages.
create or replace function public.ensure_friend_conversation(friend_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair_a uuid;
  v_pair_b uuid;
  v_conversation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.friends as f
    where f.user_id = auth.uid() and f.friend_id = friend_user_id
  ) then
    raise exception 'Friendship not found' using errcode = 'P0002';
  end if;

  select least(auth.uid(), friend_user_id), greatest(auth.uid(), friend_user_id)
    into v_pair_a, v_pair_b;

  insert into public.conversations (user_a, user_b, user_a_label, user_b_label, last_message_at)
  values (v_pair_a, v_pair_b, 'Anonymous Friend', 'Anonymous Friend', now())
  on conflict (user_a, user_b) do update
    set last_message_at = public.conversations.last_message_at
  returning public.conversations.id into v_conversation_id;

  return v_conversation_id;
end;
$$;

revoke all on function public.ensure_friend_conversation(uuid) from public;
revoke all on function public.ensure_friend_conversation(uuid) from anon;
grant execute on function public.ensure_friend_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Pending-thread cleanup: make the selected conversation id unambiguous.
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_pending_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair_a uuid;
  v_pair_b uuid;
  v_conversation_id uuid;
begin
  if old.status is distinct from 'pending' then
    return old;
  end if;

  select least(old.sender_id, old.receiver_id), greatest(old.sender_id, old.receiver_id)
    into v_pair_a, v_pair_b;

  if exists (
    select 1
    from public.friends as f
    where (f.user_id = v_pair_a and f.friend_id = v_pair_b)
       or (f.user_id = v_pair_b and f.friend_id = v_pair_a)
  ) then
    return old;
  end if;

  select c.id
    into v_conversation_id
  from public.conversations as c
  where c.user_a = v_pair_a and c.user_b = v_pair_b
  for update;

  if v_conversation_id is null then
    return old;
  end if;

  delete from public.direct_messages as dm where dm.conversation_id = v_conversation_id;
  delete from public.conversations as c where c.id = v_conversation_id;

  return old;
end;
$$;

do $$
begin
  drop trigger if exists friend_request_pending_thread_cleanup on public.friend_requests;
  create trigger friend_request_pending_thread_cleanup
    after delete on public.friend_requests
    for each row execute function public.cleanup_pending_thread();
exception when undefined_table then
  raise warning 'Pending-thread teardown skipped: public.friend_requests does not exist in this environment.';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Missed calls: trigger only on the transition into missed=true.
-- ---------------------------------------------------------------------------

create or replace function public.notify_missed_call()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_missed boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_was_missed := coalesce(old.missed, false);
  end if;

  if new.missed and not v_was_missed then
    insert into public.notifications (user_id, type, title, body, source_id, metadata)
    values (
      new.callee_id,
      'message',
      'Missed Voice Call 📞',
      'An anonymous friend called you while you were away.',
      new.id,
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
exception when undefined_table then
  raise warning 'Missed-call notification skipped: public.call_logs does not exist in this environment.';
end $$;
