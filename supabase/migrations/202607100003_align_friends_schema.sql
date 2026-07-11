-- Align Friends feature database objects with the current production schema.
-- Current tables use:
-- friend_requests.sender_id / receiver_id
-- friends.user_id / friend_id / source
-- blocked_users.user_id / blocked_user_id

alter table public.friends add column if not exists source text not null default 'request';
alter table public.friends add column if not exists updated_at timestamptz not null default now();
alter table public.blocked_users add column if not exists updated_at timestamptz not null default now();

create unique index if not exists friend_requests_pending_unique
  on public.friend_requests (least(sender_id, receiver_id), greatest(sender_id, receiver_id))
  where status = 'pending';

create index if not exists friend_requests_receiver_idx on public.friend_requests (receiver_id, status, created_at desc);
create index if not exists friend_requests_sender_idx on public.friend_requests (sender_id, status, created_at desc);
create index if not exists friends_user_idx on public.friends (user_id, created_at desc);
create index if not exists friends_friend_idx on public.friends (friend_id);
create unique index if not exists blocked_users_pair_unique on public.blocked_users (user_id, blocked_user_id);
create index if not exists blocked_users_user_idx on public.blocked_users (user_id, created_at desc);
create index if not exists blocked_users_blocked_user_idx on public.blocked_users (blocked_user_id);


-- If an older migration created same-named foreign keys to auth.users, replace
-- them so PostgREST can resolve joins from these tables directly to profiles.
do $$
declare
  constraint_name text;
begin
  foreach constraint_name in array array[
    'friend_requests_sender_id_fkey',
    'friend_requests_receiver_id_fkey',
    'friends_user_id_fkey',
    'friends_friend_id_fkey',
    'blocked_users_user_id_fkey',
    'blocked_users_blocked_user_id_fkey'
  ] loop
    if exists (
      select 1
      from pg_constraint
      where conname = constraint_name
        and connamespace = 'public'::regnamespace
        and confrelid <> 'public.profiles'::regclass
    ) then
      execute format('alter table public.%I drop constraint %I',
        case
          when constraint_name like 'friend_requests_%' then 'friend_requests'
          when constraint_name like 'friends_%' then 'friends'
          else 'blocked_users'
        end,
        constraint_name
      );
    end if;
  end loop;
end $$;

-- Add the profile foreign keys expected by PostgREST joins. They are NOT VALID first
-- so existing inconsistent data does not block deployment; validation is attempted after.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'friend_requests_sender_id_fkey') then
    alter table public.friend_requests
      add constraint friend_requests_sender_id_fkey
      foreign key (sender_id) references public.profiles(id) on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'friend_requests_receiver_id_fkey') then
    alter table public.friend_requests
      add constraint friend_requests_receiver_id_fkey
      foreign key (receiver_id) references public.profiles(id) on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'friends_user_id_fkey') then
    alter table public.friends
      add constraint friends_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'friends_friend_id_fkey') then
    alter table public.friends
      add constraint friends_friend_id_fkey
      foreign key (friend_id) references public.profiles(id) on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'blocked_users_user_id_fkey') then
    alter table public.blocked_users
      add constraint blocked_users_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'blocked_users_blocked_user_id_fkey') then
    alter table public.blocked_users
      add constraint blocked_users_blocked_user_id_fkey
      foreign key (blocked_user_id) references public.profiles(id) on delete cascade not valid;
  end if;
end $$;

do $$
begin
  alter table public.friend_requests validate constraint friend_requests_sender_id_fkey;
  alter table public.friend_requests validate constraint friend_requests_receiver_id_fkey;
  alter table public.friends validate constraint friends_user_id_fkey;
  alter table public.friends validate constraint friends_friend_id_fkey;
  alter table public.blocked_users validate constraint blocked_users_user_id_fkey;
  alter table public.blocked_users validate constraint blocked_users_blocked_user_id_fkey;
exception when foreign_key_violation then
  raise notice 'One or more Friends foreign keys were created NOT VALID because existing rows do not have matching profiles.';
end $$;
