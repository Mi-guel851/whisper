-- Enhanced notifications for Friend Requests and Accepted Requests

create or replace function public.notify_friend_request_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 1. New Friend Request (Insert)
  if (TG_OP = 'INSERT') then
    insert into public.notifications (user_id, type, title, body, source_id, metadata)
    values (
      new.receiver_id,
      'friend_request',
      'New Friend Request 🤝',
      'Someone wants to be your friend on Whisper!',
      new.id,
      jsonb_build_object('sender_id', new.sender_id, 'type', 'friend_request')
    );
  end if;

  -- 2. Accepted Friend Request (Update)
  if (TG_OP = 'UPDATE') then
    if (old.status = 'pending' and new.status = 'accepted') then
      insert into public.notifications (user_id, type, title, body, source_id, metadata)
      values (
        new.sender_id,
        'friend_request',
        'Friend Request Accepted! ✨',
        'You are now friends with an anonymous user.',
        new.id,
        jsonb_build_object('receiver_id', new.receiver_id, 'type', 'friend_request')
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists friend_request_event_trigger on public.friend_requests;
create trigger friend_request_event_trigger
  after insert or update on public.friend_requests
  for each row execute function public.notify_friend_request_events();

-- Ensure Whispers (messages table) also create entries in public.notifications
create or replace function public.notify_new_whisper_record()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, title, body, source_id, metadata)
  values (
    new.recipient_id,
    'message',
    'New Anonymous Whisper 👻',
    coalesce(left(new.message, 120), 'Sent you a photo'),
    new.id,
    jsonb_build_object('message_id', new.id, 'type', 'whisper')
  );
  return new;
end;
$$;

drop trigger if exists whisper_notification_record_trigger on public.messages;
create trigger whisper_notification_record_trigger
  after insert on public.messages
  for each row execute function public.notify_new_whisper_record();
