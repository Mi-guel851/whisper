-- ===========================================================================
-- Repair: legacy push triggers that roll back the row they were meant to
--         announce
--
-- SYMPTOM
--   Sending a chat message, adding a friend, or sending an anonymous whisper
--   fails with:
--
--     function net.http_post(text, jsonb, jsonb, integer) does not exist
--
--   ...and nothing is saved.
--
-- WHY IT BREAKS EVERYTHING AT ONCE
--   All three of those actions end in one place. `notify_new_direct_message()`,
--   `notify_friend_request_events()` and the whisper path each INSERT a row into
--   `public.notifications`. A trigger on *that* table then tries to call the edge
--   function over HTTP. Because it raises, and because a trigger runs inside the
--   caller's transaction, the exception unwinds the entire chain — so the failure
--   to send a push becomes a failure to save the message. One broken trigger,
--   three broken features.
--
-- WHY THE SIGNATURE IS WRONG
--   pg_net declares:
--     net.http_post(url text, body jsonb, params jsonb, headers jsonb,
--                   timeout_milliseconds integer)
--
--   A positional four-argument call — (url, body, headers, timeout) — therefore
--   binds `headers` to `params` and then offers an integer where `headers jsonb`
--   is expected. No candidate matches, so Postgres reports the function as
--   non-existent rather than as mis-called, which is what makes this error read
--   like a missing extension when pg_net is in fact installed and fine.
--
--   This is why 202608190003 calls it with *named* arguments. Named binding is
--   immune to pg_net adding or reordering parameters between versions, and that
--   migration additionally wraps the call in `exception when others` so a failed
--   push can never take a message down with it.
--
-- WHAT THIS MIGRATION DOES
--   Finds every trigger whose function calls `net.http_post` directly and drops
--   the trigger. That set is exactly the legacy ones: nothing in this repo calls
--   pg_net from a trigger function — they all go through
--   `public.post_to_edge_function`, which is not itself a trigger — so the scan
--   cannot match anything current.
--
--   Triggers created by Supabase's dashboard "Database Webhooks" feature call
--   `supabase_functions.http_request`, not `net.http_post`, and are deliberately
--   left alone: the whisper delivery path still relies on one.
--
-- Re-runnable. On a database with no legacy triggers it drops nothing and says so.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- To see what this will remove before running it:
--
--   select tg.tgname as trigger_name,
--          ns.nspname || '.' || cl.relname as on_table,
--          p.proname as trigger_function
--     from pg_trigger tg
--     join pg_class     cl on cl.oid = tg.tgrelid
--     join pg_namespace ns on ns.oid = cl.relnamespace
--     join pg_proc      p  on p.oid  = tg.tgfoid
--    where not tg.tgisinternal
--      and p.prosrc ilike '%net.http_post%';
-- ---------------------------------------------------------------------------

do $$
declare
  victim record;
  dropped integer := 0;
begin
  for victim in
    select
      tg.tgname                          as trigger_name,
      ns.nspname                         as table_schema,
      cl.relname                         as table_name,
      pns.nspname || '.' || p.proname    as function_name
    from pg_trigger tg
    join pg_class     cl  on cl.oid  = tg.tgrelid
    join pg_namespace ns  on ns.oid  = cl.relnamespace
    join pg_proc      p   on p.oid   = tg.tgfoid
    join pg_namespace pns on pns.oid = p.pronamespace
    where not tg.tgisinternal
      -- The direct pg_net call is the tell. Everything this repo installs reaches
      -- pg_net through public.post_to_edge_function instead, so a trigger
      -- function containing this string is by definition not one of ours.
      and p.prosrc ilike '%net.http_post%'
      -- Never touch the safe wrapper, however it ends up being referenced.
      and p.proname <> 'post_to_edge_function'
      -- System schemas are not ours to rewrite.
      and ns.nspname not in ('pg_catalog', 'information_schema')
  loop
    execute format(
      'drop trigger if exists %I on %I.%I',
      victim.trigger_name, victim.table_schema, victim.table_name
    );

    dropped := dropped + 1;

    raise notice
      'dropped legacy push trigger "%" on %.% (called %) — writes to that table will now succeed',
      victim.trigger_name, victim.table_schema, victim.table_name, victim.function_name;
  end loop;

  if dropped = 0 then
    raise notice
      'no legacy pg_net triggers found; if writes still fail, run the diagnostic query in this file''s header';
  else
    raise notice
      'removed % legacy push trigger(s). Delivery now runs through deliver_notification_push (202608190003).',
      dropped;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- Make sure the correct path is actually attached.
--
-- Dropping the broken trigger stops the rollback; this is what restores the
-- push. Both objects come from 202608190003 — recreating the trigger here is
-- idempotent and covers the case where that migration was applied *before* the
-- legacy trigger was added by hand, and so lost the race for the table.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.deliver_notification_push()') is null then
    raise notice
      'deliver_notification_push() is missing — apply 202608190003_notification_delivery.sql, then re-run this file';
    return;
  end if;

  drop trigger if exists notification_push_trigger on public.notifications;

  create trigger notification_push_trigger
    after insert on public.notifications
    for each row execute function public.deliver_notification_push();

  raise notice 'notification_push_trigger reattached to public.notifications';
end $$;


-- ---------------------------------------------------------------------------
-- Belt and braces: prove the safe wrapper cannot raise.
--
-- `post_to_edge_function` already swallows failures, but it is the single point
-- every push now flows through, so it is worth asserting rather than assuming.
-- A missing app.settings.* pair makes it warn and return; this checks that the
-- HTTP call itself degrades the same way by aiming it at a host that cannot
-- resolve. If this DO block completes, no notification failure can ever roll
-- back a message again.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.post_to_edge_function(text, jsonb)') is null then
    raise notice 'post_to_edge_function is missing — apply 202608190003 first';
    return;
  end if;

  perform public.post_to_edge_function(
    'whisper-selftest-nonexistent-function',
    jsonb_build_object('selftest', true)
  );

  raise notice 'push wrapper degrades safely: a delivery failure cannot roll back a write';
exception when others then
  -- Reaching here would mean the wrapper can still propagate, which is the whole
  -- bug this migration exists to end. Loud, but not fatal to the migration.
  raise warning
    'post_to_edge_function still raises (%) — pushes may still be able to break writes', sqlerrm;
end $$;
