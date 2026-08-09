-- Public feed posts expire 24 hours after they are written (was 30 days).
--
-- Two places decide the deadline, and changing only one of them silently does
-- nothing. The column default fires first, so `new.expires_at` is never null by
-- the time the trigger runs -- which means the `coalesce(new.expires_at, ...)`
-- in set_public_feed_link() has always won and the column default has always
-- been the real source of truth. Both are updated here, and the trigger now
-- stamps the deadline itself on insert so the two can't drift apart again.

-- 1. New rows: 24 hours from creation.
alter table public.public_feed_posts
  alter column expires_at set default (now() + interval '24 hours');

-- 2. The trigger that actually decides the value.
create or replace function public.set_public_feed_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  profile_username text;
begin
  select username into profile_username from public.profiles where id = new.author_id;
  if profile_username is null then raise exception 'Profile username is required'; end if;
  new.whisper_link := '/u/' || profile_username;
  -- Insert only. public_feed_link_trigger is `before insert or update`, and
  -- sync_public_feed_view_count() runs an UPDATE on this table for every
  -- impression (202608030001_public_feed_metrics.sql). Stamping on UPDATE too
  -- would let a post push its own deadline forward each time someone looked at
  -- it, so the posts people actually read would be the ones that never expire.
  --
  -- Not coalesced against new.expires_at either: the feed's promise is 24
  -- hours, so a client passing its own value can't quietly extend a post's life.
  if tg_op = 'INSERT' then
    new.expires_at := coalesce(new.created_at, now()) + interval '24 hours';
  end if;

  return new;
end;
$$;

-- 3. Existing rows keep whatever time they have left, capped at 24 hours from
--    when they were written. Posts already past that window fall to the
--    cleanup function below rather than being deleted here, so this migration
--    stays a pure schema change and the delete is auditable on its own.
update public.public_feed_posts
   set expires_at = created_at + interval '24 hours'
 where expires_at > created_at + interval '24 hours';

-- 3b. A reply can't outlive the post it answers. buildPostTree() in lib/feed.ts
--     drops replies whose parent is gone, so a reply that survives its parent is
--     an unreachable row the client will never render. Guarded on the column
--     existing, since 202608020001_add_parent_post_id.sql may not be applied.
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
end;
$$;

-- 4. Sweep. cleanup_expired_public_feed_posts() already exists and already
--    deletes on `expires_at <= now()`, so it needs no change -- but nothing was
--    calling it. Schedule it if pg_cron is available; if it isn't, the RLS
--    select policy (`expires_at > now()`) still hides expired posts from every
--    client, so the feed behaves correctly and the rows are merely tidied late.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('cleanup-public-feed');
    perform cron.schedule(
      'cleanup-public-feed',
      '17 * * * *',
      $cron$select public.cleanup_expired_public_feed_posts();$cron$
    );
  else
    raise notice 'pg_cron not installed; expired feed posts stay hidden by RLS but are not deleted. Call public.cleanup_expired_public_feed_posts() from a scheduled job.';
  end if;
exception
  -- unschedule() throws when the job doesn't exist yet, which is the normal
  -- first-run case. Scheduling is best-effort; it must not fail the migration.
  when others then
    begin
      perform cron.schedule(
        'cleanup-public-feed',
        '17 * * * *',
        $cron$select public.cleanup_expired_public_feed_posts();$cron$
      );
    exception when others then
      raise notice 'Could not schedule public feed cleanup: %', sqlerrm;
    end;
end;
$$;
