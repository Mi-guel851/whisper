-- Repair the browser-safe SELECT grants on messages.
--
-- 202609100002_private_column_grants.sql attempted to preserve the roles that
-- could read `messages` by checking has_table_privilege() before replacing the
-- table grant with a column grant. That check does not report a role whose
-- access came from existing column-level grants, so the migration could revoke
-- the table grant and leave anon/authenticated with no SELECT privilege at all.
-- PostgREST then returns `permission denied for table messages` even for a
-- projection containing only non-sensitive columns.
--
-- This migration is deliberately corrective and explicit. It is safe to run
-- after 202609100002 has already been applied, and it also remains idempotent
-- for staging databases. RLS still controls which rows each role can see; these
-- grants only make the browser-safe projection readable. Hint/identity columns
-- stay denied and are available only through whisper_hints_for(uuid[]).

begin;

do $$
declare
  safe_columns text;
  private_columns text;
begin
  if to_regclass('public.messages') is null then
    raise notice 'messages table is not present; safe SELECT grant repair skipped.';
    return;
  end if;

  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
    into safe_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'messages'
    and column_name = any (array[
      'id', 'recipient_id', 'message', 'image_url', 'created_at', 'is_read'
    ]::text[]);

  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
    into private_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'messages'
    and column_name = any (array[
      'sender_country', 'sender_state', 'sender_city', 'sender_device',
      'sender_username', 'sender_email_name', 'sender_user_id'
    ]::text[]);

  -- Remove any broad grant left by the base schema or the earlier repair.
  -- Column-level grants are independent of a table-level REVOKE, so remove the
  -- protected columns explicitly as well.
  revoke select on table public.messages from public, anon, authenticated;

  if private_columns is not null then
    execute format(
      'revoke select (%s) on table public.messages from public, anon, authenticated',
      private_columns
    );
  end if;

  if safe_columns is null then
    raise warning 'messages has none of the expected browser-safe columns; no SELECT grant was installed.';
    return;
  end if;

  -- Both API roles keep the same RLS boundary as before, but can only project
  -- the six fields used by notification/badge/dashboard reads. Granting the
  -- safe projection to anon is harmless when the existing recipient RLS policy
  -- requires auth.uid(); it also preserves installations that used a public
  -- table grant before the private-column hardening migration.
  execute format(
    'grant select (%s) on table public.messages to anon, authenticated',
    safe_columns
  );
end $$;

commit;
