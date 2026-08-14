-- Fix missing 'title' column in notifications table if it was created incorrectly
-- and ensure 'friend_request' is in the check constraint

do $$
begin
  -- Add title if missing
  if not exists (
    select 1
    from information_schema.columns
    where table_name = 'notifications'
    and column_name = 'title'
  ) then
    alter table public.notifications add column title text not null default 'New Notification';
  end if;

  -- Add friend_request to check constraint if needed
  -- First drop the old check if it exists (we might not know its name, so we'll look it up)
  -- Or just add the column and use it.

  -- Ensure type can contain 'friend_request' and 'whisper'
  alter table public.notifications drop constraint if exists notifications_type_check;
  alter table public.notifications add constraint notifications_type_check
    check (type in ('message', 'friend_request', 'public_feed', 'whisper'));

end $$;
