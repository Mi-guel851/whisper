-- =============================================================================
-- Whisper Streaks — explicit check-in, repeating 7-day reward cycle
-- =============================================================================
-- This supersedes the behaviour of 202608200003 in two ways.
--
-- 1. READING A STREAK NO LONGER CHANGES IT.
--    `whisper_touch_streak` recorded today's date as a side effect of being
--    asked what the streak was, so merely opening the dashboard was the
--    check-in. The user could never *do* anything to keep a streak, which makes
--    it a visit counter wearing a streak's clothes. Split in two here:
--      * `whisper_streak_status(tz)` — read-only. Safe to call on every mount.
--      * `whisper_check_in(tz)`      — the only writer. Called from a button.
--
-- 2. THE REWARD REPEATS.
--    The old ladder paid (3,5) (7,15) (14,30) (30,75) once each, ever — so a
--    loyal user ran out of reasons to return on day 31 and never got another.
--    This pays a flat 4 coins every time a 7-day cycle completes, then starts a
--    fresh cycle. Renewable, so the loop has no end.
--
-- The anti-forgery design of 202608200003 is kept verbatim, because it is the
-- part that makes the number mean anything:
--   * The client can read its streak and can never write it — the new tables
--     have a select-own policy and no insert/update/delete policy at all, and
--     under RLS an absent policy is a denial.
--   * The writer takes no date parameter. Today comes from the server clock, so
--     a 7-day cycle cannot be back-filled from devtools.
--   * The day boundary comes from the caller's zone (validated against
--     `pg_timezone_names`, falling back to UTC) so someone in Lagos does not
--     lose a streak because UTC rolled over at 1am local. The worst a chosen
--     zone can do is shift the boundary a few hours; it still takes a genuine
--     consecutive day to add a genuine day.
--
-- `whisper_touch_streak` and `whisper_streak_rewards` are intentionally left in
-- place rather than dropped: the rewards table is the record of what was already
-- paid under the old ladder, and dropping the function would break any client
-- still deployed against it during a rollout. Nothing calls it after this.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. Cycle state, one row per user
--
-- Why a state row at all, when 202608200003 derived everything from the day
-- history with gaps-and-islands? Because a *cycle* is not derivable from the
-- dates alone. After a cycle completes the next day starts over at 1, so two
-- users with the same seven consecutive dates can be on different cycle days
-- depending on where their previous cycle ended. That boundary is a fact about
-- the past that has to be stored, not recomputed.
--
-- `run_length` is kept alongside it as the uncapped consecutive-day count, so
-- "longest streak" can still exceed 7 and stay worth bragging about.
-- ---------------------------------------------------------------------------

create table if not exists public.whisper_streak_state (
  user_id          uuid primary key references auth.users(id) on delete cascade,

  -- 0..7. Days into the current reward cycle. Reaches 7 on a payout day and is
  -- restarted to 1 by the next check-in, never left at 0 by the writer.
  cycle_day        integer not null default 0,

  -- Consecutive calendar days checked in, uncapped and independent of cycles.
  run_length       integer not null default 0,
  longest_run      integer not null default 0,

  cycles_completed integer not null default 0,
  last_check_in    date,
  updated_at       timestamptz not null default now(),

  constraint whisper_streak_state_cycle_day_check
    check (cycle_day >= 0 and cycle_day <= 7),
  constraint whisper_streak_state_run_check
    check (run_length >= 0 and longest_run >= run_length)
);

alter table public.whisper_streak_state enable row level security;

drop policy if exists "Users can view own streak state" on public.whisper_streak_state;
create policy "Users can view own streak state" on public.whisper_streak_state
  for select using (user_id = auth.uid());

-- Deliberately no insert/update/delete policy. See the header.


-- ---------------------------------------------------------------------------
-- 2. Completed cycles — the payout ledger
--
-- Keyed on `(user_id, completed_on)` rather than `(user_id, cycle_index)`. Both
-- are unique in practice, but the date is the one that also enforces "at most
-- one payout per calendar day", which is the property that actually protects the
-- wallet: two concurrent check-ins race into this key and the loser credits
-- nothing. `cycle_index` is stored for the audit trail, not as the guard.
-- ---------------------------------------------------------------------------

create table if not exists public.whisper_streak_cycles (
  user_id       uuid not null references auth.users(id) on delete cascade,
  completed_on  date not null,
  cycle_index   integer not null,
  coins_awarded integer not null,
  created_at    timestamptz not null default now(),
  primary key (user_id, completed_on)
);

-- The wallet history and the streak card both read a user's cycles newest-first.
create index if not exists whisper_streak_cycles_user_completed_idx
  on public.whisper_streak_cycles (user_id, completed_on desc);

alter table public.whisper_streak_cycles enable row level security;

drop policy if exists "Users can view own streak cycles" on public.whisper_streak_cycles;
create policy "Users can view own streak cycles" on public.whisper_streak_cycles
  for select using (user_id = auth.uid());

-- No write policy, same reason.


-- ---------------------------------------------------------------------------
-- 3. Read the streak. Writes nothing.
--
-- Returns the *effective* state, not the stored state. A row saying "cycle day
-- 4" is only true if the user checked in today or yesterday; if they last showed
-- up a week ago the run is broken and the honest answer is 0. Applying that here
-- rather than in the client means a stale row cannot render as a live streak,
-- and means the client never needs to know today's date to interpret the answer.
-- ---------------------------------------------------------------------------

create or replace function public.whisper_streak_status(tz text default 'UTC')
returns table (
  cycle_day        integer,
  cycle_length     integer,
  cycle_coins      integer,
  run_length       integer,
  longest_run      integer,
  cycles_completed integer,
  last_check_in    date,
  checked_in_today boolean,
  awarded_coins    integer,
  cycle_completed  boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  zone text;
  today date;
  st_cycle_day integer := 0;
  st_run       integer := 0;
  st_longest   integer := 0;
  st_cycles    integer := 0;
  st_last      date;
  eff_cycle_day integer := 0;
  eff_run       integer := 0;
begin
  -- Unauthenticated callers get an empty result rather than an error: the
  -- dashboard mounts this before it has necessarily settled on a session, and a
  -- thrown exception there would surface as a broken card.
  if uid is null then
    return;
  end if;

  zone := coalesce(
    (select name from pg_timezone_names where name = tz limit 1),
    'UTC'
  );
  today := (now() at time zone zone)::date;

  select s.cycle_day, s.run_length, s.longest_run, s.cycles_completed, s.last_check_in
    into st_cycle_day, st_run, st_longest, st_cycles, st_last
  from public.whisper_streak_state s
  where s.user_id = uid;

  -- No row yet: a user who has never checked in. Zeros, not null — the client
  -- renders a first-time card, not an error state.
  if not found then
    return query select 0, 7, 4, 0, 0, 0, null::date, false, 0, false;
    return;
  end if;

  if st_last is null or st_last < today - 1 then
    -- Broken run. `longest_run` and `cycles_completed` survive; the live
    -- numbers do not.
    eff_cycle_day := 0;
    eff_run       := 0;
  elsif st_cycle_day >= 7 and st_last < today then
    -- A cycle finished on an earlier day and was never restarted. Show an empty
    -- cycle rather than a full one, so the card reads as "a fresh week is
    -- waiting" instead of congratulating an achievement already banked. The run
    -- itself is still alive — checking in today continues it.
    eff_cycle_day := 0;
    eff_run       := st_run;
  else
    eff_cycle_day := st_cycle_day;
    eff_run       := st_run;
  end if;

  return query select
    eff_cycle_day,
    7,
    4,
    eff_run,
    st_longest,
    st_cycles,
    st_last,
    (st_last = today),
    0,
    false;
end $$;

comment on function public.whisper_streak_status(text) is
  'Read-only view of the calling user''s streak. Writes nothing, so it is safe to call on every mount. Returns effective (not stored) values: a run whose last check-in is older than yesterday reports as broken.';

revoke all on function public.whisper_streak_status(text) from public;
revoke all on function public.whisper_streak_status(text) from anon;
grant execute on function public.whisper_streak_status(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Check in. The only writer.
--
-- Idempotent per calendar day by three independent mechanisms, in order of
-- which one actually fires:
--
--   a. `for update` on the state row serialises concurrent calls, so the second
--      one sees `last_check_in = today` and returns early. This is what handles
--      a double-tap.
--   b. `whisper_streak_cycles`' primary key is checked on the payout, so even if
--      (a) were bypassed the wallet is credited at most once per day.
--   c. `cycle_day` can only reach 7 by incrementing, never by the reset-to-1
--      branch, so a payout needs a genuine seventh consecutive day.
--
-- Returns the same shape as `whisper_streak_status` plus what was awarded, so
-- the client has one parser and needs no follow-up read.
-- ---------------------------------------------------------------------------

create or replace function public.whisper_check_in(tz text default 'UTC')
returns table (
  cycle_day        integer,
  cycle_length     integer,
  cycle_coins      integer,
  run_length       integer,
  longest_run      integer,
  cycles_completed integer,
  last_check_in    date,
  checked_in_today boolean,
  awarded_coins    integer,
  cycle_completed  boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  zone text;
  today date;
  st_cycle_day integer;
  st_run       integer;
  st_longest   integer;
  st_cycles    integer;
  st_last      date;
  awarded  integer := 0;
  finished boolean := false;
begin
  if uid is null then
    return;
  end if;

  zone := coalesce(
    (select name from pg_timezone_names where name = tz limit 1),
    'UTC'
  );
  today := (now() at time zone zone)::date;

  -- Ensure the row exists, then take a row lock on it. Splitting these is what
  -- makes the lock reliable: `insert ... on conflict do nothing` does not lock
  -- the pre-existing row it collided with, so the `for update` below is what
  -- actually serialises two simultaneous taps.
  insert into public.whisper_streak_state (user_id)
  values (uid)
  on conflict (user_id) do nothing;

  select s.cycle_day, s.run_length, s.longest_run, s.cycles_completed, s.last_check_in
    into st_cycle_day, st_run, st_longest, st_cycles, st_last
  from public.whisper_streak_state s
  where s.user_id = uid
  for update;

  -- Already checked in today. Report the current state truthfully with nothing
  -- awarded, rather than erroring — the button is disabled in this state, so
  -- reaching here means a double-tap or a stale client, neither of which is
  -- worth an error toast.
  if st_last = today then
    return query select
      st_cycle_day, 7, 4, st_run, st_longest, st_cycles, st_last, true, 0, false;
    return;
  end if;

  -- Keep the day history from 202608200003 populated. It is no longer what the
  -- streak is computed from, but it is the audit trail behind these counters and
  -- the only place a per-day record exists.
  insert into public.whisper_streak_days (user_id, day)
  values (uid, today)
  on conflict (user_id, day) do nothing;

  -- The run continues only from yesterday. Any longer gap starts over.
  if st_last = today - 1 then
    st_run := st_run + 1;
  else
    st_run := 1;
  end if;

  -- The cycle continues from yesterday *and* only while it has room. A stored
  -- `cycle_day` of 7 means yesterday was a payout day, so today opens a new
  -- cycle at 1 even though the run itself is unbroken. This is the "then the
  -- streak restarts" half of the reward.
  if st_last = today - 1 and st_cycle_day < 7 then
    st_cycle_day := st_cycle_day + 1;
  else
    st_cycle_day := 1;
  end if;

  st_longest := greatest(st_longest, st_run);

  if st_cycle_day = 7 then
    insert into public.whisper_streak_cycles
      (user_id, completed_on, cycle_index, coins_awarded)
    values (uid, today, st_cycles + 1, 4)
    on conflict (user_id, completed_on) do nothing;

    if found then
      st_cycles := st_cycles + 1;
      awarded   := 4;
      finished  := true;

      insert into public.coins (user_id, balance)
      values (uid, 4)
      on conflict (user_id) do update
        set balance = coins.balance + 4,
            updated_at = now();

      insert into public.coin_transactions
        (user_id, transaction_type, amount, description, metadata)
      values (
        uid, 'reward', 4,
        '7-day streak reward',
        jsonb_build_object('cycle', st_cycles, 'source', 'streak_cycle')
      );
    end if;
    -- If the insert lost the race, `awarded` stays 0 and no popup is shown.
    -- Reporting coins the user did not receive is worse than reporting none.
  end if;

  update public.whisper_streak_state s
     set cycle_day        = st_cycle_day,
         run_length       = st_run,
         longest_run      = st_longest,
         cycles_completed = st_cycles,
         last_check_in    = today,
         updated_at       = now()
   where s.user_id = uid;

  return query select
    st_cycle_day, 7, 4, st_run, st_longest, st_cycles, today, true, awarded, finished;
end $$;

comment on function public.whisper_check_in(text) is
  'Records today as a check-in for the calling user and returns the resulting streak. Awards 4 coins each time a 7-day cycle completes, then the next check-in starts a fresh cycle. Idempotent per calendar day.';

revoke all on function public.whisper_check_in(text) from public;
revoke all on function public.whisper_check_in(text) from anon;
grant execute on function public.whisper_check_in(text) to authenticated;
