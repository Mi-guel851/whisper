-- Confirm triggers for Inbox and Friend Requests

-- 1. FIX: Notify New Inbox Message (ensure it hits notifications table)
create or replace function public.notify_new_direct_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  recipient uuid;
  body_text text;
begin
  select case when user_a = new.sender_id then user_b else user_a end
    into recipient
    from public.conversations
    where id = new.conversation_id;

  if recipient is null then
    return new;
  end if;

  body_text := coalesce(new.content,
    case
      when new.audio_path is not null then '🎙️ Sent you a voice note'
      when new.image_path is not null then '📷 Sent you a photo'
      else 'New message'
    end
  );

  insert into public.notifications (user_id, type, title, body, source_id, metadata)
  values (
    recipient,
    'message',
    'New Inbox Message 💬',
    body_text,
    new.id,
    jsonb_build_object('conversation_id', new.conversation_id, 'sender_id', new.sender_id, 'type', 'message')
  );

  return new;
end;
$$;

drop trigger if exists direct_message_notification_trigger on public.direct_messages;
create trigger direct_message_notification_trigger
  after insert on public.direct_messages
  for each row execute function public.notify_new_direct_message();


-- 2. FIX: Friend Request Events (New and Accepted)
create or replace function public.notify_friend_request_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- New Request
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

  -- Request Accepted
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
