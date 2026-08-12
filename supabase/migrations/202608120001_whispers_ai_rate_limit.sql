-- ---------------------------------------------------------------------------
-- Whispers AI — durable per-user rate limiting
--
-- This is the ONLY database change the Whispers AI feature makes, and it stores
-- no conversation: no questions, no answers, no page context. Two counters and
-- two timestamps per user, and nothing else.
--
-- Why a table at all, when the Edge Function already limits in memory: an Edge
-- Function isolate is recycled and can run in several instances at once, so its
-- in-memory window is a speed bump rather than a guarantee. The Hugging Face
-- account behind this feature has a finite inference allowance, which makes the
-- guarantee worth one row per user.
--
-- The feature works WITHOUT this migration — supabase/functions/whispers-ai
-- detects the missing function, logs once, and falls back to in-memory limits
-- only. Applying it is recommended, not required.
--
-- Conversation history itself stays in the browser's session state; nothing
-- about it is persisted.
-- ---------------------------------------------------------------------------

create table if not exists public.whispers_ai_usage (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- Rolling short window (default: 12 requests / 5 minutes).
  window_started_at timestamptz not null default now(),
  window_count integer not null default 0,

  -- Calendar day in UTC (default: 80 requests / day).
  day_started_on date not null default (now() at time zone 'utc')::date,
  day_count integer not null default 0,

  updated_at timestamptz not null default now()
);

comment on table public.whispers_ai_usage is
  'Request counters for the Whispers AI assistant. Contains no message content.';

-- ---------------------------------------------------------------------------
-- RLS: on, with no policies at all.
--
-- That combination is the point. `whispers_ai_touch_rate_limit` below is
-- `security definer`, so it bypasses RLS and is the only way in; a browser
-- holding a user's anon-key JWT can neither read nor write these counters, so
-- nobody can inspect — or reset — their own limit.
-- ---------------------------------------------------------------------------

alter table public.whispers_ai_usage enable row level security;

revoke all on public.whispers_ai_usage from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Counter check + increment, in one statement.
--
-- Both windows are evaluated and, if the request is allowed, both are
-- incremented atomically — the `insert ... on conflict do update` holds the row
-- lock for the whole decision, so two concurrent requests from the same user
-- can't both slip through on the same remaining slot.
--
-- A rejected request does NOT increment, so hammering a locked-out account
-- cannot extend the lockout.
-- ---------------------------------------------------------------------------

create or replace function public.whispers_ai_touch_rate_limit(
  target_user uuid,
  max_per_window integer default 12,
  window_seconds integer default 300,
  max_per_day integer default 80
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
  row_window_started_at timestamptz;
  row_window_count integer;
  row_day_count integer;
  window_elapsed numeric;
begin
  if target_user is null then
    raise exception 'target_user is required';
  end if;

  -- Create the row on first use, and roll either window over if it has expired.
  insert into public.whispers_ai_usage as usage (user_id, window_started_at, window_count, day_started_on, day_count)
  values (target_user, now(), 0, today, 0)
  on conflict (user_id) do update
    set
      window_started_at = case
        when now() - usage.window_started_at >= make_interval(secs => window_seconds)
          then now()
        else usage.window_started_at
      end,
      window_count = case
        when now() - usage.window_started_at >= make_interval(secs => window_seconds)
          then 0
        else usage.window_count
      end,
      day_started_on = today,
      day_count = case when usage.day_started_on = today then usage.day_count else 0 end,
      updated_at = now()
  returning usage.window_started_at, usage.window_count, usage.day_count
  into row_window_started_at, row_window_count, row_day_count;

  -- Daily ceiling first: it's the one that can't be waited out in a minute.
  if row_day_count >= max_per_day then
    return jsonb_build_object(
      'allowed', false,
      'scope', 'day',
      -- Seconds until 00:00 UTC, when day_started_on rolls over above.
      'retry_after_seconds',
        greatest(1, ceil(extract(epoch from ((today + 1)::timestamptz - now())))::integer)
    );
  end if;

  if row_window_count >= max_per_window then
    window_elapsed := extract(epoch from (now() - row_window_started_at));
    return jsonb_build_object(
      'allowed', false,
      'scope', 'window',
      'retry_after_seconds', greatest(1, ceil(window_seconds - window_elapsed)::integer)
    );
  end if;

  update public.whispers_ai_usage
     set window_count = window_count + 1,
         day_count = day_count + 1,
         updated_at = now()
   where user_id = target_user
  returning window_count, day_count into row_window_count, row_day_count;

  return jsonb_build_object(
    'allowed', true,
    'remaining_window', greatest(0, max_per_window - row_window_count),
    'remaining_day', greatest(0, max_per_day - row_day_count)
  );
end;
$$;

-- Callable only by the Edge Function's service-role client. A user's own JWT
-- must not be able to reach this, or they could inflate or probe the counter
-- directly.
revoke all on function public.whispers_ai_touch_rate_limit(uuid, integer, integer, integer)
  from public, anon, authenticated;

grant execute on function public.whispers_ai_touch_rate_limit(uuid, integer, integer, integer)
  to service_role;
