-- =============================================================================
-- Whisper Streaks
-- =============================================================================
-- A streak is the one number on the dashboard a user will actively try to
-- protect, which makes it the one number most worth faking. So the design here
-- starts from that: **the client can read its streak and can never write it.**
--
--  * `whisper_streak_days` has a select-own policy and no insert, update or
--    delete policy at all. Under RLS an absent policy is a denial, so the only
--    way a row is created is through the definer function below.
--  * That function writes exactly one day — today, from the server clock. There
--    is no parameter that lets a caller name a date, so a 30-day streak cannot be
--    back-filled from the browser.
--  * Milestone rewards are keyed `(user_id, milestone)`, so a milestone can pay
--    out exactly once no matter how many times the function is called. Two
--    concurrent calls race into the same primary key and the loser is a no-op.
--
-- The alternative — a `streak integer` column the client increments — would have
-- been a fraction of this code and worth nothing, because the number would mean
-- whatever the last person to open devtools decided it should mean.
--
-- Timezone: the day boundary comes from the caller's zone, so someone in Lagos
-- does not lose a streak because UTC rolled over at 1am local. The zone is
-- validated against `pg_timezone_names` and falls back to UTC, and it is not a
-- hole: the worst a chosen zone can do is shift the boundary by a few hours. It
-- still takes a genuine consecutive day to add a genuine day.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. The days a user showed up
-- ---------------------------------------------------------------------------

create table if not exists public.whisper_streak_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- The streak scan reads one user's days newest-first. The primary key already
-- covers (user_id, day); this exists for the descending ordering.
create index if not exists whisper_streak_days_user_day_idx
  on public.whisper_streak_days (user_id, day desc);

alter table public.whisper_streak_days enable row level security;

drop policy if exists "Users can view own streak days" on public.whisper_streak_days;
create policy "Users can view own streak days" on public.whisper_streak_days
  for select using (user_id = auth.uid());

-- Deliberately no insert/update/delete policy. See the header: this is the
-- mechanism that makes the streak mean something.


-- ---------------------------------------------------------------------------
-- 2. Milestones already paid for
-- ---------------------------------------------------------------------------

create table if not exists public.whisper_streak_rewards (
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone integer not null,
  coins_awarded integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, milestone)
);

alter table public.whisper_streak_rewards enable row level security;

drop policy if exists "Users can view own streak rewards" on public.whisper_streak_rewards;
create policy "Users can view own streak rewards" on public.whisper_streak_rewards
  for select using (user_id = auth.uid());

-- No write policy, same reason.


-- ---------------------------------------------------------------------------
-- 3. Allow 'reward' in the coin ledger
--
-- A milestone payout is neither a purchase nor a refund, and labelling it
-- 'purchase' would put a line in the user's own transaction history saying they
-- bought something they were given. The set is rebuilt from the values already
-- in the table -- the pattern established by 202608110001 and repeated in
-- 202608190002/4 -- so VALIDATE cannot fail on a type written by some path that
-- never made it into this folder. Both historical constraint names are dropped
-- because the original was auto-named by the inline column check.
-- ---------------------------------------------------------------------------

do $$
declare
  literals text;
begin
  select string_agg(quote_literal(v), ', ' order by v) into literals
  from (
    select distinct unnest(
      coalesce(
        (select array_agg(distinct transaction_type)
           from public.coin_transactions
          where transaction_type is not null),
        '{}'::text[]
      )
      || array['purchase', 'spend', 'refund', 'transfer_in', 'transfer_out', 'grant', 'reward']
    ) as v
  ) s;

  alter table public.coin_transactions
    drop constraint if exists coin_transactions_type_check;
  alter table public.coin_transactions
    drop constraint if exists coin_transactions_transaction_type_check;

  execute format(
    'alter table public.coin_transactions add constraint coin_transactions_type_check
       check (transaction_type in (%s)) not valid', literals);

  execute 'alter table public.coin_transactions validate constraint coin_transactions_type_check';
end $$;


-- ---------------------------------------------------------------------------
-- 4. Check in, and report the streak
--
-- One round trip: records today, computes current and longest, pays out any
-- milestone newly crossed, and returns the whole picture so the dashboard does
-- not need a second query to render.
-- ---------------------------------------------------------------------------

create or replace function public.whisper_touch_streak(tz text default 'UTC')
returns table (
  current_streak integer,
  longest_streak integer,
  last_active date,
  started_on date,
  milestone_reached integer,
  coins_awarded integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  zone text;
  today date;
  cur integer := 0;
  best integer := 0;
  first_day date;
  paid_milestone integer := null;
  paid_coins integer := 0;
begin
  -- Unauthenticated callers get an empty result rather than an error: the
  -- dashboard mounts this before it has necessarily settled on a session, and a
  -- thrown exception there would surface as a broken card.
  if uid is null then
    return;
  end if;

  -- An unknown zone falls back rather than failing. `pg_timezone_names` is the
  -- authority, so a caller cannot inject anything through this.
  zone := coalesce(
    (select name from pg_timezone_names where name = tz limit 1),
    'UTC'
  );
  today := (now() at time zone zone)::date;

  -- The only write. No parameter reaches this value.
  insert into public.whisper_streak_days (user_id, day)
  values (uid, today)
  on conflict (user_id, day) do nothing;

  -- Gaps and islands: subtracting a dense row number from a date leaves every
  -- run of consecutive days sharing one constant, so a run can be counted with
  -- a plain group by. Written as nested subqueries rather than CTEs because
  -- plpgsql's INTO is unambiguous here and merely probable with a leading WITH.
  select
    -- `today` was just inserted, so the run containing it always exists and the
    -- current streak is never null.
    coalesce(max(len) filter (where run_end = today), 0),
    coalesce(max(len), 0),
    max(run_start) filter (where run_end = today)
  into cur, best, first_day
  from (
    select island,
           count(*)::integer as len,
           min(day) as run_start,
           max(day) as run_end
    from (
      select day,
             day - (row_number() over (order by day))::integer as island
      from public.whisper_streak_days
      where user_id = uid
    ) d
    group by island
  ) runs;

  -- Every milestone at or below the current streak that has not been paid yet.
  -- Normally that is at most one, since a streak grows a day at a time; the loop
  -- exists so a backfill or a clock change cannot silently skip a payout.
  for paid_milestone, paid_coins in
    select m.milestone, m.coins
    from (values (3, 5), (7, 15), (14, 30), (30, 75)) as m(milestone, coins)
    where m.milestone <= cur
      and not exists (
        select 1 from public.whisper_streak_rewards r
        where r.user_id = uid and r.milestone = m.milestone
      )
    order by m.milestone
  loop
    -- The primary key is the guard. Two concurrent calls both pass the NOT
    -- EXISTS above; only one inserts, and the other credits nothing.
    insert into public.whisper_streak_rewards (user_id, milestone, coins_awarded)
    values (uid, paid_milestone, paid_coins)
    on conflict (user_id, milestone) do nothing;

    if found then
      insert into public.coins (user_id, balance)
      values (uid, paid_coins)
      on conflict (user_id) do update
        set balance = coins.balance + paid_coins,
            updated_at = now();

      insert into public.coin_transactions
        (user_id, transaction_type, amount, description, metadata)
      values (
        uid, 'reward', paid_coins,
        paid_milestone || '-day streak reward',
        jsonb_build_object('milestone', paid_milestone, 'source', 'streak')
      );
    else
      -- Lost the race. Report nothing paid rather than claiming coins the user
      -- did not receive.
      paid_coins := 0;
      paid_milestone := null;
    end if;
  end loop;

  return query
    select cur, best, today, first_day, paid_milestone, coalesce(paid_coins, 0);
end $$;

comment on function public.whisper_touch_streak(text) is
  'Records today for the calling user and returns their streak. The only writer of whisper_streak_days; clients have read-only access so a streak cannot be forged.';

revoke all on function public.whisper_touch_streak(text) from public;
revoke all on function public.whisper_touch_streak(text) from anon;
grant execute on function public.whisper_touch_streak(text) to authenticated;
