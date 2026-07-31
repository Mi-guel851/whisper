-- Public feed posts, likes, unread indicators, and 30-day retention.
create table if not exists public.public_feed_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  whisper_link text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create table if not exists public.public_feed_likes (
  post_id uuid not null references public.public_feed_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.public_feed_notifications (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.public_feed_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  is_read boolean not null default false,
  unique (post_id, user_id)
);

create index if not exists public_feed_posts_active_idx on public.public_feed_posts (expires_at, created_at desc);
create index if not exists public_feed_notifications_user_idx on public.public_feed_notifications (user_id, is_read, created_at desc);

create or replace function public.set_public_feed_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  profile_username text;
begin
  select username into profile_username from public.profiles where id = new.author_id;
  if profile_username is null then raise exception 'Profile username is required'; end if;
  new.whisper_link := '/u/' || profile_username;
  new.expires_at := coalesce(new.expires_at, new.created_at + interval '30 days');
  return new;
end;
$$;

drop trigger if exists public_feed_link_trigger on public.public_feed_posts;
create trigger public_feed_link_trigger before insert or update on public.public_feed_posts
for each row execute function public.set_public_feed_link();

create or replace function public.notify_public_feed_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.public_feed_notifications (post_id, user_id)
  select new.id, p.id from public.profiles p where p.id <> new.author_id
  on conflict (post_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists public_feed_notification_trigger on public.public_feed_posts;
create trigger public_feed_notification_trigger after insert on public.public_feed_posts
for each row execute function public.notify_public_feed_post();

create or replace function public.cleanup_expired_public_feed_posts()
returns integer language plpgsql security definer set search_path = public as $$
declare deleted_count integer;
begin
  delete from public.public_feed_posts where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

alter table public.public_feed_posts enable row level security;
alter table public.public_feed_likes enable row level security;
alter table public.public_feed_notifications enable row level security;

drop policy if exists "Anyone can view active feed posts" on public.public_feed_posts;
create policy "Anyone can view active feed posts" on public.public_feed_posts for select using (expires_at > now());
drop policy if exists "Users can create own feed posts" on public.public_feed_posts;
create policy "Users can create own feed posts" on public.public_feed_posts for insert with check (auth.uid() = author_id);
drop policy if exists "Users can delete own feed posts" on public.public_feed_posts;
create policy "Users can delete own feed posts" on public.public_feed_posts for delete using (auth.uid() = author_id);

drop policy if exists "Anyone can view feed likes" on public.public_feed_likes;
create policy "Anyone can view feed likes" on public.public_feed_likes for select using (true);
drop policy if exists "Users can like feed posts" on public.public_feed_likes;
create policy "Users can like feed posts" on public.public_feed_likes for insert with check (auth.uid() = user_id);
drop policy if exists "Users can remove own feed likes" on public.public_feed_likes;
create policy "Users can remove own feed likes" on public.public_feed_likes for delete using (auth.uid() = user_id);

drop policy if exists "Users can view own feed notifications" on public.public_feed_notifications;
create policy "Users can view own feed notifications" on public.public_feed_notifications for select using (auth.uid() = user_id);
drop policy if exists "Users can mark own feed notifications read" on public.public_feed_notifications;
create policy "Users can mark own feed notifications read" on public.public_feed_notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$ begin alter publication supabase_realtime add table public.public_feed_posts; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.public_feed_likes; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.public_feed_notifications; exception when duplicate_object then null; end $$;

-- Run public.cleanup_expired_public_feed_posts() from a daily Supabase scheduled job.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('public-feed-expiry', '15 3 * * *', 'select public.cleanup_expired_public_feed_posts()');
  end if;
exception when unique_violation then null;
end $$;
