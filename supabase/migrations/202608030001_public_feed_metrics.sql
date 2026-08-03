-- Public feed engagement metrics: unique impressions per post.
-- Individual view rows stay private (you can only read your own); the aggregate
-- lives in a denormalised counter so the feed can show it without leaking who looked.

create table if not exists public.public_feed_post_views (
  post_id uuid not null references public.public_feed_posts(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, viewer_id)
);

alter table public.public_feed_posts
  add column if not exists view_count integer not null default 0;

create index if not exists public_feed_post_views_post_idx
  on public.public_feed_post_views (post_id);

alter table public.public_feed_post_views enable row level security;

drop policy if exists "Users can view own feed impressions" on public.public_feed_post_views;
create policy "Users can view own feed impressions" on public.public_feed_post_views
  for select using (auth.uid() = viewer_id);

-- Keep view_count in step with the rows, in both directions.
create or replace function public.sync_public_feed_view_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.public_feed_posts
    set view_count = view_count + 1
    where id = new.post_id;
    return new;
  end if;

  update public.public_feed_posts
  set view_count = greatest(0, view_count - 1)
  where id = old.post_id;
  return old;
end;
$$;

drop trigger if exists public_feed_view_count_trigger on public.public_feed_post_views;
create trigger public_feed_view_count_trigger
after insert or delete on public.public_feed_post_views
for each row execute function public.sync_public_feed_view_count();

-- Batched impression recorder. Authors don't inflate their own numbers, and the
-- composite PK makes repeat views idempotent, so this is safe to call on every scroll.
create or replace function public.record_public_feed_impressions(post_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;

  insert into public.public_feed_post_views (post_id, viewer_id)
  select p.id, auth.uid()
  from public.public_feed_posts p
  where p.id = any(post_ids)
    and p.author_id <> auth.uid()
    and p.expires_at > now()
  on conflict (post_id, viewer_id) do nothing;
end;
$$;

grant execute on function public.record_public_feed_impressions(uuid[]) to authenticated;

-- Backfill so existing posts don't all read as zero.
update public.public_feed_posts p
set view_count = coalesce(v.total, 0)
from (
  select post_id, count(*) as total
  from public.public_feed_post_views
  group by post_id
) v
where p.id = v.post_id
  and p.view_count <> coalesce(v.total, 0);

do $$ begin
  alter publication supabase_realtime add table public.public_feed_post_views;
exception when duplicate_object then null; end $$;

