-- Push delivery for inbox messages, friend requests, and public feed posts.
--
--
-- WHY ONLY WHISPERS EVER FIRED
--
-- Every piece of this was already built except the one that joins them up. The
-- triggers that write into `public.notifications` exist (202608050001,
-- 202608130001, 202608150001), and `notify-on-notification` is the only edge
-- function that sends a high-priority, vibrating payload — but nothing ever
-- called it. 202608150002 says so outright in a comment: "assumes the user will
-- manually set up the webhook in the dashboard". Whispers work because
-- `notify-new-whisper` did get a dashboard webhook. The other three never did,
-- and a hand-made webhook is invisible to this repo, so the gap was unseeable
-- from the code.
--
-- So the link becomes part of the schema. `pg_net` posts to the edge function
-- from an AFTER INSERT trigger: in version control, reviewable, and identical in
-- every environment instead of depending on someone remembering a dashboard form.
--
--
-- ONE-TIME SETUP (run once in the SQL editor, before or after this migration)
--
--   alter database postgres
--     set app.settings.edge_base_url = 'https://<project-ref>.supabase.co/functions/v1';
--   alter database postgres
--     set app.settings.service_role_key = '<your service_role key>';
--
-- Both are read with `current_setting(..., true)` so the key never lives in this
-- file or in git. `alter database` only affects new connections — after running
-- it, the setting is live within a few seconds.

create extension if not exists pg_net;


-- ---------------------------------------------------------------------------
-- 1. Where the edge functions live
-- ---------------------------------------------------------------------------

create or replace function public.edge_function_url(fn text)
returns text language sql stable set search_path = public as $$
  select rtrim(nullif(current_setting('app.settings.edge_base_url', true), ''), '/')
         || '/' || fn;
$$;

revoke execute on function public.edge_function_url(text) from public;
revoke execute on function public.edge_function_url(text) from anon;
revoke execute on function public.edge_function_url(text) from authenticated;


-- ---------------------------------------------------------------------------
-- 2. Fire an edge function without ever risking the row that triggered it
-- ---------------------------------------------------------------------------

/*
  Every caller below is an AFTER INSERT trigger on a table people are actively
  writing to. A chat message must be saved whether or not its push goes out, so
  this swallows every failure into a warning: an exception here would roll back
  the INSERT and turn "the notification didn't arrive" into "the message
  vanished". `net.http_post` only enqueues the request — the HTTP round trip
  happens in pg_net's background worker, so the trigger does not wait on it.
*/
create or replace function public.post_to_edge_function(fn text, payload jsonb)
returns void language plpgsql security definer set search_path = public, net as $$
declare
  service_key text := current_setting('app.settings.service_role_key', true);
  target_url text := public.edge_function_url(fn);
begin
  if service_key is null or service_key = '' or target_url is null then
    raise warning
      'push skipped: set app.settings.edge_base_url and app.settings.service_role_key (see 202608190003)';
    return;
  end if;

  perform net.http_post(
    url := target_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := payload,
    timeout_milliseconds := 5000
  );
exception when others then
  raise warning 'push via % failed: %', fn, sqlerrm;
end;
$$;

revoke execute on function public.post_to_edge_function(text, jsonb) from public;
revoke execute on function public.post_to_edge_function(text, jsonb) from anon;
revoke execute on function public.post_to_edge_function(text, jsonb) from authenticated;


-- ---------------------------------------------------------------------------
-- 3. notifications -> notify-on-notification
-- ---------------------------------------------------------------------------

create or replace function public.deliver_notification_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  /* Feed posts are delivered by one batched call from the `public_feed_posts`
     trigger below, because their notification rows are written one per user. A
     post seen by 500 people would otherwise queue 500 HTTP requests to say the
     same thing; `notify-new-feed-post` fans out to every token inside a single
     invocation instead. */
  if new.type = 'public_feed' then
    return new;
  end if;

  /* Whispers already have a working delivery path — `notify-new-whisper`, wired
     as a dashboard webhook on `public.messages`. Sending them from here as well
     would double every whisper push, which is a worse bug than the one being
     fixed. To move whispers onto this path instead: delete that webhook in
     Dashboard -> Database -> Webhooks, then drop these three lines. */
  if new.metadata->>'type' = 'whisper' then
    return new;
  end if;

  perform public.post_to_edge_function(
    'notify-on-notification',
    jsonb_build_object('type', 'INSERT', 'table', 'notifications', 'record', to_jsonb(new))
  );

  return new;
end;
$$;

drop trigger if exists deliver_notification_push_trigger on public.notifications;
create trigger deliver_notification_push_trigger
  after insert on public.notifications
  for each row execute function public.deliver_notification_push();


-- ---------------------------------------------------------------------------
-- 4. public_feed_posts -> notify-new-feed-post (one call, internal fan-out)
-- ---------------------------------------------------------------------------

create or replace function public.deliver_feed_post_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.post_to_edge_function(
    'notify-new-feed-post',
    jsonb_build_object('type', 'INSERT', 'table', 'public_feed_posts', 'record', to_jsonb(new))
  );
  return new;
end;
$$;

drop trigger if exists deliver_feed_post_push_trigger on public.public_feed_posts;
create trigger deliver_feed_post_push_trigger
  after insert on public.public_feed_posts
  for each row execute function public.deliver_feed_post_push();


-- ---------------------------------------------------------------------------
-- 5. Stop friend requests notifying twice
-- ---------------------------------------------------------------------------

/*
  `friend_request_notification_trigger` (202608050001, AFTER INSERT) was never
  dropped when `friend_request_event_trigger` (202608130001, AFTER INSERT OR
  UPDATE) replaced it, so both fire on the same INSERT and write two rows for one
  request. Invisible while nothing delivered them; two buzzes per request the
  moment section 3 starts working. The newer trigger handles both the request and
  the acceptance, so the old one goes.
*/
drop trigger if exists friend_request_notification_trigger on public.friend_requests;


-- ---------------------------------------------------------------------------
-- 6. Honour the user's push preference for feed posts
-- ---------------------------------------------------------------------------

/*
  Rebuilt from 202608050001 with one change: `push_notifications` is respected.
  The original notified every profile unconditionally, so a user who had turned
  notifications off still accumulated a row per post. `is distinct from false`
  rather than `= true` because the column is nullable and the rest of the app
  treats null as opted-in.

  Title and body are deliberately left exactly as they were — they show in the
  in-app notification list, and this migration is about delivery, not copy.
*/
create or replace function public.notify_new_public_feed_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.public_feed_notifications (post_id, user_id)
  select new.id, p.id
  from public.profiles p
  where p.id <> new.author_id
    and p.push_notifications is distinct from false
  on conflict (post_id, user_id) do nothing;

  insert into public.notifications (user_id, type, title, body, source_id, metadata)
  select
    p.id,
    'public_feed',
    'New public post',
    left(new.body, 120),
    new.id,
    jsonb_build_object(
      'author_id', new.author_id,
      -- 'feed' is the value FCMMessagingService routes on; 'public_feed' is the
      -- notifications row type. Keeping both means the deep link resolves.
      'type', 'feed',
      'postId', new.id::text,
      'route', '/public-feed'
    )
  from public.profiles p
  where p.id <> new.author_id
    and p.push_notifications is distinct from false;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. Give the Android deep link the key it actually reads
-- ---------------------------------------------------------------------------

/*
  FCMMessagingService reads `data.get("conversationId")`, but the metadata only
  carried `conversation_id`, so every inbox notification opened
  `whisperapp://chat/null`. Both spellings are emitted now: snake_case for the
  in-app list and the web routes, camelCase for the Android intent. Otherwise
  identical to 202608150001.
*/
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
    jsonb_build_object(
      'conversation_id', new.conversation_id,
      'conversationId', new.conversation_id,
      'sender_id', new.sender_id,
      'type', 'message'
    )
  );

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 8. After applying this
-- ---------------------------------------------------------------------------

/*
  In Dashboard -> Database -> Webhooks, delete any webhook pointing at
  `notify-new-direct-message` or `notify-friend-request`. Those functions send
  the same push this migration now sends from SQL, so leaving them wired means
  two notifications per event. Keep the `notify-new-whisper` webhook — section 3
  deliberately leaves whispers to it. Do not add a webhook on
  `public.notifications`; that is what section 3 replaces.

  The app used to call those two functions directly from the browser as well --
  `sendPushNotification` in app/chat/[conversationId]/page.tsx and two
  `functions.invoke` calls in app/friends/page.tsx. Both are removed, for the
  same reason: with this migration applied they would each have doubled their
  event. The chat one had never worked anyway -- it sent no Authorization header,
  so every call was a 401 that `.catch()` could not see, which is the actual
  reason inbox pushes were silent while whispers were not.

  So `notify-new-direct-message` and `notify-friend-request` now have no caller.
  Leave them deployed -- an edge function nobody invokes costs nothing, and they
  are a working fallback if this path ever needs to be turned off. Do not delete
  the files.

  To check delivery afterwards:

    select id, url, error_msg, status_code, created
    from net._http_response
    order by created desc
    limit 20;
*/
