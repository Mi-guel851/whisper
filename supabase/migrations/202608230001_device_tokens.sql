-- Device tokens: the table the whole push path depends on, finally written down.
--
--
-- WHY THIS MIGRATION EXISTS
--
-- `public.device_tokens` has been in use since push was first wired up, but it
-- was created by hand in the dashboard and never committed. So the single fact
-- that decides whether any notification reaches a phone — which column the FCM
-- token lives in — existed only in whatever that dashboard form happened to say,
-- and the repo already disagreed with itself about it:
--
--   supabase/functions/notify-on-notification/index.ts   .select("fcm_token")
--   supabase/functions/notify-new-feed-post/index.ts     .select("fcm_token")
--   lib/push/useRegisterPushNotifications.ts             upsert({ fcm_token })
--   app/api/send-push/route.ts                           .select("token")     <-- wrong
--
-- One of those was always reading an empty set. `fcm_token` is canonical because
-- it is what the live delivery path uses; app/api/send-push/route.ts is corrected
-- in the same change as this file.
--
-- Everything here is guarded, so it is safe to run against a project that already
-- has the hand-made table and safe to re-run.


-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fcm_token text not null,
  platform text not null default 'android',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/*
  An older hand-made table may call the column `token`. Renaming rather than
  adding a second column on purpose: two columns would mean half the tokens are
  invisible to whichever query picked the other name, which is the bug this
  migration exists to end.
*/
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'device_tokens' and column_name = 'token'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'device_tokens' and column_name = 'fcm_token'
  ) then
    alter table public.device_tokens rename column token to fcm_token;
    raise notice 'device_tokens.token renamed to fcm_token';
  end if;
end $$;

-- Columns a hand-made version is unlikely to have had.
alter table public.device_tokens add column if not exists platform text not null default 'android';
alter table public.device_tokens add column if not exists created_at timestamptz not null default now();
alter table public.device_tokens add column if not exists updated_at timestamptz not null default now();

/*
  One physical device holds exactly one FCM token, so the token is the natural
  key. Unique server-side rather than trusted from the client: without this the
  registration upsert has nothing to conflict on, and a user who reinstalls
  accumulates a row per install — every one of which FCM then answers with
  UNREGISTERED, so the delivery count silently drifts away from reality.
*/
create unique index if not exists device_tokens_fcm_token_key
  on public.device_tokens (fcm_token);

-- Every read in the delivery path is `where user_id = ...`.
create index if not exists device_tokens_user_id_idx
  on public.device_tokens (user_id);


-- ---------------------------------------------------------------------------
-- 2. RLS: read and forget your own, and nothing else
-- ---------------------------------------------------------------------------

alter table public.device_tokens enable row level security;

/*
  Deliberately no insert or update policy for clients. Registration goes through
  the function in section 3 instead, because the honest policy for a plain upsert
  is unpleasant: the token is keyed on the *device*, so signing a second account
  in on the same phone has to move an existing row to a new owner — and a policy
  permitting that (`using (true)`) lets any caller reassign any row they can name.
  A definer function does the same job with no such policy: it can only ever
  assign a token to `auth.uid()`, whatever the caller asks for.

  Select stays own-only so a token — which is a bearer credential for delivering
  notifications to somebody's phone — is never readable by another account.
*/
drop policy if exists "device_tokens_select_own" on public.device_tokens;
create policy "device_tokens_select_own" on public.device_tokens
  for select to authenticated using (auth.uid() = user_id);

-- Signing out of a device should be able to revoke it.
drop policy if exists "device_tokens_delete_own" on public.device_tokens;
create policy "device_tokens_delete_own" on public.device_tokens
  for delete to authenticated using (auth.uid() = user_id);

-- The old permissive policies, if a hand-made setup left any behind.
drop policy if exists "device_tokens_insert_own" on public.device_tokens;
drop policy if exists "device_tokens_update_own" on public.device_tokens;
drop policy if exists "Users can insert their own tokens" on public.device_tokens;
drop policy if exists "Users can update their own tokens" on public.device_tokens;
drop policy if exists "Enable insert for authenticated users only" on public.device_tokens;


-- ---------------------------------------------------------------------------
-- 3. Registration
-- ---------------------------------------------------------------------------

/*
  Claims a token for the caller. Concurrency-safe by construction: the conflict
  target is the unique index from section 1, so two devices registering at once,
  or the same device registering twice while a retry is in flight, converge on one
  row instead of racing.

  `user_id` is taken from `auth.uid()` and never from an argument — that is the
  whole reason this is a function rather than a policy. A caller cannot register a
  token to anybody but themselves, so the account-switch case (device changes
  hands, token must follow) is handled without ever granting the ability to
  reassign somebody else's row.
*/
create or replace function public.register_device_token(
  p_fcm_token text,
  p_platform text default 'android'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  if p_fcm_token is null or length(trim(p_fcm_token)) = 0 then
    raise exception 'fcm token required';
  end if;

  insert into public.device_tokens (user_id, fcm_token, platform)
  values (
    caller,
    trim(p_fcm_token),
    case when p_platform in ('android', 'ios', 'web') then p_platform else 'android' end
  )
  on conflict (fcm_token) do update
    set user_id    = caller,
        platform   = excluded.platform,
        updated_at = now();
end;
$$;

revoke execute on function public.register_device_token(text, text) from public;
revoke execute on function public.register_device_token(text, text) from anon;
grant execute on function public.register_device_token(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. After applying this
-- ---------------------------------------------------------------------------

/*
  This migration only fixes the *storage*. Delivery still needs, once each:

    1. 202608190003_notification_delivery.sql applied (the triggers that call the
       edge functions).
    2. The two settings that migration documents:
         alter database postgres set app.settings.edge_base_url = '...';
         alter database postgres set app.settings.service_role_key = '...';
       Without them post_to_edge_function() raises a warning and sends nothing.
    3. FCM_PROJECT_ID and FCM_SERVICE_ACCOUNT_JSON set as edge function secrets.
    4. notify-on-notification and notify-new-feed-post deployed.
    5. A rebuilt APK, so the device actually registers a token.

  To confirm tokens are landing:

    select user_id, platform, left(fcm_token, 18) || '...', updated_at
    from public.device_tokens order by updated_at desc limit 20;
*/
