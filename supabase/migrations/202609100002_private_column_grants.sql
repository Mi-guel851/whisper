-- Column REVOKE alone cannot override a table-level SELECT/UPDATE/INSERT grant.
-- Replace broad client grants with equivalent grants on non-secret columns.
-- Preserve RLS and existing column-only permissions; service_role is untouched.
-- Run after deploying the ProfileCard explicit projection (or together during
-- maintenance); old clients using profiles.select('*') will be denied, not leak.
begin;
do $$
declare
  spec record;
  role_name text;
  operation text;
  safe_columns text;
  secret_columns text;
  roles_with_table_access text[];
begin
  for spec in select * from (values
    ('profiles', array['recovery_phrase_hash']::text[], array['SELECT','INSERT','UPDATE']::text[]),
    ('messages', array['sender_country','sender_state','sender_city','sender_device',
      'sender_username','sender_email_name','sender_user_id']::text[], array['SELECT']::text[])
  ) as targets(table_name, secrets, operations)
  loop
    if to_regclass('public.' || spec.table_name) is null then continue; end if;
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into safe_columns from information_schema.columns
      where table_schema = 'public' and table_name = spec.table_name
        and not (column_name = any(spec.secrets));
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into secret_columns from information_schema.columns
      where table_schema = 'public' and table_name = spec.table_name
        and column_name = any(spec.secrets);
    if secret_columns is null then continue; end if;

    foreach operation in array spec.operations loop
      -- Capture effective permissions BEFORE revoking PUBLIC inheritance.
      -- `has_table_privilege` does not report a role whose existing access is
      -- made up only of column grants. Check those too, or this migration can
      -- revoke the table grant and leave a legitimate browser role with no
      -- SELECT/INSERT/UPDATE access at all.
      roles_with_table_access := array[]::text[];
      foreach role_name in array array['anon','authenticated'] loop
        if has_table_privilege(role_name, 'public.' || spec.table_name, operation)
           or exists (
             select 1
             from information_schema.columns c
             where c.table_schema = 'public'
               and c.table_name = spec.table_name
               and not (c.column_name = any(spec.secrets))
               and has_column_privilege(
                 role_name,
                 'public.' || spec.table_name,
                 c.column_name,
                 operation
               )
           ) then
          roles_with_table_access := array_append(roles_with_table_access, role_name);
        end if;
      end loop;
      execute format('revoke %s on table public.%I from public, anon, authenticated', operation, spec.table_name);
      execute format('revoke %s (%s) on table public.%I from public, anon, authenticated', operation, secret_columns, spec.table_name);
      foreach role_name in array roles_with_table_access loop
        if safe_columns is not null then
          execute format('grant %s (%s) on table public.%I to %I', operation, safe_columns, spec.table_name, role_name);
        end if;
      end loop;
    end loop;
  end loop;
end $$;
commit;
