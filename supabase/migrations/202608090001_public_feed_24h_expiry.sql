-- Public feed posts live for 24 hours instead of 30 days.
--
-- The window is enforced in three places, and all three have to agree or posts
-- outlive their own deadline:
--   1. the column default, for plain inserts;
--   2. the before-insert trigger, which is what actually stamps the row today;
--   3. the retention job, which deletes what the RLS select policy already hides.
--
-- Nothing is dropped or renamed here — the table, its columns, policies and
-- realtime publication are untouched. Only the duration changes.

alter table public.public_feed_posts
  alter column expires_at set default (now() + interval '24 hours');

-- The link trigger also owns expires_at. It used to coalesce against a 30-day
-- window, which the NOT NULL default made unreachable anyway; now the deadline
-- is set explicitly on insert.
--
-- The `tg_op = 'INSERT'` guard matters: this trigger fires on UPDATE too, and
-- view_count is updated on every impression (see
-- 202608030001_public_feed_metrics.sql). Without the guard, a popular post would
-- have its 24 hours reset by its own view counter and never expire.
create or replace function public.set_public_feed_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  profile_username text;
begin
  select username into profile_username from public.profiles where id = new.author_id;
  if profile_username is null then raise exception 'Profile username is required'; end if;
  new.whisper_link := '/u/' || profile_username;

  if tg_op = 'INSERT' then
    new.expires_at := coalesce(new.created_at, now()) + interval '24 hours';
  end if;

  return new;
end;
$$;

-- Pull existing rows into the new window rather than leaving a month of history
-- sitting above a feed that promises 24 hours. Posts already older than a day
-- land in the past and the next cleanup run removes them, which is the intent.
update public.public_feed_posts
set expires_at = created_at + interval '24 hours'
where expires_at > created_at + interval '24 hours';

-- Replies whose parent has expired are dropped by the client tree builder, so
-- they'd otherwise linger as unreachable rows. Expire a reply no later than the
-- post it answers.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'public_feed_posts'
      and column_name = 'parent_post_id'
  ) then
    update public.public_feed_posts child
    set expires_at = least(child.expires_at, parent.expires_at)
    from public.public_feed_posts parent
    where child.parent_post_id = parent.id
      and child.expires_at > parent.expires_at;
  end if;
end $$;

-- A 24-hour window needs sweeping more often than once a night: at a daily
-- cadence a post can sit deleted-but-present for most of a second day.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule('public-feed-expiry');
  end if;
exception when others then null;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule(
      'public-feed-expiry',
      '17 * * * *',
      'select public.cleanup_expired_public_feed_posts()'
    );
  end if;
exception when unique_violation then null;
end $$;
