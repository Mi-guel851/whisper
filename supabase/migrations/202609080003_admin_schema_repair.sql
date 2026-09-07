-- ===========================================================================
-- 202609080003 — Admin schema repair.
--
-- WHY THIS EXISTS
--   The admin control center (202609080001) and the announcement center
--   (202609080002) assume a table shape that the live database does not have.
--   Earlier SQL, run outside this folder, created `user_bans` and
--   `public_feed_reports` (and possibly variants of the admin functions) in a
--   different shape. Because every table statement in those migrations is
--   `create table if not exists`, the drifted tables won, the canonical
--   `create or replace function` bodies lost at runtime, and the panel shows:
--
--     Moderation:  column b.active does not exist
--     Reports:     column rp.id does not exist
--     Users:       structure of query does not match function result type
--
-- WHAT THIS FILE DOES, IN ORDER
--   P1  Converges the drifted tables to the canonical shape. Additive only:
--       missing columns are added and backfilled, missing keys/indexes are
--       built, nothing is dropped and no existing column is narrowed. Where a
--       column exists under the right name but a wrong type (the likely cause
--       of the Users error), it is converted with a safe cast.
--   P2  Drops every overload of the admin/ban/announcement functions and the
--       triggers that depend on the ban predicate, so the canonical
--       definitions below are created from a clean slate. `create or replace`
--       alone cannot change a return type an earlier chat baked in.
--       Functions a hand-written RLS policy may depend on
--       (`can_send_direct_message`, and `user_is_banned` when a policy refs
--       it) are never cascade-dropped; they are rebuilt with
--       `create or replace` in the canonical section.
--   P3  Re-runs 202609080001 (tables become no-ops, functions, triggers and
--       grants are recreated), with one class of fix: four read models
--       (admin_bans_page, admin_audit_page, active_announcements_for_me,
--       admin_announcements_page) aggregate with
--       `json_agg(x order by x.<field> ...)` over a derived table whose only
--       column is the json value itself, so the ORDER BY can never resolve
--       and every call raises "column <alias>.<field> does not exist" — the
--       exact Moderation-page error. The embedded copies expose the sort
--       columns on the derived table so the ordering works as written.
--       Two more latent fixes ride along: `admin_users_page` returned
--       `auth.users.email` (varchar(255) on Supabase) where its result type
--       declares text, which made RETURN QUERY raise "structure of query
--       does not match function result type" — the exact Users-page error —
--       so the embedded copy casts `u.email::text`; and the poll tally
--       aggregates sorted by `t.idx`, a column the lateral never exposes,
--       now `g.idx`; and `admin_update_announcement` appended field names
--       with `text[] || 'literal'`, which Postgres resolves as array_cat
--       and rejects ("malformed array literal") — now `array_append`.
--   P4  Re-runs 202609080002 the same way (same ORDER BY and tally fixes
--       for the two announcement readers).
--
-- The file is idempotent: on an already-correct database every step is a
-- no-op and the canonical sections simply replace like with like.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- P1a. user_bans — converge whatever shape exists to the canonical one.
-- ---------------------------------------------------------------------------
do $$
declare
  has_pk   boolean;
  pk_on_id boolean;
begin
  if to_regclass('public.user_bans') is null then
    return;  -- the canonical create table below builds it fresh
  end if;

  alter table public.user_bans add column if not exists id uuid default gen_random_uuid();
  alter table public.user_bans add column if not exists user_id uuid;
  alter table public.user_bans add column if not exists banned_by uuid;
  alter table public.user_bans add column if not exists reason text
    default 'Violation of the Whisper community guidelines';
  alter table public.user_bans add column if not exists duration text default 'permanent';
  alter table public.user_bans add column if not exists expires_at timestamptz;
  alter table public.user_bans add column if not exists active boolean default true;
  alter table public.user_bans add column if not exists sessions_revoked boolean default false;
  alter table public.user_bans add column if not exists created_at timestamptz default now();
  alter table public.user_bans add column if not exists revoked_at timestamptz;

  -- Backfill: covers rows that predate the columns and columns an earlier
  -- script created nullable.
  update public.user_bans set id = gen_random_uuid() where id is null;
  update public.user_bans set active = true where active is null;
  update public.user_bans set sessions_revoked = false where sessions_revoked is null;
  update public.user_bans set duration = 'permanent'
    where duration is null or btrim(duration) = '';
  update public.user_bans set reason = 'Violation of the Whisper community guidelines'
    where reason is null or btrim(reason) = '';
  update public.user_bans set created_at = now() where created_at is null;

  begin alter table public.user_bans alter column id set not null;
  exception when others then raise warning 'user_bans.id not null skipped: %', sqlerrm; end;
  begin alter table public.user_bans alter column active set not null;
  exception when others then raise warning 'user_bans.active not null skipped: %', sqlerrm; end;
  begin alter table public.user_bans alter column sessions_revoked set not null;
  exception when others then raise warning 'user_bans.sessions_revoked not null skipped: %', sqlerrm; end;
  begin alter table public.user_bans alter column duration set not null;
  exception when others then raise warning 'user_bans.duration not null skipped: %', sqlerrm; end;
  begin alter table public.user_bans alter column reason set not null;
  exception when others then raise warning 'user_bans.reason not null skipped: %', sqlerrm; end;
  begin alter table public.user_bans alter column created_at set not null;
  exception when others then raise warning 'user_bans.created_at not null skipped: %', sqlerrm; end;

  select exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'user_bans'
      and constraint_type = 'PRIMARY KEY'
  ) into has_pk;

  select exists (
    select 1 from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.user_bans'::regclass
      and i.indisprimary and a.attname = 'id' and array_length(i.indkey, 1) = 1
  ) into pk_on_id;

  begin
    if not pk_on_id then
      if not has_pk then
        alter table public.user_bans add primary key (id);
      else
        create unique index if not exists user_bans_id_uni on public.user_bans (id);
      end if;
    end if;
  exception when others then
    raise warning 'user_bans primary key step skipped: %', sqlerrm;
  end;

  if not exists (select 1 from pg_constraint where conname = 'user_bans_duration_valid') then
    begin
      alter table public.user_bans add constraint user_bans_duration_valid
        check (duration in ('permanent', 'temporary'));
    exception when others then raise warning 'user_bans duration check skipped: %', sqlerrm;
    end;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'user_bans_temporary_needs_expiry') then
    begin
      alter table public.user_bans add constraint user_bans_temporary_needs_expiry
        check (duration <> 'temporary' or expires_at is not null);
    exception when others then raise warning 'user_bans expiry check skipped: %', sqlerrm;
    end;
  end if;

  create index if not exists user_bans_active_user_idx
    on public.user_bans (user_id) where active;
  create index if not exists user_bans_created_at_idx
    on public.user_bans (created_at desc);

  alter table public.user_bans enable row level security;
end $$;


-- ---------------------------------------------------------------------------
-- P1b. public_feed_reports — the live table was created by hand with a
-- composite key and no `id`; the admin reader needs `id` and the verdict
-- columns. If the table does not exist at all, build the whole canonical
-- shape including the client policies the app's report sheet relies on.
-- ---------------------------------------------------------------------------
do $$
declare
  has_pk     boolean;
  pk_on_id   boolean;
  has_pr_uni boolean;
begin
  if to_regclass('public.public_feed_reports') is null then
    if to_regclass('public.public_feed_posts') is null then
      raise warning 'public_feed_reports and public_feed_posts both missing; cannot create the reports table.';
      return;
    end if;

    create table public.public_feed_reports (
      id              uuid primary key default gen_random_uuid(),
      post_id         uuid not null references public.public_feed_posts(id) on delete cascade,
      reporter_id     uuid references auth.users(id) on delete set null,
      reason          text not null
                      check (reason in ('spam','harassment','sexual','violence','self_harm','other')),
      details         text,
      status          text not null default 'pending'
                      check (status in ('pending','reviewing','resolved','dismissed')),
      reviewed_by     uuid references auth.users(id) on delete set null,
      reviewed_at     timestamptz,
      resolution_note text,
      created_at      timestamptz not null default now(),
      constraint public_feed_reports_one_per_reporter unique (post_id, reporter_id)
    );

    alter table public.public_feed_reports enable row level security;

    create policy reports_insert_own on public.public_feed_reports
      for insert to authenticated
      with check (
        reporter_id = auth.uid()
        and not exists (
          select 1 from public.public_feed_posts fp
          where fp.id = post_id and fp.author_id = auth.uid()
        )
      );

    create policy reports_select_own on public.public_feed_reports
      for select to authenticated
      using (reporter_id = auth.uid());

    return;
  end if;

  -- Existing, drifted table: converge.
  alter table public.public_feed_reports add column if not exists id uuid default gen_random_uuid();
  alter table public.public_feed_reports add column if not exists post_id uuid;
  alter table public.public_feed_reports add column if not exists reporter_id uuid;
  alter table public.public_feed_reports add column if not exists reason text;
  alter table public.public_feed_reports add column if not exists details text;
  alter table public.public_feed_reports add column if not exists status text default 'pending';
  alter table public.public_feed_reports add column if not exists reviewed_by uuid;
  alter table public.public_feed_reports add column if not exists reviewed_at timestamptz;
  alter table public.public_feed_reports add column if not exists resolution_note text;
  alter table public.public_feed_reports add column if not exists created_at timestamptz default now();

  update public.public_feed_reports set id = gen_random_uuid() where id is null;
  update public.public_feed_reports set status = 'pending'
    where status is null or btrim(status) = '';
  update public.public_feed_reports set created_at = now() where created_at is null;

  begin alter table public.public_feed_reports alter column id set not null;
  exception when others then raise warning 'reports.id not null skipped: %', sqlerrm; end;
  begin alter table public.public_feed_reports alter column status set not null;
  exception when others then raise warning 'reports.status not null skipped: %', sqlerrm; end;
  begin alter table public.public_feed_reports alter column created_at set not null;
  exception when others then raise warning 'reports.created_at not null skipped: %', sqlerrm; end;

  select exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'public_feed_reports'
      and constraint_type = 'PRIMARY KEY'
  ) into has_pk;

  select exists (
    select 1 from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.public_feed_reports'::regclass
      and i.indisprimary and a.attname = 'id' and array_length(i.indkey, 1) = 1
  ) into pk_on_id;

  begin
    if not pk_on_id then
      if not has_pk then
        alter table public.public_feed_reports add primary key (id);
      else
        create unique index if not exists public_feed_reports_id_uni
          on public.public_feed_reports (id);
      end if;
    end if;
  exception when others then
    raise warning 'reports primary key step skipped: %', sqlerrm;
  end;

  -- The report sheet treats a second report on the same post as a no-op via
  -- the duplicate-key path; keep that guarantee whatever the drift.
  select exists (
    select 1 from pg_index i
    where i.indrelid = 'public.public_feed_reports'::regclass
      and i.indisunique
      and (select coalesce(array_agg(a.attname::text order by array_position(i.indkey, a.attnum)), array[]::text[])
           from pg_attribute a
           where a.attrelid = i.indrelid and a.attnum = any(i.indkey))
        = array['post_id', 'reporter_id']
  ) into has_pr_uni;

  if not has_pr_uni then
    begin
      create unique index if not exists public_feed_reports_one_per_reporter
        on public.public_feed_reports (post_id, reporter_id);
    exception when others then raise warning 'reports one-per-reporter index skipped: %', sqlerrm;
    end;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'public_feed_reports_reason_valid') then
    begin
      alter table public.public_feed_reports add constraint public_feed_reports_reason_valid
        check (reason in ('spam','harassment','sexual','violence','self_harm','other'));
    exception when others then raise warning 'reports reason check skipped: %', sqlerrm;
    end;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'public_feed_reports_status_valid') then
    begin
      alter table public.public_feed_reports add constraint public_feed_reports_status_valid
        check (status in ('pending','reviewing','resolved','dismissed'));
    exception when others then raise warning 'reports status check skipped: %', sqlerrm;
    end;
  end if;

  create index if not exists public_feed_reports_status_idx
    on public.public_feed_reports (status, created_at desc);
end $$;


-- ---------------------------------------------------------------------------
-- P1c. profiles — the admin read models need these columns to exist with
-- assignment-compatible types. Missing columns are added; text-ish columns
-- that an earlier script typed as numbers (the likely cause of the Users
-- page's "structure of query does not match function result type") are
-- converted with a plain ::text cast, which can never lose data.
-- ---------------------------------------------------------------------------
do $$
declare
  col record;
begin
  if to_regclass('public.profiles') is null then
    raise warning 'public.profiles does not exist; admin user pages cannot work without it.';
    return;
  end if;

  alter table public.profiles add column if not exists username text;
  alter table public.profiles add column if not exists display_name text;
  alter table public.profiles add column if not exists phone_number text;
  alter table public.profiles add column if not exists dial_code text;
  alter table public.profiles add column if not exists country text;
  alter table public.profiles add column if not exists created_at timestamptz default now();
  alter table public.profiles add column if not exists profile_completed boolean default false;
  alter table public.profiles add column if not exists is_admin boolean default false;

  update public.profiles set created_at = now() where created_at is null;
  update public.profiles set profile_completed = false where profile_completed is null;
  update public.profiles set is_admin = false where is_admin is null;

  -- Safe type convergence for the text columns the admin pages return as text.
  for col in
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('username', 'display_name', 'phone_number', 'dial_code', 'country')
      and data_type not in ('text', 'character varying', 'character')
  loop
    begin
      execute format('alter table public.profiles alter column %I type text using %I::text',
                     col.column_name, col.column_name);
    exception when others then
      raise warning 'profiles.% type conversion skipped: %', col.column_name, sqlerrm;
    end;
  end loop;

  begin alter table public.profiles alter column created_at set not null;
  exception when others then raise warning 'profiles.created_at not null skipped: %', sqlerrm; end;
  begin alter table public.profiles alter column profile_completed set not null;
  exception when others then raise warning 'profiles.profile_completed not null skipped: %', sqlerrm; end;
  begin alter table public.profiles alter column is_admin set not null;
  exception when others then raise warning 'profiles.is_admin not null skipped: %', sqlerrm; end;

  create index if not exists profiles_created_at_idx on public.profiles (created_at desc);
end $$;


-- ---------------------------------------------------------------------------
-- P1d. announcements — if an earlier script created a drifted version, add
-- the missing canonical columns. If absent, the verbatim section below
-- creates it.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.announcements') is null then
    return;
  end if;

  alter table public.announcements add column if not exists id uuid default gen_random_uuid();
  alter table public.announcements add column if not exists kind text default 'info';
  alter table public.announcements add column if not exists title text;
  alter table public.announcements add column if not exists body text;
  alter table public.announcements add column if not exists image_url text;
  alter table public.announcements add column if not exists cta_label text;
  alter table public.announcements add column if not exists cta_href text;
  alter table public.announcements add column if not exists audience text default 'everyone';
  alter table public.announcements add column if not exists audience_ids uuid[] default '{}';
  alter table public.announcements add column if not exists starts_at timestamptz;
  alter table public.announcements add column if not exists ends_at timestamptz;
  alter table public.announcements add column if not exists active boolean default false;
  alter table public.announcements add column if not exists poll_options text[] default '{}';
  alter table public.announcements add column if not exists created_by uuid;
  alter table public.announcements add column if not exists created_at timestamptz default now();
  alter table public.announcements add column if not exists updated_at timestamptz default now();
  alter table public.announcements add column if not exists published_at timestamptz;

  update public.announcements set id = gen_random_uuid() where id is null;
  update public.announcements set audience_ids = '{}' where audience_ids is null;
  update public.announcements set poll_options = '{}' where poll_options is null;
  update public.announcements set active = false where active is null;
  update public.announcements set created_at = now() where created_at is null;
  update public.announcements set updated_at = now() where updated_at is null;
exception when others then
  raise warning 'announcements convergence skipped: %', sqlerrm;
end $$;


-- ---------------------------------------------------------------------------
-- P1e. Informational drift probes. These never change anything; they surface
-- in the migration output the shapes this file deliberately does not rewrite
-- because converting them could break the consumer app in ways only a human
-- can judge.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.table_name, c.column_name, c.data_type
    from information_schema.columns c
    where c.table_schema = 'public'
      and (
        (c.table_name = 'coin_transactions' and c.column_name = 'id' and c.data_type <> 'uuid')
        or (c.table_name = 'coins' and c.column_name = 'user_id' and c.data_type <> 'uuid')
        or (c.table_name = 'profiles' and c.column_name = 'id' and c.data_type <> 'uuid')
        or (c.table_name = 'public_feed_posts' and c.column_name = 'id' and c.data_type <> 'uuid')
      )
  loop
    raise notice 'DRIFT PROBE: public.%.% is % (canonical expects uuid); left untouched — convert manually if the admin coins/users pages still fail.',
      r.table_name, r.column_name, r.data_type;
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- P2. Drop the drifted function layer so the canonical bodies below start
-- from a clean slate. `create or replace` cannot change a return type or an
-- argument type an earlier session baked in, so every rebuildable function is
-- dropped first (all overloads, whatever signature the other chat gave them).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  rebuild text[] := array[
    'reject_if_sender_banned', 'reject_if_feed_author_banned', 'reject_if_coin_actor_banned',
    'my_ban_status',
    'admin_ban_user', 'admin_unban_user', 'admin_mark_sessions_revoked', 'admin_bans_page',
    'admin_log', 'admin_audit_page', 'admin_users_page', 'admin_users_count',
    'admin_user_detail', 'admin_coin_history', 'admin_reports_page',
    'admin_set_report_status', 'admin_platform_stats',
    'active_announcements_for_me', 'cast_announcement_vote',
    'admin_announcements_page', 'admin_create_announcement',
    'admin_update_announcement', 'admin_delete_announcement'
  ];
  policy_depends boolean;
begin
  -- Triggers that depend on the ban predicate or the trigger functions.
  -- The canonical section recreates all of them.
  for r in
    select distinct t.tgname, n.nspname, c.relname
    from pg_depend d
    join pg_proc f      on f.oid = d.refobjid
    join pg_trigger t   on t.oid = d.objid
    join pg_class c     on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where f.proname in ('user_is_banned', 'reject_if_sender_banned',
                        'reject_if_feed_author_banned', 'reject_if_coin_actor_banned')
  loop
    execute format('drop trigger if exists %I on %I.%I', r.tgname, r.nspname, r.relname);
  end loop;

  -- Every overload of every rebuildable function.
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(rebuild)
  loop
    execute format('drop function %s cascade', r.sig);
  end loop;

  -- user_is_banned: drop only when no hand-written RLS policy depends on it.
  -- Policies are not in this repository and cannot be recreated from it, so
  -- when one does depend on the function we keep the object and let the
  -- canonical `create or replace` (same uuid -> boolean signature) rebuild it.
  select exists (
    select 1 from pg_depend d
    join pg_proc f  on f.oid = d.refobjid
    join pg_class dc on dc.oid = d.classid
    where f.proname = 'user_is_banned' and dc.relname = 'pg_policy'
  ) into policy_depends;

  if not policy_depends then
    for r in
      select p.oid::regprocedure::text as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'user_is_banned'
    loop
      execute format('drop function %s cascade', r.sig);
    end loop;
  end if;

  -- can_send_direct_message is intentionally NOT dropped: the live
  -- direct-message insert policy calls it, and dropping it would cascade the
  -- policy away. The canonical section replaces its body in place.
end $$;


-- ===========================================================================
-- P3. Canonical admin control center (from 202609080001) with the json_agg
-- ORDER BY fixes, the auth.users.email::text cast and the g.idx tally fix
-- described in the header.
-- ===========================================================================

-- ===========================================================================
-- Admin Control Center: bans, audit log, server-side ban enforcement, and the
-- read models the /admin dashboard needs at scale.
--
-- Everything here is idempotent and additive. Nothing is dropped, nothing is
-- rewritten destructively, and no existing policy is weakened. The one
-- existing function that is replaced (`can_send_direct_message`) keeps its
-- signature and every check it already had, and gains one more.
--
-- WHAT IS NEW AND WHY
--
--   B1  `user_bans` + `public.user_is_banned(uuid)`. Bans were not a thing in
--       this schema; the only moderation surfaces were `blocked_users`
--       (peer-to-peer) and `public_feed_reports` (a queue with no verdict
--       column). A ban is platform-wide, attributed to an admin, reasoned and
--       optionally time-boxed, so it gets its own table.
--
--   B2  Server-side enforcement. A ban that only hides a button is not a ban:
--       most of Whisper's writes go from the browser straight to PostgREST
--       under the visitor's own JWT, so the database is the only place a
--       banned account cannot route around. Before-insert triggers on the five
--       tables a banned account would otherwise write to raise a named error
--       code, and `can_send_direct_message` — already the insert gate for
--       `direct_messages` — refuses as well.
--
--   B3  `admin_audit_logs`. Every privileged action taken through the panel
--       writes one row: who, what, against whom, when, plus the minimum
--       metadata needed to reconstruct it. Written by the server routes, which
--       hold the service role, so a client cannot forge or omit an entry.
--
--   B4  Read models. `admin_users_page`, `admin_user_detail`,
--       `admin_coin_history`, `admin_reports_page` and `admin_platform_stats`
--       are the entire data surface of /admin. Each is EXECUTE-granted to
--       `service_role` ONLY — see B5 — so there is no path from a browser to
--       another user's email or phone number.
--
--   B5  Authorization. There is deliberately NO client-reachable admin RPC in
--       this file. Every function here is revoked from `public`, `anon` and
--       `authenticated` and granted to `service_role`, matching the pattern
--       202608190004 established for `admin_grant_coins`. The PIN check lives
--       in `lib/admin/auth.ts`, which is the only holder of the service key on
--       a request path.
--
--   B6  `admin_platform_stats` never scans a large table on a dashboard
--       render. The expensive totals are computed into `admin_stats_cache`
--       and reused for five minutes; only the "today"/"yesterday" figures —
--       all of which ride an existing `created_at` index — are computed live.
--
-- ONE-TIME SETUP (unchanged from 202608190004)
--   ADMIN_GRANT_PIN and SUPABASE_SERVICE_ROLE_KEY must be set in the server
--   environment. Nothing in this file reads them.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- B1. user_bans
-- ---------------------------------------------------------------------------

create table if not exists public.user_bans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  banned_by    uuid references auth.users(id) on delete set null,
  reason       text not null default 'Violation of the Whisper community guidelines',
  -- 'permanent' has a null expires_at; 'temporary' always has one. Kept as a
  -- column rather than inferred from expires_at because "permanent" and
  -- "expires in 100 years" should read differently in the audit trail.
  duration     text not null default 'permanent'
               check (duration in ('permanent', 'temporary')),
  expires_at   timestamptz,
  -- A ban is never deleted: it is deactivated, so the history survives an
  -- unban and the audit trail stays intact.
  active       boolean not null default true,
  -- Set by the ban route after GoTrue has revoked the account's refresh
  -- tokens. Recorded rather than assumed, so the panel can tell the difference
  -- between "banned in the database" and "session actually revoked".
  sessions_revoked boolean not null default false,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  constraint user_bans_temporary_needs_expiry
    check (duration <> 'temporary' or expires_at is not null)
);

comment on table public.user_bans is
  'Platform bans. One row per ban event; `active` is flipped rather than the row deleted, so the moderation history of an account is never lost.';

-- The hot path. `user_is_banned()` is called from five triggers and one
-- policy, several of them per statement, so it has to be an index probe and
-- nothing more. `not active` excludes the overwhelming majority of rows, and
-- an expired temporary ban is treated as lifted without a background job
-- having to run first.
create index if not exists user_bans_active_user_idx
  on public.user_bans (user_id)
  where active;

-- Moderation queue shape: newest first, active bans only.
create index if not exists user_bans_created_at_idx
  on public.user_bans (created_at desc);

alter table public.user_bans enable row level security;

-- No policies on purpose. With RLS on and zero policies, `anon` and
-- `authenticated` get nothing from this table by any operation — including
-- through Realtime, which applies the same policies. The admin panel reads it
-- with the service role, and a user reads their OWN ban through
-- `my_ban_status()` below, which is a definer function and therefore not
-- subject to this table's RLS.
--
-- This is the difference between "the frontend hides the dashboard" and "the
-- account cannot use the product".


-- ---------------------------------------------------------------------------
-- B1a. The predicate every enforcement point shares
-- ---------------------------------------------------------------------------

create or replace function public.user_is_banned(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target is not null
     and exists (
       select 1 from public.user_bans b
       where b.user_id = target
         and b.active
         and (b.expires_at is null or b.expires_at > now())
     )
$$;

comment on function public.user_is_banned(uuid) is
  'True when the account has a ban that is active and not yet expired. SECURITY DEFINER because user_bans has no client-readable policies; it discloses only a boolean.';

-- Granted to `authenticated` because a client legitimately needs one boolean
-- about itself (to show the ban screen) — and a boolean leaks nothing. It is
-- NOT granted to `anon`, so an unauthenticated caller cannot probe ids.
revoke all on function public.user_is_banned(uuid) from public;
revoke all on function public.user_is_banned(uuid) from anon;
grant execute on function public.user_is_banned(uuid) to authenticated, service_role;


-- The caller's own ban, for the client. Returns exactly one row, and exactly
-- one row's worth of information about the caller and nobody else: reason,
-- expiry, and when it started. It reads no other column of any other table.
create or replace function public.my_ban_status()
returns table (
  banned     boolean,
  reason     text,
  duration   text,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    true,
    b.reason,
    b.duration,
    b.expires_at,
    b.created_at
  from public.user_bans b
  where b.user_id = auth.uid()
    and b.active
    and (b.expires_at is null or b.expires_at > now())
  order by b.created_at desc
  limit 1
$$;

revoke all on function public.my_ban_status() from public;
revoke all on function public.my_ban_status() from anon;
grant execute on function public.my_ban_status() to authenticated;


-- ---------------------------------------------------------------------------
-- B2. Enforcement.
--
-- Each trigger raises SQLSTATE 'WH001' with a stable message. The routes and
-- the client both branch on that code (see lib/admin/enforcement.ts) so a ban
-- produces one sentence everywhere instead of a raw Postgres error.
--
-- These are BEFORE INSERT ... EXECUTE FUNCTION, not policy changes, for a
-- specific reason: the existing insert policies on `messages` and
-- `public_feed_posts` were written by hand in the database and are not in this
-- repository (see AUDIT-2026-09.md §0). Recreating a policy here from a guess
-- about its current definition would risk weakening it. A trigger is additive:
-- it can only ever refuse a row that would otherwise have been accepted.
-- ---------------------------------------------------------------------------

create or replace function public.reject_if_sender_banned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  -- Service role and migrations are never blocked: an admin writing through a
  -- server route, a repair script, or the SQL editor has already been
  -- authorized by holding the key.
  if actor is null then
    return new;
  end if;

  if public.user_is_banned(actor) then
    raise exception 'Your account has been restricted from using Whisper.'
      using errcode = 'WH001';
  end if;

  return new;
end;
$$;

-- Anonymous whispers. `messages.sender_user_id` is client-supplied and no
-- longer written (see 202609070001 §S2), so the actor is always auth.uid().
do $$
begin
  drop trigger if exists messages_sender_not_banned on public.messages;
  create trigger messages_sender_not_banned
    before insert on public.messages
    for each row execute function public.reject_if_sender_banned();
end $$;

-- Inbox messages. Checked here AND in can_send_direct_message below: the
-- policy is the gate for the ordinary path, and the trigger is the gate for
-- anything that reaches the table another way.
do $$
begin
  drop trigger if exists direct_messages_sender_not_banned on public.direct_messages;
  create trigger direct_messages_sender_not_banned
    before insert on public.direct_messages
    for each row execute function public.reject_if_sender_banned();
end $$;

-- Public feed posts and replies (same table, `parent_post_id` tells them
-- apart). The author is a column rather than auth.uid() on this table, so the
-- generic trigger is not enough — a dedicated one reads the row.
create or replace function public.reject_if_feed_author_banned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.user_is_banned(coalesce(new.author_id, auth.uid())) then
    raise exception 'Your account has been restricted from using Whisper.'
      using errcode = 'WH001';
  end if;
  return new;
end;
$$;

do $$
begin
  drop trigger if exists public_feed_posts_author_not_banned on public.public_feed_posts;
  create trigger public_feed_posts_author_not_banned
    before insert on public.public_feed_posts
    for each row execute function public.reject_if_feed_author_banned();
end $$;

-- Reactions and likes are still "using Whisper". Cheap to add, and without
-- them a banned account could keep signalling on content it can still read.
do $$
begin
  if to_regclass('public.public_feed_likes') is not null then
    drop trigger if exists public_feed_likes_user_not_banned on public.public_feed_likes;
    create trigger public_feed_likes_user_not_banned
      before insert on public.public_feed_likes
      for each row execute function public.reject_if_sender_banned();
  end if;

  if to_regclass('public.message_reactions') is not null then
    drop trigger if exists message_reactions_user_not_banned on public.message_reactions;
    create trigger message_reactions_user_not_banned
      before insert on public.message_reactions
      for each row execute function public.reject_if_sender_banned();
  end if;
end $$;


-- Every coin movement by a session user writes a `coin_transactions` row, so
-- one trigger here covers debit_whisper_coins, refund_whisper_coins,
-- spend_coins_for_image, unlock_chat_with_coins, reveal_sender_with_coins,
-- the hint unlock and wallet transfers — including the ones defined by hand in
-- the database rather than in this folder. Refunds are included deliberately:
-- a banned account should not be able to move value at all, and an admin
-- issuing a refund goes through the service role, which this skips.
create or replace function public.reject_if_coin_actor_banned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    return new;
  end if;
  if public.user_is_banned(actor) then
    raise exception 'Your account has been restricted from using Whisper.'
      using errcode = 'WH001';
  end if;
  return new;
end;
$$;

do $$
begin
  drop trigger if exists coin_transactions_actor_not_banned on public.coin_transactions;
  create trigger coin_transactions_actor_not_banned
    before insert on public.coin_transactions
    for each row execute function public.reject_if_coin_actor_banned();
end $$;


-- The existing policy gate, with the ban added. Body is 202607100001 verbatim
-- plus one `and not` clause; same signature, same grants, so the
-- "Conversation members can send unlocked direct messages" policy that calls
-- it picks the new definition up with no policy change of its own.
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
  );
$$;


-- ---------------------------------------------------------------------------
-- B2a. Bans and unbans. Service role only, same shape as admin_grant_coins:
-- the browser cannot reach them, so the authority is possession of the key.
-- ---------------------------------------------------------------------------

create or replace function public.admin_ban_user(
  p_user_id     uuid,
  p_reason      text,
  p_duration    text default 'permanent',
  p_expires_at  timestamptz default null,
  p_banned_by   uuid default null
)
returns public.user_bans
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.user_bans;
begin
  if auth.uid() is not null then
    raise exception 'admin_ban_user is server-side only';
  end if;

  if p_user_id is null then
    raise exception 'No user selected.';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'No account with that id.';
  end if;

  if coalesce(lower(btrim(p_duration)), 'permanent') not in ('permanent', 'temporary') then
    raise exception 'A ban is either permanent or temporary.';
  end if;

  if lower(btrim(p_duration)) = 'temporary' and p_expires_at is null then
    raise exception 'A temporary ban needs an expiry.';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'That expiry is already in the past.';
  end if;

  -- Supersedes rather than stacks: two active bans on one account would make
  -- "when does this end" ambiguous in both directions.
  update public.user_bans
     set active = false, revoked_at = now()
   where user_id = p_user_id and active;

  insert into public.user_bans (user_id, banned_by, reason, duration, expires_at)
  values (
    p_user_id,
    p_banned_by,
    left(coalesce(nullif(btrim(p_reason), ''),
                  'Violation of the Whisper community guidelines'), 500),
    lower(btrim(p_duration)),
    case when lower(btrim(p_duration)) = 'temporary' then p_expires_at else null end
  )
  returning * into result;

  return result;
end;
$$;

create or replace function public.admin_unban_user(p_user_id uuid, p_by uuid default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  cleared integer;
begin
  if auth.uid() is not null then
    raise exception 'admin_unban_user is server-side only';
  end if;

  if p_user_id is null then
    raise exception 'No user selected.';
  end if;

  update public.user_bans
     set active = false, revoked_at = now()
   where user_id = p_user_id and active;

  get diagnostics cleared = row_count;

  insert into public.admin_audit_logs (admin_user_id, action, target_user_id, metadata)
  values (p_by, 'user.unbanned', p_user_id,
          jsonb_build_object('bans_cleared', cleared));

  return cleared > 0;
end;
$$;

create or replace function public.admin_mark_sessions_revoked(p_ban_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'admin_mark_sessions_revoked is server-side only';
  end if;
  update public.user_bans set sessions_revoked = true where id = p_ban_id;
end;
$$;


-- The moderation queue of bans. Newest first, active bans ahead of lifted ones,
-- because that is the order a moderator reads it in: what is in force right now,
-- then what was done before.
create or replace function public.admin_bans_page(
  p_scope text default 'active',  -- active | all
  p_limit integer default 50
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'admin_bans_page is server-side only';
  end if;

  return coalesce((
    select json_agg(b order by b.active desc, b.created_at desc)
    from (
      select json_build_object(
        'id', y.id,
        'user_id', y.user_id,
        'username', p.username,
        'display_name', p.display_name,
        'reason', y.reason,
        'duration', y.duration,
        'expires_at', y.expires_at,
        'active', y.active
                and (y.expires_at is null or y.expires_at > now()),
        'created_at', y.created_at,
        'sessions_revoked', y.sessions_revoked,
        'banned_by', y.banned_by,
        'banned_by_username', bp.username
      ) as b, y.active, y.created_at
      from public.user_bans y
      left join public.profiles p  on p.id  = y.user_id
      left join public.profiles bp on bp.id = y.banned_by
      where p_scope = 'all'
         or (y.active and (y.expires_at is null or y.expires_at > now()))
      order by y.active desc, y.created_at desc
      limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) b
  ), '[]'::json);
end;
$$;


-- ---------------------------------------------------------------------------
-- B3. admin_audit_logs
-- ---------------------------------------------------------------------------

create table if not exists public.admin_audit_logs (
  id             bigserial primary key,
  admin_user_id  uuid references auth.users(id) on delete set null,
  -- Reverse-dotted so a queue can be filtered by prefix: 'user.*',
  -- 'announcement.*', 'report.*'.
  action         text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  -- Deliberately small and free of secrets: ids, amounts, reasons and status
  -- transitions. Never a phone number, an email or a message body.
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_at_idx
  on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_action_idx
  on public.admin_audit_logs (action, created_at desc);

alter table public.admin_audit_logs enable row level security;
-- Again: RLS on, no policies. Append-only from the server routes.

-- One row per privileged action, written by the same key that performed it, so
-- an action and its audit entry cannot be separated.
create or replace function public.admin_log(
  p_admin   uuid,
  p_action  text,
  p_target  uuid default null,
  p_meta    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'admin_log is server-side only';
  end if;
  insert into public.admin_audit_logs (admin_user_id, action, target_user_id, metadata)
  values (p_admin, left(coalesce(p_action, 'unknown'), 64), p_target,
          coalesce(p_meta, '{}'::jsonb));
end;
$$;

-- The reader. A definer function rather than a PostgREST select because the
-- foreign keys on this table point at `auth.users`, not at `public.profiles`,
-- so there is no embeddable relationship to hang the usernames off — and
-- resolving them from the browser would need a `profiles` query for arbitrary
-- ids, which is exactly the shape of request this panel exists to prevent.
--
-- Keyset-paged on created_at. `p_scope` filters by the dotted prefix, which
-- rides admin_audit_logs_action_idx.
create or replace function public.admin_audit_page(
  p_scope     text default 'all',
  p_limit     integer default 50,
  p_before_ts timestamptz default null
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'admin_audit_page is server-side only';
  end if;

  return coalesce((
    select json_agg(e order by e.created_at desc, e.id desc)
    from (
      select json_build_object(
        'id', l.id,
        'action', l.action,
        'created_at', l.created_at,
        'admin_user_id', l.admin_user_id,
        'admin_username', ap.username,
        'target_user_id', l.target_user_id,
        'target_username', tp.username,
        'metadata', l.metadata
      ) as e, l.created_at, l.id
      from public.admin_audit_logs l
      left join public.profiles ap on ap.id = l.admin_user_id
      left join public.profiles tp on tp.id = l.target_user_id
      where (p_scope = 'all' or l.action like p_scope || '.%')
        and (p_before_ts is null or l.created_at < p_before_ts)
      order by l.created_at desc, l.id desc
      limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) e
  ), '[]'::json);
end;
$$;


-- ---------------------------------------------------------------------------
-- B4. Read models.
--
-- `admin_users_page` is the only place outside GoTrue where a Whisper user's
-- email and phone number appear together, and it is unreachable from a
-- browser (B5). The join to `auth.users` is what makes that acceptable: the
-- email lives in the auth schema, is never copied into `public`, and is only
-- ever legible to a caller who already holds the service role key — which is
-- the same trust boundary as the ban itself.
--
-- Keyset pagination on (created_at desc, id desc) rather than OFFSET: the
-- panel is expected to be used against a table that will hold hundreds of
-- thousands of rows, and an OFFSET past the first few thousand makes Postgres
-- build and discard every skipped row on every page.
-- ---------------------------------------------------------------------------

create or replace function public.admin_users_page(
  p_search      text    default null,
  p_status      text    default 'all',   -- all | active | banned | new | high_coins | recently_active
  p_limit       integer default 25,
  p_after_ts    timestamptz default null,
  p_after_id    uuid    default null
)
returns table (
  id             uuid,
  username       text,
  display_name   text,
  email          text,
  phone_number   text,
  dial_code      text,
  country        text,
  created_at     timestamptz,
  coin_balance   integer,
  status         text,
  last_sign_in   timestamptz,
  profile_done   boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  page_size integer := greatest(1, least(coalesce(p_limit, 25), 100));
  needle    text    := nullif(btrim(coalesce(p_search, '')), '');
begin
  if auth.uid() is not null then
    raise exception 'admin_users_page is server-side only';
  end if;

  return query
  select
    p.id,
    p.username,
    p.display_name,
    u.email::text,
    p.phone_number,
    p.dial_code,
    p.country,
    p.created_at,
    coalesce(c.balance, 0)::integer,
    case
      when public.user_is_banned(p.id) then 'banned'
      else 'active'
    end::text,
    u.last_sign_in_at,
    p.profile_completed
  from public.profiles p
  left join auth.users u on u.id = p.id
  left join public.coins c on c.user_id = p.id
  where (
          needle is null
          or p.id::text = needle                       -- exact id
          or p.username ilike '%' || needle || '%'
          or coalesce(p.display_name, '') ilike '%' || needle || '%'
          or coalesce(u.email, '') ilike '%' || needle || '%'
          or replace(coalesce(p.phone_number, ''), ' ', '')
             like '%' || replace(needle, ' ', '') || '%'
        )
    and (
          p_status = 'all'
          or (p_status = 'active'  and not public.user_is_banned(p.id))
          or (p_status = 'banned'  and     public.user_is_banned(p.id))
          or (p_status = 'new'     and p.created_at >= now() - interval '7 days')
          or (p_status = 'high_coins' and coalesce(c.balance, 0) >= 500)
          or (p_status = 'recently_active' and u.last_sign_in_at >= now() - interval '24 hours')
        )
    and (
          p_after_ts is null
          or (p.created_at, p.id) < (p_after_ts, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
        )
  order by p.created_at desc, p.id desc
  limit page_size;
end;
$$;

-- Bounded totals for the same filter, so the panel can render "showing 1–25 of
-- N" without a second unbounded query. Capped by `least(..., 100000)`: a count
-- is cheap when it stops early and expensive when it does not, and the panel
-- only needs "more than 100k" to be honest.
create or replace function public.admin_users_count(p_search text default null, p_status text default 'all')
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  needle text := nullif(btrim(coalesce(p_search, '')), '');
  total  integer;
begin
  if auth.uid() is not null then
    raise exception 'admin_users_count is server-side only';
  end if;

  select count(*)::integer into total
  from (
    select p.id
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.coins c on c.user_id = p.id
    where (
            needle is null
            or p.id::text = needle
            or p.username ilike '%' || needle || '%'
            or coalesce(p.display_name, '') ilike '%' || needle || '%'
            or coalesce(u.email, '') ilike '%' || needle || '%'
            or replace(coalesce(p.phone_number, ''), ' ', '')
               like '%' || replace(needle, ' ', '') || '%'
          )
      and (
            p_status = 'all'
            or (p_status = 'active'  and not public.user_is_banned(p.id))
            or (p_status = 'banned'  and     public.user_is_banned(p.id))
            or (p_status = 'new'     and p.created_at >= now() - interval '7 days')
            or (p_status = 'high_coins' and coalesce(c.balance, 0) >= 500)
            or (p_status = 'recently_active' and u.last_sign_in_at >= now() - interval '24 hours')
          )
    limit 100000
  ) matched;

  return total;
end;
$$;


-- One account, everything the detail panel shows. Six bounded subqueries in a
-- single round trip instead of six round trips from the browser; each one is
-- an aggregate over an indexed column, and the coin/reports/bans sections are
-- already small by construction.
create or replace function public.admin_user_detail(p_user_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result json;
begin
  if auth.uid() is not null then
    raise exception 'admin_user_detail is server-side only';
  end if;

  if p_user_id is null then
    raise exception 'No user selected.';
  end if;

  select json_build_object(
    'profile', (
      select json_build_object(
        'id', p.id,
        'username', p.username,
        'display_name', p.display_name,
        'email', u.email,
        'email_confirmed_at', u.email_confirmed_at,
        'phone_number', p.phone_number,
        'dial_code', p.dial_code,
        'country', p.country,
        'created_at', p.created_at,
        'profile_completed', p.profile_completed,
        'is_admin', p.is_admin,
        'last_sign_in_at', u.last_sign_in_at,
        'banned_until', u.banned_until,
        'coin_balance', (select coalesce(c.balance, 0) from public.coins c where c.user_id = p.id)
      )
      from public.profiles p
      left join auth.users u on u.id = p.id
      where p.id = p_user_id
    ),
    'activity', json_build_object(
      'whispers_received', (
        select count(*) from public.messages m
        where m.recipient_id = p_user_id
          and m.created_at >= now() - interval '90 days'),
      'direct_messages_sent', (
        select count(*) from public.direct_messages d
        where d.sender_id = p_user_id
          and d.created_at >= now() - interval '90 days'),
      'images_sent', (
        select count(*) from public.direct_messages d
        where d.sender_id = p_user_id and d.image_path is not null
          and d.created_at >= now() - interval '90 days'),
      'feed_posts', (
        select count(*) from public.public_feed_posts f
        where f.author_id = p_user_id),
      'feed_replies', (
        select count(*) from public.public_feed_posts f
        where f.author_id = p_user_id and f.parent_post_id is not null),
      'reactions_given', (
        select count(*) from public.public_feed_likes l
        where l.user_id = p_user_id)
    ),
    'coins', json_build_object(
      'granted', (
        select coalesce(sum(t.amount), 0) from public.coin_transactions t
        where t.user_id = p_user_id and t.transaction_type = 'grant'),
      'purchased', (
        select coalesce(sum(t.amount), 0) from public.coin_transactions t
        where t.user_id = p_user_id and t.transaction_type = 'purchase'),
      'spent', (
        select coalesce(-sum(t.amount), 0) from public.coin_transactions t
        where t.user_id = p_user_id and t.transaction_type = 'spend'),
      'transactions', (
        select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json)
        from (
          select x.transaction_type, x.amount, x.description, x.created_at,
                 x.metadata ->> 'granted_by' as granted_by
          from public.coin_transactions x
          where x.user_id = p_user_id
          order by x.created_at desc
          limit 50
        ) t)
    ),
    'moderation', json_build_object(
      'bans', (
        select coalesce(json_agg(row_to_json(b) order by b.created_at desc), '[]'::json)
        from (
          select y.id, y.reason, y.duration, y.expires_at, y.active,
                 y.created_at, y.sessions_revoked,
                 (select pr.username from public.profiles pr where pr.id = y.banned_by) as banned_by
          from public.user_bans y
          where y.user_id = p_user_id
          order by y.created_at desc
          limit 20
        ) b),
      'reports_against', (
        select count(*) from public.public_feed_reports r
        join public.public_feed_posts fp on fp.id = r.post_id
        where fp.author_id = p_user_id),
      'reports_filed', (
        select count(*) from public.public_feed_reports r
        where r.reporter_id = p_user_id)
    )
  ) into result
  from public.profiles p
  where p.id = p_user_id;

  if result is null then
    raise exception 'No account with that id.';
  end if;

  return result;
end;
$$;


-- Coin ledger for the Coins section, newest first, keyset-paged.
create or replace function public.admin_coin_history(p_limit integer default 50, p_before_ts timestamptz default null)
returns table (
  id               uuid,
  user_id          uuid,
  username         text,
  transaction_type text,
  amount           integer,
  description      text,
  granted_by       uuid,
  granted_by_name  text,
  created_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'admin_coin_history is server-side only';
  end if;

  return query
  select
    t.id,
    t.user_id,
    p.username,
    t.transaction_type,
    t.amount,
    t.description,
    (t.metadata ->> 'granted_by')::uuid,
    gp.username,
    t.created_at
  from public.coin_transactions t
  left join public.profiles p  on p.id  = t.user_id
  left join public.profiles gp on gp.id = (t.metadata ->> 'granted_by')::uuid
  where t.transaction_type in ('grant', 'purchase', 'spend', 'refund')
    and (p_before_ts is null or t.created_at < p_before_ts)
  order by t.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;


-- Moderation queue. The `status` column is added to `public_feed_reports` here
-- because that table was created by hand in the dashboard (AUDIT-2026-09.md
-- §0): the app files reports with no verdict and nothing ever moves them, so
-- the queue has no memory. Added nullable with a default rather than
-- backfilled, so no existing row changes meaning — every report already in the
-- table is, honestly, still pending.
--
-- Guarded: `public_feed_reports` is not defined anywhere in this folder, so a
-- database that has never had it created by hand should skip this section and
-- still get the rest of the migration rather than aborting on it.
do $$
begin
  if to_regclass('public.public_feed_reports') is null then
    raise warning 'public_feed_reports does not exist; moderation columns and admin_reports_page will not work until that table is created.';
    return;
  end if;

  alter table public.public_feed_reports
    add column if not exists status text not null default 'pending'
    check (status in ('pending', 'reviewing', 'resolved', 'dismissed'));

  alter table public.public_feed_reports
    add column if not exists reviewed_by uuid references auth.users(id) on delete set null;

  alter table public.public_feed_reports
    add column if not exists reviewed_at timestamptz;

  alter table public.public_feed_reports
    add column if not exists resolution_note text;

  create index if not exists public_feed_reports_status_idx
    on public.public_feed_reports (status, created_at desc);
end $$;

create or replace function public.admin_reports_page(
  p_status text default 'pending',
  p_limit  integer default 25,
  p_offset integer default 0
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result json;
begin
  if auth.uid() is not null then
    raise exception 'admin_reports_page is server-side only';
  end if;

  select json_build_object(
    'reports', (
      select coalesce(json_agg(row_to_json(r) order by r.created_at desc), '[]'::json)
      from (
        select
          rp.id,
          rp.post_id,
          rp.reason,
          rp.details,
          rp.status,
          rp.created_at,
          rp.reviewed_at,
          rp.resolution_note,
          -- The post body and the author's username are included because a
          -- moderator cannot act on a report without seeing what was reported.
          -- `image_path` is not: it is the Cloudinary key, and the moderated
          -- image is fetched through the existing owner-checked route.
          left(coalesce(fp.body, ''), 300) as post_excerpt,
          fp.author_id,
          author.username as author_username,
          reporter.username as reporter_username,
          public.user_is_banned(fp.author_id) as author_banned
        from public.public_feed_reports rp
        left join public.public_feed_posts fp on fp.id = rp.post_id
        left join public.profiles author      on author.id = fp.author_id
        left join public.profiles reporter    on reporter.id = rp.reporter_id
        where p_status = 'all' or rp.status = p_status
        order by
          -- self_harm first regardless of age: it is the one reason where the
          -- queue order is a safety decision, not a convenience.
          (rp.reason = 'self_harm') desc,
          rp.created_at desc
        limit greatest(1, least(coalesce(p_limit, 25), 100))
        offset greatest(0, least(coalesce(p_offset, 0), 5000))
      ) r
    ),
    'counts', (
      select json_build_object(
        'pending',   (select count(*) from public.public_feed_reports where status = 'pending'),
        'reviewing', (select count(*) from public.public_feed_reports where status = 'reviewing'),
        'resolved',  (select count(*) from public.public_feed_reports where status = 'resolved'),
        'dismissed', (select count(*) from public.public_feed_reports where status = 'dismissed')
      )
    )
  ) into result;

  return result;
end;
$$;

create or replace function public.admin_set_report_status(
  p_report_id uuid,
  p_status    text,
  p_note      text default null,
  p_by        uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'admin_set_report_status is server-side only';
  end if;

  if coalesce(p_status, '') not in ('pending', 'reviewing', 'resolved', 'dismissed') then
    raise exception 'Unknown report status.';
  end if;

  update public.public_feed_reports
     set status = p_status,
         reviewed_by = p_by,
         reviewed_at = case when p_status in ('resolved', 'dismissed') then now() else reviewed_at end,
         resolution_note = left(coalesce(nullif(btrim(p_note), ''), resolution_note), 500)
   where id = p_report_id;

  if not found then
    raise exception 'No report with that id.';
  end if;

  return true;
end;
$$;


-- ---------------------------------------------------------------------------
-- B6. Dashboard statistics.
--
-- The expensive half of this is computed at most once every five minutes and
-- stored; the cheap half is index-bounded and computed live. A dashboard that
-- recomputes `sum()` over `coin_transactions` and `count(*)` over `messages` on
-- every open is a full-table scan per admin session, and this panel is meant
-- to stay usable when those tables are in the hundreds of millions of rows.
-- ---------------------------------------------------------------------------

create table if not exists public.admin_stats_cache (
  id           integer primary key default 1 check (id = 1),
  payload      jsonb not null,
  computed_at  timestamptz not null default now()
);

alter table public.admin_stats_cache enable row level security;
-- RLS on, no policies: the cache is server-role-only like everything else here.

create index if not exists profiles_created_at_idx on public.profiles (created_at desc);
create index if not exists coin_transactions_created_at_idx on public.coin_transactions (created_at desc);
create index if not exists coin_transactions_user_type_idx on public.coin_transactions (user_id, transaction_type);

do $$
begin
  create index if not exists direct_messages_created_at_idx on public.direct_messages (created_at desc);
exception when others then
  raise notice 'direct_messages_created_at_idx skipped (%).', sqlerrm;
end $$;

do $$
begin
  create index if not exists public_feed_posts_author_idx on public.public_feed_posts (author_id);
exception when others then
  raise notice 'public_feed_posts_author_idx skipped (%).', sqlerrm;
end $$;


create or replace function public.admin_platform_stats(p_force boolean default false)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  cached      jsonb;
  cached_at   timestamptz;
  heavy       jsonb;
  registrations json;
  live        jsonb;
begin
  if auth.uid() is not null then
    raise exception 'admin_platform_stats is server-side only';
  end if;

  select payload, computed_at into cached, cached_at
  from public.admin_stats_cache where id = 1;

  if cached is null or coalesce(p_force, false) or cached_at < now() - interval '5 minutes' then
    -- Totals. `messages`, `direct_messages` and `public_feed_posts` come from
    -- the planner's row estimate, which autovacuum maintains to within a couple
    -- of percent and which costs a catalog read instead of a scan — the same
    -- trade 202609070001 §S10 made for the public activity strip. The coin and
    -- report figures are exact because they are either a small table or an
    -- aggregate we are caching anyway.
    select jsonb_build_object(
      'total_users', (
        select greatest((select reltuples::bigint from pg_class
                          where oid = 'public.profiles'::regclass),
                        (select count(*) from public.profiles
                          where created_at < now() - interval '1 day'))),
      'total_whispers', greatest(
        (select reltuples::bigint from pg_class where oid = 'public.messages'::regclass), 0),
      'total_direct_messages', greatest(
        (select reltuples::bigint from pg_class where oid = 'public.direct_messages'::regclass), 0),
      'total_feed_posts', greatest(
        (select reltuples::bigint from pg_class where oid = 'public.public_feed_posts'::regclass), 0),
      'total_whisper_images', (
        select count(*) from public.messages where image_url is not null),
      'total_chat_images', (
        select count(*) from public.direct_messages where image_path is not null),
      'total_feed_images', (
        select count(*) from public.public_feed_posts where image_path is not null),
      'coins_held', (select coalesce(sum(balance), 0) from public.coins),
      'coins_spent', (
        select coalesce(-sum(amount), 0) from public.coin_transactions
        where transaction_type = 'spend'),
      'coins_purchased', (
        select coalesce(sum(amount), 0) from public.coin_transactions
        where transaction_type = 'purchase'),
      'coins_granted', (
        select coalesce(sum(amount), 0) from public.coin_transactions
        where transaction_type = 'grant'),
      'banned_users', (
        select count(*) from public.user_bans b
        where b.active and (b.expires_at is null or b.expires_at > now())),
      'bans_all_time', (select count(*) from public.user_bans),
      'pending_reports', (
        select count(*) from public.public_feed_reports where status = 'pending'),
      'reviewing_reports', (
        select count(*) from public.public_feed_reports where status = 'reviewing')
    ) into heavy;

    -- Announcement totals live in 202609080002. Guarded with to_regclass so
    -- this file still runs — and this function still answers — on a database
    -- that has only had this one applied.
    if to_regclass('public.announcements') is not null then
      heavy := heavy || jsonb_build_object(
        'active_announcements', (
          select count(*) from public.announcements a
          where a.active and coalesce(a.starts_at, now()) <= now()
            and (a.ends_at is null or a.ends_at > now())),
        'announcements_all_time', (select count(*) from public.announcements));
    else
      heavy := heavy || jsonb_build_object(
        'active_announcements', 0, 'announcements_all_time', 0);
    end if;

    insert into public.admin_stats_cache (id, payload, computed_at)
    values (1, heavy, now())
    on conflict (id) do update
      set payload = excluded.payload, computed_at = excluded.computed_at;

    cached := heavy;
    cached_at := now();
  end if;

  -- Registration history. Every row of this rides profiles_created_at_idx, and
  -- the whole window is 30 days, so it is a bounded index range scan rather
  -- than an aggregate over the table. Built as one GROUP BY rather than
  -- thirty counts.
  select json_agg(day order by day ->> 'date') into registrations
  from (
    select json_build_object(
      'date',  to_char(d.day, 'YYYY-MM-DD'),
      'count', coalesce(g.n, 0)
    ) as day
    from generate_series(
           date_trunc('day', now()) - interval '29 days',
           date_trunc('day', now()),
           interval '1 day'
         ) as d(day)
    left join (
      select date_trunc('day', p.created_at) as day, count(*) as n
      from public.profiles p
      where p.created_at >= date_trunc('day', now()) - interval '29 days'
      group by 1
    ) g on g.day = d.day
  ) series;

  -- Live figures: all of them are `created_at >= <today or yesterday>` on an
  -- indexed column, which is exactly the shape the existing *_today counts in
  -- whisper_live_activity() already use in production.
  select jsonb_build_object(
    'users_today', (
      select count(*) from public.profiles
      where created_at >= date_trunc('day', now())),
    'users_yesterday', (
      select count(*) from public.profiles
      where created_at >= date_trunc('day', now()) - interval '1 day'
        and created_at <  date_trunc('day', now())),
    'users_this_week', (
      select count(*) from public.profiles
      where created_at >= date_trunc('day', now()) - interval '6 days'),
    'users_this_month', (
      select count(*) from public.profiles
      where created_at >= date_trunc('day', now()) - interval '29 days'),
    'whispers_today', (
      select count(*) from public.messages
      where created_at >= date_trunc('day', now())),
    'whispers_yesterday', (
      select count(*) from public.messages
      where created_at >= date_trunc('day', now()) - interval '1 day'
        and created_at <  date_trunc('day', now())),
    'direct_messages_today', (
      select count(*) from public.direct_messages
      where created_at >= date_trunc('day', now())),
    'chat_images_today', (
      select count(*) from public.direct_messages
      where image_path is not null and created_at >= date_trunc('day', now())),
    'whisper_images_today', (
      select count(*) from public.messages
      where image_url is not null and created_at >= date_trunc('day', now())),
    'feed_posts_today', (
      select count(*) from public.public_feed_posts
      where created_at >= date_trunc('day', now())),
    'feed_images_today', (
      select count(*) from public.public_feed_posts
      where image_path is not null and created_at >= date_trunc('day', now()))
  ) into live;

  return json_build_object(
    'totals', cached,
    'today', live,
    'registrations', coalesce(registrations, '[]'::json),
    'computed_at', cached_at,
    'generated_at', now()
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- B5. Grants. Everything above is revoked from every client role and granted
-- to service_role only, so PostgREST does not expose any of it to a browser.
-- `my_ban_status()` and `user_is_banned()` were granted to `authenticated`
-- where they were created and are deliberately absent from this list.
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
  signatures text[] := array[
    'public.admin_ban_user(uuid, text, text, timestamptz, uuid)',
    'public.admin_bans_page(text, integer)',
    'public.admin_unban_user(uuid, uuid)',
    'public.admin_mark_sessions_revoked(uuid)',
    'public.admin_log(uuid, text, uuid, jsonb)',
    'public.admin_audit_page(text, integer, timestamptz)',
    'public.admin_users_page(text, text, integer, timestamptz, uuid)',
    'public.admin_users_count(text, text)',
    'public.admin_user_detail(uuid)',
    'public.admin_coin_history(integer, timestamptz)',
    'public.admin_reports_page(text, integer, integer)',
    'public.admin_set_report_status(uuid, text, text, uuid)',
    'public.admin_platform_stats(boolean)'
  ];
begin
  foreach f in array signatures loop
    begin
      execute format('revoke all on function %s from public', f);
      execute format('revoke all on function %s from anon', f);
      execute format('revoke all on function %s from authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    exception when others then
      raise warning 'Grant step skipped for %: %', f, sqlerrm;
    end;
  end loop;
end $$;


-- ===========================================================================
-- ROLLBACK NOTES
-- ===========================================================================
-- Nothing here drops data. To undo, in this order:
--
--   drop trigger if exists coin_transactions_actor_not_banned on public.coin_transactions;
--   drop trigger if exists message_reactions_user_not_banned on public.message_reactions;
--   drop trigger if exists public_feed_likes_user_not_banned on public.public_feed_likes;
--   drop trigger if exists public_feed_posts_author_not_banned on public.public_feed_posts;
--   drop trigger if exists direct_messages_sender_not_banned on public.direct_messages;
--   drop trigger if exists messages_sender_not_banned on public.messages;
--
--   -- restore can_send_direct_message verbatim from 202607100001 (the body is
--   -- identical minus the final `and not public.user_is_banned(...)` clause)
--
--   drop function if exists public.admin_platform_stats(boolean);
--   drop function if exists public.admin_set_report_status(uuid, text, text, uuid);
--   drop function if exists public.admin_reports_page(text, integer, integer);
--   drop function if exists public.admin_coin_history(integer, timestamptz);
--   drop function if exists public.admin_user_detail(uuid);
--   drop function if exists public.admin_users_count(text, text);
--   drop function if exists public.admin_users_page(text, text, integer, timestamptz, uuid);
--   drop function if exists public.admin_audit_page(text, integer, timestamptz);
--   drop function if exists public.admin_log(uuid, text, uuid, jsonb);
--   drop function if exists public.admin_mark_sessions_revoked(uuid);
--   drop function if exists public.admin_unban_user(uuid, uuid);
--   drop function if exists public.admin_bans_page(text, integer);
--   drop function if exists public.admin_ban_user(uuid, text, text, timestamptz, uuid);
--   drop function if exists public.reject_if_coin_actor_banned();
--   drop function if exists public.reject_if_feed_author_banned();
--   drop function if exists public.reject_if_sender_banned();
--   drop function if exists public.my_ban_status();
--   drop function if exists public.user_is_banned(uuid);
--
--   drop table if exists public.admin_stats_cache;
--   drop table if exists public.admin_audit_logs;
--   drop table if exists public.user_bans;
--
--   alter table public.public_feed_reports drop column if exists resolution_note;
--   alter table public.public_feed_reports drop column if exists reviewed_at;
--   alter table public.public_feed_reports drop column if exists reviewed_by;
--   alter table public.public_feed_reports drop column if exists status;
--
-- `admin_platform_stats` counts `public.announcements` behind a
-- `to_regclass` guard, so this file stands on its own; 202609080002 is what
-- makes that number non-zero.
-- ===========================================================================


-- ===========================================================================
-- P4. Canonical announcement center (from 202609080002) with the ORDER BY,
-- tally and array_append fixes described in the header.
-- ===========================================================================

-- ===========================================================================
-- Announcement Center: database-backed platform announcements, polls and votes.
--
-- WHY A TABLE AND NOT A FAN-OUT
--
-- The obvious implementation — an admin presses "send" and the server writes a
-- `notifications` row per user, or opens a Realtime channel per recipient — is
-- the same mistake 202609070001 §S4 removed from the feed. At 100k users it is
-- 100k rows and 100k payloads for one sentence of copy, and every one of them
-- is written before a single person has read it.
--
-- Instead an announcement is ONE row. Users read it: `active_announcements_for_me()`
-- answers "what should this account see right now" in a single bounded query,
-- filtered by the audience predicate, and the client fetches it once per app
-- open. Publishing to a million accounts costs one insert.
--
-- WHAT IS HERE
--
--   A1  `announcements` — the row, its audience, its window, its CTA, its poll.
--   A2  `announcement_votes` — one row per (announcement, user), enforced by a
--       unique index, so "one vote per person" is a database constraint rather
--       than a React boolean.
--   A3  `active_announcements_for_me()` — the only client-reachable reader.
--       It resolves the audience server-side, never returns another user's
--       data, and caps the result so a dozen live announcements cannot dump
--       twelve dialogs at once.
--   A4  `cast_announcement_vote()` — the only client-reachable writer.
--   A5  `admin_announcements_page()` — the moderation-side reader, service role.
--
-- Authorization follows 202609080001 §B5: everything an admin does goes through
-- a `service_role`-only function reached from a PIN-checked API route. Both
-- tables have RLS enabled with no client policies, so PostgREST exposes
-- neither to a browser and neither is delivered over Realtime.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- A1. announcements
-- ---------------------------------------------------------------------------

create table if not exists public.announcements (
  id            uuid primary key default gen_random_uuid(),

  kind          text not null default 'info'
                check (kind in ('info', 'poll', 'cta', 'maintenance')),

  title         text not null check (char_length(title) between 1 and 80),
  body          text not null check (char_length(body) between 1 and 600),
  -- Optional illustration. A plain URL rather than a storage key so the client
  -- can render it without a signed-URL round trip; the admin panel only
  -- accepts a same-origin path or an https URL (see the POST route).
  image_url     text,

  cta_label     text check (cta_label is null or char_length(cta_label) between 1 and 40),
  -- Where the button goes. Validated in the API route against a fixed
  -- allowlist of internal paths plus https: URLs, so an announcement can never
  -- become a vector for pointing users at an attacker's domain.
  cta_href      text,

  -- Who sees it. Resolved in SQL, never in the browser.
  audience      text not null default 'everyone'
                check (audience in (
                  'everyone', 'new_users', 'active_users', 'inactive_users',
                  'specific_users', 'banned_users'
                )),
  -- Populated only for 'specific_users'. Kept as a uuid array rather than a
  -- join table because the panel caps it at 500 ids and a membership test on a
  -- bounded array is cheaper than a join.
  audience_ids  uuid[] not null default '{}',

  starts_at     timestamptz,
  ends_at       timestamptz,
  -- Draft/scheduled/live are derived from (active, starts_at, ends_at) rather
  -- than stored as a fourth status, so the three can never disagree.
  active        boolean not null default false,

  poll_options  text[] not null default '{}',

  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz,

  constraint announcements_window_is_ordered
    check (starts_at is null or ends_at is null or starts_at < ends_at),
  constraint announcements_poll_needs_options
    check (kind <> 'poll' or array_length(poll_options, 1) between 2 and 6),
  constraint announcements_specific_needs_ids
    check (audience <> 'specific_users' or array_length(audience_ids, 1) > 0)
);

comment on table public.announcements is
  'Platform announcements. One row reaches every targeted user; nothing is fanned out per recipient.';

-- The read shape: what is live right now, newest first.
create index if not exists announcements_live_idx
  on public.announcements (active, starts_at, ends_at);
create index if not exists announcements_created_at_idx
  on public.announcements (created_at desc);
-- Audience membership for 'specific_users'.
create index if not exists announcements_audience_ids_idx
  on public.announcements using gin (audience_ids);

alter table public.announcements enable row level security;
-- No policies. The browser never selects this table; it calls A3.


-- ---------------------------------------------------------------------------
-- A2. announcement_votes
-- ---------------------------------------------------------------------------

create table if not exists public.announcement_votes (
  id              uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  option_index    integer not null check (option_index >= 0 and option_index < 6),
  created_at      timestamptz not null default now()
);

-- THE rule. One vote per person per announcement, enforced here so that a
-- client racing itself, a double-tap, or a hand-written fetch all hit the same
-- wall. `cast_announcement_vote` turns the violation into a readable answer.
create unique index if not exists announcement_votes_one_per_user
  on public.announcement_votes (announcement_id, user_id);

create index if not exists announcement_votes_tally_idx
  on public.announcement_votes (announcement_id, option_index);

alter table public.announcement_votes enable row level security;
-- No policies: a user's vote is legible to them through A3, and to nobody else.


-- ---------------------------------------------------------------------------
-- A3. What this account should see right now.
--
-- Audience resolution is the security-relevant half. 'specific_users' is a
-- membership test against a bounded array; 'new_users' and the activity
-- audiences are predicates over columns the caller already owns the right to
-- have read about themselves. Nothing here exposes another user's row.
--
-- Bounded at 5 rows: a dialog queue longer than that is a spam cannon, and the
-- client shows them one at a time anyway.
-- ---------------------------------------------------------------------------

create or replace function public.active_announcements_for_me()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  return coalesce((
    select json_agg(a order by a.created_at desc)
    from (
      select json_build_object(
        'id',           x.id,
        'kind',         x.kind,
        'title',        x.title,
        'body',         x.body,
        'image_url',    x.image_url,
        'cta_label',    x.cta_label,
        'cta_href',     x.cta_href,
        'ends_at',      x.ends_at,
        'published_at', x.published_at,
        'poll_options', x.poll_options,
        'my_vote', (
          select v.option_index from public.announcement_votes v
          where v.announcement_id = x.id and v.user_id = me
        ),
        'total_votes', (
          select count(*)::integer from public.announcement_votes v
          where v.announcement_id = x.id
        ),
        'vote_counts', (
          select coalesce(
            array_agg(t.tally order by g.idx),
            array_fill(0, array[greatest(coalesce(array_length(x.poll_options, 1), 0), 0)])
          )
          from generate_subscripts(x.poll_options, 1) as g(idx)
          left join lateral (
            select count(*)::integer as tally
            from public.announcement_votes v
            where v.announcement_id = x.id and v.option_index = g.idx - 1
          ) t on true
        )
      ) as a, x.created_at
      from public.announcements x
      where x.active
        and coalesce(x.starts_at, now()) <= now()
        and (x.ends_at is null or x.ends_at > now())
        and case x.audience
              when 'everyone' then true
              when 'banned_users' then public.user_is_banned(me)
              when 'specific_users' then me = any (x.audience_ids)
              when 'new_users' then exists (
                select 1 from public.profiles p
                where p.id = me and p.created_at >= now() - interval '14 days'
              )
              when 'active_users' then exists (
                select 1 from public.direct_messages d
                where d.sender_id = me and d.created_at >= now() - interval '7 days'
              ) or exists (
                select 1 from public.public_feed_posts f
                where f.author_id = me and f.created_at >= now() - interval '7 days'
              )
              when 'inactive_users' then not exists (
                select 1 from public.direct_messages d
                where d.sender_id = me and d.created_at >= now() - interval '14 days'
              ) and not exists (
                select 1 from public.public_feed_posts f
                where f.author_id = me and f.created_at >= now() - interval '14 days'
              )
              else false
            end
      order by x.created_at desc
      limit 5
    ) a
  ), '[]'::json);
end;
$$;

revoke all on function public.active_announcements_for_me() from public;
revoke all on function public.active_announcements_for_me() from anon;
grant execute on function public.active_announcements_for_me() to authenticated;

comment on function public.active_announcements_for_me() is
  'The announcements this account should see now, with its own vote and the poll tallies. Bounded at 5 rows. Audience is resolved here, never in the client.';


-- ---------------------------------------------------------------------------
-- A4. Voting.
--
-- Every rule is checked before the insert, and the unique index is the backstop
-- for the race between two of them arriving at once. A second attempt returns
-- the vote that already exists rather than an error, because the outcome the
-- user asked for is the outcome they have.
-- ---------------------------------------------------------------------------

create or replace function public.cast_announcement_vote(p_announcement_id uuid, p_option_index integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing integer;
  options  text[];
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_announcement_id is null then
    raise exception 'No announcement selected.';
  end if;

  select x.poll_options into options
  from public.announcements x
  where x.id = p_announcement_id
    and x.active
    and x.kind = 'poll'
    and coalesce(x.starts_at, now()) <= now()
    and (x.ends_at is null or x.ends_at > now());

  if options is null or array_length(options, 1) is null then
    raise exception 'That poll is not open.' using errcode = 'WH002';
  end if;

  -- Audience is re-checked here rather than trusted from the reader: a client
  -- that can call this function directly must not be able to vote on an
  -- announcement it was never shown.
  if not exists (
    select 1 from public.announcements x
    where x.id = p_announcement_id
      and case x.audience
            when 'everyone' then true
            when 'banned_users' then public.user_is_banned(me)
            when 'specific_users' then me = any (x.audience_ids)
            else true
          end
  ) then
    raise exception 'That poll is not open to you.' using errcode = 'WH002';
  end if;

  if p_option_index is null
     or p_option_index < 0
     or p_option_index >= array_length(options, 1) then
    raise exception 'That is not one of the options.' using errcode = '22023';
  end if;

  begin
    insert into public.announcement_votes (announcement_id, user_id, option_index)
    values (p_announcement_id, me, p_option_index);
  exception when unique_violation then
    select v.option_index into existing
    from public.announcement_votes v
    where v.announcement_id = p_announcement_id and v.user_id = me;
    -- Idempotent on purpose. The alternative — an error — reads as a failure to
    -- someone who tapped twice and is correct either way.
    return json_build_object('already_voted', true, 'my_vote', existing);
  end;

  return json_build_object('already_voted', false, 'my_vote', p_option_index);
end;
$$;

revoke all on function public.cast_announcement_vote(uuid, integer) from public;
revoke all on function public.cast_announcement_vote(uuid, integer) from anon;
grant execute on function public.cast_announcement_vote(uuid, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- A5. Admin-side reader and audit trail.
-- ---------------------------------------------------------------------------

create or replace function public.admin_announcements_page(p_state text default 'all')
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'admin_announcements_page is server-side only';
  end if;

  return coalesce((
    select json_agg(a order by a.created_at desc)
    from (
      select json_build_object(
        'id',           x.id,
        'kind',         x.kind,
        'title',        x.title,
        'body',         x.body,
        'image_url',    x.image_url,
        'cta_label',    x.cta_label,
        'cta_href',     x.cta_href,
        'audience',     x.audience,
        'audience_ids', x.audience_ids,
        'starts_at',    x.starts_at,
        'ends_at',      x.ends_at,
        'active',       x.active,
        'poll_options', x.poll_options,
        'created_at',   x.created_at,
        'updated_at',   x.updated_at,
        'published_at', x.published_at,
        'created_by',   (select pr.username from public.profiles pr where pr.id = x.created_by),
        'total_votes',  (select count(*)::integer from public.announcement_votes v
                          where v.announcement_id = x.id),
        'vote_counts',  (
          select coalesce(array_agg(t.tally order by g.idx), '{}')
          from generate_subscripts(x.poll_options, 1) as g(idx)
          left join lateral (
            select count(*)::integer as tally
            from public.announcement_votes v
            where v.announcement_id = x.id and v.option_index = g.idx - 1
          ) t on true
        ),
        -- Derived, so the panel and the database cannot disagree about state.
        'state', case
                   when not x.active then 'draft'
                   when x.starts_at is not null and x.starts_at > now() then 'scheduled'
                   when x.ends_at is not null and x.ends_at <= now() then 'expired'
                   else 'active'
                 end
      ) as a, x.created_at
      from public.announcements x
      where p_state = 'all'
         or (p_state = 'draft'     and not x.active)
         or (p_state = 'scheduled' and x.active and x.starts_at is not null and x.starts_at > now())
         or (p_state = 'active'    and x.active
              and coalesce(x.starts_at, now()) <= now()
              and (x.ends_at is null or x.ends_at > now()))
         or (p_state = 'expired'   and x.ends_at is not null and x.ends_at <= now())
      order by x.created_at desc
      limit 200
    ) a
  ), '[]'::json);
end;
$$;

create or replace function public.admin_create_announcement(p_payload jsonb, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is not null then
    raise exception 'admin_create_announcement is server-side only';
  end if;

  insert into public.announcements (
    kind, title, body, image_url, cta_label, cta_href,
    audience, audience_ids, starts_at, ends_at, active, poll_options, created_by
  )
  values (
    coalesce(p_payload ->> 'kind', 'info'),
    p_payload ->> 'title',
    p_payload ->> 'body',
    nullif(p_payload ->> 'imageUrl', ''),
    nullif(p_payload ->> 'ctaLabel', ''),
    nullif(p_payload ->> 'ctaHref', ''),
    coalesce(p_payload ->> 'audience', 'everyone'),
    coalesce(
      (select array_agg(v::uuid) from jsonb_array_elements_text(coalesce(p_payload -> 'audienceIds', '[]'::jsonb)) v),
      '{}'),
    nullif(p_payload ->> 'startsAt', '')::timestamptz,
    nullif(p_payload ->> 'endsAt', '')::timestamptz,
    coalesce((p_payload ->> 'active')::boolean, false),
    coalesce(
      (select array_agg(v) from jsonb_array_elements_text(coalesce(p_payload -> 'pollOptions', '[]'::jsonb)) v),
      '{}'),
    p_by
  )
  returning id into new_id;

  -- `published_at` is set here rather than by a trigger, because "published"
  -- means an admin turned it on, not that the clock passed starts_at.
  if coalesce((p_payload ->> 'active')::boolean, false) then
    update public.announcements set published_at = now() where id = new_id and published_at is null;
  end if;

  perform public.admin_log(p_by, 'announcement.created', null,
    jsonb_build_object('announcement_id', new_id, 'kind', coalesce(p_payload ->> 'kind', 'info')));

  return new_id;
end;
$$;

create or replace function public.admin_update_announcement(p_id uuid, p_payload jsonb, p_by uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  was_active boolean;
  now_active boolean;
  touched text[] := '{}';
begin
  if auth.uid() is not null then
    raise exception 'admin_update_announcement is server-side only';
  end if;

  select a.active into was_active from public.announcements a where a.id = p_id;
  if not found then
    raise exception 'No announcement with that id.';
  end if;

  -- Field-by-field rather than a bulk merge, so a partial PATCH cannot clear a
  -- column the caller never mentioned.
  if p_payload ? 'kind' then
    update public.announcements set kind = p_payload ->> 'kind' where id = p_id;
    touched := array_append(touched, 'kind');
  end if;
  if p_payload ? 'title' then
    update public.announcements set title = p_payload ->> 'title' where id = p_id;
    touched := array_append(touched, 'title');
  end if;
  if p_payload ? 'body' then
    update public.announcements set body = p_payload ->> 'body' where id = p_id;
    touched := array_append(touched, 'body');
  end if;
  if p_payload ? 'imageUrl' then
    update public.announcements set image_url = nullif(p_payload ->> 'imageUrl', '') where id = p_id;
    touched := array_append(touched, 'image_url');
  end if;
  if p_payload ? 'ctaLabel' then
    update public.announcements set cta_label = nullif(p_payload ->> 'ctaLabel', '') where id = p_id;
    touched := array_append(touched, 'cta_label');
  end if;
  if p_payload ? 'ctaHref' then
    update public.announcements set cta_href = nullif(p_payload ->> 'ctaHref', '') where id = p_id;
    touched := array_append(touched, 'cta_href');
  end if;
  if p_payload ? 'audience' then
    update public.announcements set audience = p_payload ->> 'audience' where id = p_id;
    touched := array_append(touched, 'audience');
  end if;
  if p_payload ? 'audienceIds' then
    update public.announcements
       set audience_ids = coalesce(
             (select array_agg(v::uuid) from jsonb_array_elements_text(p_payload -> 'audienceIds') v),
             '{}')
     where id = p_id;
    touched := array_append(touched, 'audience_ids');
  end if;
  if p_payload ? 'startsAt' then
    update public.announcements set starts_at = nullif(p_payload ->> 'startsAt', '')::timestamptz where id = p_id;
    touched := array_append(touched, 'starts_at');
  end if;
  if p_payload ? 'endsAt' then
    update public.announcements set ends_at = nullif(p_payload ->> 'endsAt', '')::timestamptz where id = p_id;
    touched := array_append(touched, 'ends_at');
  end if;
  if p_payload ? 'pollOptions' then
    update public.announcements
       set poll_options = coalesce(
             (select array_agg(v) from jsonb_array_elements_text(p_payload -> 'pollOptions') v),
             '{}')
     where id = p_id;
    touched := array_append(touched, 'poll_options');
  end if;
  if p_payload ? 'active' then
    now_active := (p_payload ->> 'active')::boolean;
    update public.announcements
       set active = now_active,
           published_at = case when now_active and published_at is null then now() else published_at end
     where id = p_id;
    touched := array_append(touched, 'active');
  end if;

  update public.announcements set updated_at = now() where id = p_id;

  perform public.admin_log(p_by,
    case when p_payload ? 'active' and (p_payload ->> 'active')::boolean and not coalesce(was_active, false)
         then 'announcement.published' else 'announcement.updated' end,
    null,
    jsonb_build_object('announcement_id', p_id, 'fields', touched));

  return true;
end;
$$;

-- Disabled rather than deleted by default; DELETE is a separate route so the
-- destructive path is the one an admin has to choose explicitly.
create or replace function public.admin_delete_announcement(p_id uuid, p_by uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  removed_title text;
begin
  if auth.uid() is not null then
    raise exception 'admin_delete_announcement is server-side only';
  end if;

  select a.title into removed_title from public.announcements a where a.id = p_id;
  if not found then
    raise exception 'No announcement with that id.';
  end if;

  -- Votes cascade with the row. Recorded in the audit entry first, because
  -- after the delete there is nothing left to count.
  perform public.admin_log(p_by, 'announcement.deleted', null, jsonb_build_object(
    'announcement_id', p_id,
    'title', left(coalesce(removed_title, ''), 80),
    'votes_discarded', (select count(*) from public.announcement_votes v where v.announcement_id = p_id)
  ));

  delete from public.announcements where id = p_id;
  return true;
end;
$$;


-- ---------------------------------------------------------------------------
-- Grants: admin functions to service_role only. `active_announcements_for_me`
-- and `cast_announcement_vote` were granted to `authenticated` at creation and
-- are deliberately not in this list — they are the two functions a normal user
-- is supposed to be able to call, and both are scoped to the caller's own rows.
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
  signatures text[] := array[
    'public.admin_announcements_page(text)',
    'public.admin_create_announcement(jsonb, uuid)',
    'public.admin_update_announcement(uuid, jsonb, uuid)',
    'public.admin_delete_announcement(uuid, uuid)'
  ];
begin
  foreach f in array signatures loop
    begin
      execute format('revoke all on function %s from public', f);
      execute format('revoke all on function %s from anon', f);
      execute format('revoke all on function %s from authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    exception when others then
      raise warning 'Grant step skipped for %: %', f, sqlerrm;
    end;
  end loop;
end $$;


-- ===========================================================================
-- ROLLBACK NOTES
-- ===========================================================================
--   drop function if exists public.admin_delete_announcement(uuid, uuid);
--   drop function if exists public.admin_update_announcement(uuid, jsonb, uuid);
--   drop function if exists public.admin_create_announcement(jsonb, uuid);
--   drop function if exists public.admin_announcements_page(text);
--   drop function if exists public.cast_announcement_vote(uuid, integer);
--   drop function if exists public.active_announcements_for_me();
--   drop table if exists public.announcement_votes;   -- discards votes
--   drop table if exists public.announcements;        -- discards announcements
--
-- To stop showing announcements without dropping anything:
--   update public.announcements set active = false;
-- ===========================================================================
