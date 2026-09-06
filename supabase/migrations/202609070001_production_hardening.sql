-- ===========================================================================
-- Production hardening: coins, whisper hints, feed fan-out, message caps,
-- Cloudinary ownership, and realtime payload minimization.
--
-- Every statement is idempotent and guarded. Nothing here drops data.
-- Read the ROLLBACK NOTES at the bottom before applying to production.
--
-- WHY EACH PIECE EXISTS (one paragraph per section; each maps to an audit
-- finding with the same number in AUDIT-2026-09.md):
--
--   S1  Free-coins RPC: purchase_whisper_coins is SECURITY DEFINER, still
--       EXECUTE-granted to PUBLIC (the default), and credits auth.uid() with
--       any `coin_amount` the caller passes, tagged 'purchase'. Any signed-in
--       user can call supabase.rpc('purchase_whisper_coins', {coin_amount:
--       999999999, package_label: 'x'}) and mint an infinite balance. The app
--       itself has no callers — the real path is /api/paystack/verify →
--       credit_verified_payment. Revoking is enough to close it; the function
--       remains for any legacy server-side use by the service role only.
--
--   S2  Whisper hint columns are readable by the recipient before paying: the
--       inbox selected them up-front and the "5 coins to unlock" gate was a
--       render-only if. This section revokes *column* SELECT for client roles
--       and replaces the paywall with a definer RPC that only answers after the
--       unlock row exists. Column-level REVOKE needs Postgres 15+.
--
--   S3  Realtime payload for `messages` carried every column — including the
--       hint fields — to the subscriber socket. Narrowing the publication to
--       exactly the columns the client renders means secrets never enter the
--       logical-decoding path for this table at all, independent of grants.
--
--   S4  The feed's "notify everyone of every post" trigger is O(posts × users)
--       rows across two tables per post (a 100k-user project with 10k posts a
--       day is ~2 billion notification rows a day). It fans out to the author's
--       friends instead — still an interesting feed bell, now bounded by the
--       social graph — and stops writing the duplicate row into `notifications`
--       (the in-app list renders feed items from public_feed_notifications; the
--       push path already skips 'public_feed' rows and delivers via
--       deliver_feed_post_push_trigger, unchanged).
--
--   S5  Unbounded message text: direct_messages.content and messages.message
--       had no length ceiling, so one client could insert megabyte rows that
--       every reader of the conversation must download. 5000 chars matches
--       what the composer can actually send.
--
--   S6  Cloudinary URLs pasted into chat/feed rows were only checked to belong
--       to *our cloud*, never to the *sender's folder*. An owner-in-the-path
--       predicate in the insert policy (and a row CHECK on messages) closes the
--       "reference another user's asset as your own photo" class of abuse.
--
--   S7  record_public_feed_impressions: no array-size cap (PostgREST limit is
--       the only thing stopping a 100k-uuid burn), and the dedup partial index
--       from 202608260001 uses `now()` in its predicate — Postgres rejects
--       non-immutable index predicates, so that index cannot have been created
--       as written. This drops it if it somehow exists, and implements the
--       same 2-second anti-double-send rule inside the function, where a
--       volatile predicate is legal.
--
--   S8  public_feed_thread had no row limit: a reply storm under one root post
--       streamed every descendant (with a per-row like/reply count subquery)
--       on every open. The thread now returns the 200 most recent replies
--       (chronologically) and public_feed_page clamps deep offsets.
--
--   S9  The inbox computed unread badges by downloading one ROW PER UNREAD
--       MESSAGE; notifications refreshed on a per-row insert stream with no
--       supporting index. Adds a definer count RPC, an unread index on
--       notifications, and a partial unread index on direct_messages.
--
--   S10 whisper_live_activity() ran two full-table count(*) per homepage
--       view (a ~90s client poll). Totals become catalog estimates; the
--       index-bounded today-counts stay exact.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- S1. Revoke the free-coins placeholder RPC
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'purchase_whisper_coins'
  ) then
    execute 'revoke all on function public.purchase_whisper_coins(integer, text) from public';
    execute 'revoke all on function public.purchase_whisper_coins(integer, text) from anon';
    execute 'revoke all on function public.purchase_whisper_coins(integer, text) from authenticated';
    execute 'grant execute on function public.purchase_whisper_coins(integer, text) to service_role';
    raise notice 'S1: purchase_whisper_coins revoked from client roles (server-only now).';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- S2. Whisper hints: paywall enforced by the database
--
-- The four hint columns + the two unused sender-identity columns are revoked
-- from client roles on `public.messages`; reading them goes through
-- public.whisper_hints_for(), which returns rows ONLY for messages the caller
-- received AND has already paid to unlock (or pays for inside the matching
-- unlock RPC, which already exists: unlock_hint_with_coins writes
-- anonymous_sender_reveals in the same transaction it charges).
--
-- sender_username / sender_email_name / sender_user_id were also revoked: the
-- app UI never displayed them (verified across app/ — no render path reads
-- them), and in an anonymous-whisper product, *storing a sender identifier the
-- recipient can read for free* defeats the premise. Old rows keep their data
-- (nothing is deleted); they are just no longer legible from a browser.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'sender_country'
  ) then
    begin
      revoke (sender_country, sender_state, sender_city, sender_device,
              sender_username, sender_email_name, sender_user_id)
        on public.messages from anon, authenticated;
      raise notice 'S2: sender/hint columns revoked from anon+authenticated on messages.';
    exception when others then
      raise warning 'S2: column REVOKE failed (%). On Postgres <15, column privileges are unsupported; skip this and rely on the RPC below plus removing the columns from client selects.', sqlerrm;
    end;
  end if;
end $$;

create or replace function public.whisper_hints_for(p_message_ids uuid[])
returns table (
  message_id      uuid,
  sender_country  text,
  sender_state    text,
  sender_city     text,
  sender_device   text,
  sent_at         timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.sender_country, m.sender_state, m.sender_city, m.sender_device,
    m.created_at
  from public.messages m
  where m.id = any (coalesce(p_message_ids, '{}'))
    and m.recipient_id = auth.uid()
    -- paid for, once, and only by the recipient:
    and exists (
      select 1 from public.anonymous_sender_reveals r
      where r.message_id = m.id and r.user_id = auth.uid()
    )
$$;

revoke all on function public.whisper_hints_for(uuid[]) from public;
revoke all on function public.whisper_hints_for(uuid[]) from anon;
grant  execute on function public.whisper_hints_for(uuid[]) to authenticated;

comment on function public.whisper_hints_for(uuid[]) is
  'The paid Hint, server-side gate: returns sender coarse-location/device ONLY for already-unlocked messages the caller received. Replaces the client-side paywall.';


-- ---------------------------------------------------------------------------
-- S3. Narrow the `messages` realtime publication to the columns clients use.
-- Only rewritten if the table is in the publication today; the column list is
-- then re-declared so the WAL path never carries sender context to sockets.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    -- If it was added with a column list already, drop+re-add only widens/narrows
    -- it to the exact minimal set; ids/message/media/read-state are all the
    -- inbox renders in realtime.
    begin
      execute 'alter publication supabase_realtime drop table public.messages';
      execute $pub$alter publication supabase_realtime add table public.messages (id, recipient_id, message, image_url, created_at, is_read)$pub$;
      raise notice 'S3: messages publication narrowed to non-sensitive columns.';
    exception when others then
      raise warning 'S3: could not narrow the messages publication (%). Realtime payloads for messages may still carry revoked columns — audit the publication manually.', sqlerrm;
    end;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- S4. Feed fan-out: friends of the author, not every profile.
-- ---------------------------------------------------------------------------

create or replace function public.notify_new_public_feed_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Feed bell rows for the author's friends only. The old definition fanned
  -- out to every profile in the database on every post, which is a quadratic
  -- table at any real scale (see header).
  insert into public.public_feed_notifications (post_id, user_id)
  select new.id, f.friend_id
  from public.friends f
  where f.user_id = new.author_id
  on conflict (post_id, user_id) do nothing;

  return new;
end;
$$;

-- The trigger itself is unchanged (still public_feed_notification_trigger on
-- AFTER INSERT); only the function body got the bounded fan-out.

-- Backfill decision left deliberately to operators: existing per-user feed
-- notification rows are historical noise at this point and can be pruned with
-- (not executed here — this migration never deletes data):
--   delete from public.public_feed_notifications where created_at < now() - interval '7 days';


-- ---------------------------------------------------------------------------
-- S5. Length ceilings on message bodies.
-- NOT VALID if legacy rows violate, so applying never fails — but every NEW
-- write is constrained either way.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='direct_messages' and column_name='content') then
    alter table public.direct_messages
      drop constraint if exists direct_messages_content_len_check;
    alter table public.direct_messages
      add constraint direct_messages_content_len_check
      check (content is null or char_length(content) <= 5000) not valid;
    begin
      alter table public.direct_messages validate constraint direct_messages_content_len_check;
    exception when check_violation then
      raise warning 'S5: direct_messages has legacy rows over 5000 chars; constraint stays NOT VALID (new writes are still enforced).';
    end;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='messages' and column_name='message') then
    alter table public.messages
      drop constraint if exists messages_len_check;
    alter table public.messages
      add constraint messages_len_check
      check (message is null or char_length(message) <= 5000) not valid;
    begin
      alter table public.messages validate constraint messages_len_check;
    exception when check_violation then
      raise warning 'S5: messages has legacy rows over 5000 chars; constraint stays NOT VALID.';
    end;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- S6. Cloudinary ownership: a URL that points into our cloud must point into
-- the *sender's* folder. Legacy supabase.co keys and GIF-CDN URLs pass.
-- ---------------------------------------------------------------------------

create or replace function public.cloudinary_asset_owned_by(url text, owner uuid)
returns boolean
language sql
immutable
set search_path = public
as $$
  -- null → nothing attached → pass.
  -- any URL that is NOT one of our Cloudinary delivery URLs → pass (legacy
  -- storage keys and the tenor/giphy fallback hosts have their own checks).
  -- a Cloudinary URL must carry the owner's id as a path segment: assets are
  -- uploaded under whisper/<kind>/<owner>/…, so referencing somebody else's
  -- object fails this predicate.
  select url is null
      or url not like 'https://res.cloudinary.com/%'
      or (owner is not null and position('/' || owner::text || '/' in url) > 0)
$$;

comment on function public.cloudinary_asset_owned_by(text, uuid) is
  'True when url is not a Cloudinary asset, or its path contains /<owner-id>/ — the folder convention every upload flow uses.';

-- Chat media + view-once photos: sender owns the folder. Guarded so a database
-- that has not received 202609060002 yet can still run this migration (the
-- media columns would not exist to reference in the policy).
do $$
begin
  if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'direct_messages' and column_name = 'media_url'
      ) and exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'direct_messages' and column_name = 'image_path'
      ) then
    drop policy if exists "Conversation members can send unlocked direct messages" on public.direct_messages;
    create policy "Conversation members can send unlocked direct messages" on public.direct_messages
      for insert with check (
        auth.uid() = sender_id
        and public.can_send_direct_message(conversation_id, sender_id)
        and public.cloudinary_asset_owned_by(media_url, auth.uid())
        and public.cloudinary_asset_owned_by(image_path, auth.uid())
      );
    raise notice 'S6: direct_messages insert policy now pins Cloudinary assets to the sender folder.';
  else
    raise notice 'S6: media columns missing (apply 202609060002 first); ownership policy skipped.';
  end if;
end $$;

-- Anonymous whispers: the view-once photo lives in the *recipient's* folder
-- (that is what lets the recipient delete it — see app/api/cloudinary/destroy).
-- Enforce the same at insert time for Cloudinary URLs.
create or replace function public.whisper_image_folder_ok()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.image_url is not null
     and new.image_url like 'https://res.cloudinary.com/%' then
    if new.recipient_id is null
       or position('/' || new.recipient_id::text || '/' in new.image_url) = 0 then
      raise exception 'Whisper photos must be uploaded under the recipient folder.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'messages' and column_name = 'image_url'
      ) and exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'messages' and column_name = 'recipient_id'
      ) then
    drop trigger if exists whisper_image_folder_guard on public.messages;
    create trigger whisper_image_folder_guard
      before insert on public.messages
      for each row execute function public.whisper_image_folder_ok();
    raise notice 'S6: whisper photo folder guard attached to messages.';
  else
    raise notice 'S6: messages.image_url/recipient_id not present; guard skipped.';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- S7. Impressions RPC: hard array cap + real 2-second dedup.
-- ---------------------------------------------------------------------------

do $$ begin
  -- The 202608260001 partial unique index uses now() in its predicate, which
  -- Postgres rejects for an index. Drop the object if a manual re-creation
  -- ever got it in; the dedup rule moves into the function below.
  drop index if exists public.public_feed_post_views_dedup_idx;
exception when others then
  raise notice 'S7: index drop skipped: %', sqlerrm;
end $$;

drop function if exists public.record_public_feed_impressions(uuid[]);

create or replace function public.record_public_feed_impressions(post_ids uuid[])
returns table (post_id uuid, view_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  batch uuid[];
begin
  if v_uid is null then return; end if;
  if post_ids is null or array_length(post_ids, 1) is null then return; end if;

  -- Hard cap: one scroll cannot ask for more than a generous page-worth.
  -- 200 is well above FEED_PAGE_SIZE (10) times a burst of flushes, and
  -- protects the insert-then-per-row-trigger amplification the old version
  -- had no ceiling on.
  batch := post_ids[1:200];

  insert into public.public_feed_post_views (post_id, viewer_id)
  select p.id, v_uid
  from public.public_feed_posts p
  where p.id = any(batch)
    and p.expires_at > now()
    -- 2-second anti-double-send (retry protection), the honest replacement
    -- for the impossible partial-unique index.
    and not exists (
      select 1 from public.public_feed_post_views v
      where v.post_id = p.id
        and v.viewer_id = v_uid
        and v.created_at > now() - interval '2 seconds'
    );

  return query
  select p.id, p.view_count
  from public.public_feed_posts p
  where p.id = any(batch);
end;
$$;

revoke all on function public.record_public_feed_impressions(uuid[]) from public;
grant execute on function public.record_public_feed_impressions(uuid[]) to authenticated;


-- ---------------------------------------------------------------------------
-- S7b. Atomic coin spending for the API routes.
--
-- /api/coins/feed-post read the balance, subtracted in app code, and wrote the
-- result back — a lost-update race: two concurrent posts read 10, both write 8.
-- (And with free coins minted by S1 it was worse.) These functions make the
-- debit a single guarded UPDATE, the same shape every definer RPC in this
-- project already uses.
-- ---------------------------------------------------------------------------

create or replace function public.debit_whisper_coins(p_amount integer, p_description text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
  amount integer := coalesce(p_amount, 0);
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if amount <= 0 or amount > 1000000 then
    raise exception 'Invalid amount' using errcode = '22023';
  end if;

  perform public.ensure_coin_wallet(auth.uid());

  update public.coins
     set balance = balance - amount, updated_at = now()
   where user_id = auth.uid() and balance >= amount
  returning balance into new_balance;

  if new_balance is null then
    raise exception 'Insufficient coins' using errcode = 'P0002';
  end if;

  insert into public.coin_transactions (user_id, transaction_type, amount, description)
  values (auth.uid(), 'spend', -amount, left(coalesce(nullif(btrim(p_description), ''), 'Spend'), 200));

  return new_balance;
end;
$$;

create or replace function public.refund_whisper_coins(p_amount integer, p_description text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
  amount integer := coalesce(p_amount, 0);
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if amount <= 0 or amount > 1000000 then
    raise exception 'Invalid amount' using errcode = '22023';
  end if;

  perform public.ensure_coin_wallet(auth.uid());

  update public.coins
     set balance = balance + amount, updated_at = now()
   where user_id = auth.uid()
  returning balance into new_balance;

  insert into public.coin_transactions (user_id, transaction_type, amount, description)
  values (auth.uid(), 'refund', amount, left(coalesce(nullif(btrim(p_description), ''), 'Refund'), 200));

  return new_balance;
end;
$$;

revoke all on function public.debit_whisper_coins(integer, text) from public;
revoke all on function public.refund_whisper_coins(integer, text) from public;
grant execute on function public.debit_whisper_coins(integer, text) to authenticated;
grant execute on function public.refund_whisper_coins(integer, text) to authenticated;

-- The route debits as the *user* (their JWT), so the debit is scoped to them by
-- construction; the ledger insert runs inside the definer, under service
-- semantics, exactly like every other coin function in this schema.

-- Replay protection for payment credits: at most one ledger row per Paystack
-- reference. A duplicate verify call then fails at the ledger insert rather
-- than double-crediting. Wrapped so existing duplicates cannot block applying.
do $$
begin
  begin
    create unique index if not exists coin_transactions_purchase_reference_uniq
      on public.coin_transactions (reference)
      where reference is not null and transaction_type = 'purchase';
  exception when unique_violation then
    raise warning 'S7b: duplicate purchase references already exist; replay index not created. Deduplicate coin_transactions manually and re-run.';
  end;
exception when others then
  raise notice 'S7b: skipped purchase reference index (%).', sqlerrm;
end $$;


-- ---------------------------------------------------------------------------
-- S8. Feed reads: bounded threads and offsets.
-- ---------------------------------------------------------------------------

-- public_feed_thread gains a 200-row ceiling (most recent replies, returned in
-- chronological order). Threads deeper than that are a moderation event, not
-- a render target.
drop function if exists public.public_feed_thread(uuid);
create function public.public_feed_thread(p_post_id uuid)
returns table (
  id uuid,
  author_id uuid,
  body text,
  whisper_link text,
  created_at timestamptz,
  expires_at timestamptz,
  parent_post_id uuid,
  view_count integer,
  topic text,
  has_image boolean,
  image_preview text,
  poll_options text[],
  like_count integer,
  reply_count integer,
  poll_counts integer[],
  viewer_liked boolean,
  viewer_image_viewed boolean,
  viewer_vote integer,
  rank_score double precision,
  author_role text
)
language sql
stable
security definer
set search_path = public
as $$
with recursive
  hidden_authors as (
    select blocked_user_id as uid from public.blocked_users where user_id = auth.uid()
    union
    select user_id as uid from public.blocked_users where blocked_user_id = auth.uid()
  ),
  branch as (
    select p.*
    from public.public_feed_posts p
    where p.parent_post_id = p_post_id
      and p.expires_at > now()
    union all
    select child.*
    from public.public_feed_posts child
    join branch b on child.parent_post_id = b.id
    where child.expires_at > now()
  ),
  limited as (
    select b.*
    from branch b
    where not exists (select 1 from hidden_authors h where h.uid = b.author_id)
      and not exists (
        select 1 from public.public_feed_reports r
        where r.post_id = b.id and r.reporter_id = auth.uid()
      )
    order by b.created_at desc
    limit 200
  )
select
  b.id,
  b.author_id,
  b.body,
  b.whisper_link,
  b.created_at,
  b.expires_at,
  b.parent_post_id,
  b.view_count,
  b.topic,
  (b.image_path is not null) as has_image,
  b.image_preview,
  b.poll_options,
  (select count(*)::integer from public.public_feed_likes l where l.post_id = b.id) as like_count,
  (select count(*)::integer from public.public_feed_posts c where c.parent_post_id = b.id and c.expires_at > now()) as reply_count,
  null::integer[] as poll_counts,
  exists (
    select 1 from public.public_feed_likes l
    where l.post_id = b.id and l.user_id = auth.uid()
  ) as viewer_liked,
  exists (
    select 1 from public.public_feed_post_image_views iv
    where iv.post_id = b.id and iv.viewer_id = auth.uid()
  ) as viewer_image_viewed,
  null::integer as viewer_vote,
  extract(epoch from b.created_at)::double precision as rank_score,
  b.author_role
from limited b
order by b.created_at asc;
$$;

revoke all on function public.public_feed_thread(uuid) from public;
grant execute on function public.public_feed_thread(uuid) to authenticated;

-- public_feed_page: clamp offset so "load more" cannot walk the whole table.
-- The function body is the current one from 202609060001 verbatim except the
-- final OFFSET line, which is now `offset greatest(0, least(coalesce(p_offset,
-- 0), 2000))` — 2000 rows of paging (~200 pages) is far beyond any real
-- scroll, and it turns "scrape the entire feed" into something that stops.
drop function if exists public.public_feed_page(text, text, text, integer, integer);
create function public.public_feed_page(
  p_sort text default 'new',
  p_topic text default null,
  p_search text default null,
  p_limit integer default 10,
  p_offset integer default 0
)
returns table (
  id uuid,
  author_id uuid,
  body text,
  whisper_link text,
  created_at timestamptz,
  expires_at timestamptz,
  parent_post_id uuid,
  view_count integer,
  topic text,
  has_image boolean,
  image_preview text,
  poll_options text[],
  like_count integer,
  reply_count integer,
  poll_counts integer[],
  viewer_liked boolean,
  viewer_image_viewed boolean,
  viewer_vote integer,
  rank_score double precision,
  author_role text
)
language sql
stable
security definer
set search_path = public
as $fn$
with recursive
  hidden_authors as (
    select blocked_user_id as uid from public.blocked_users where user_id = auth.uid()
    union
    select user_id as uid from public.blocked_users where blocked_user_id = auth.uid()
  ),
  candidates as (
    select p.*
    from public.public_feed_posts p
    where p.expires_at > now()
      and p.parent_post_id is null
      and not exists (select 1 from hidden_authors h where h.uid = p.author_id)
      and not exists (
        select 1 from public.public_feed_reports r
        where r.post_id = p.id and r.reporter_id = auth.uid()
      )
      and (p_topic is null or p.topic = p_topic)
      and (
        p_search is null
        or btrim(p_search) = ''
        or p.body ilike '%' || btrim(p_search) || '%'
      )
  ),
  descendants as (
    select reply.id, reply.parent_post_id as root_id, reply.created_at
    from public.public_feed_posts reply
    join public.public_feed_posts parent on parent.id = reply.parent_post_id
    where reply.expires_at > now()
      and parent.parent_post_id is null
    union all
    select child.id, d.root_id, child.created_at
    from public.public_feed_posts child
    join descendants d on child.parent_post_id = d.id
    where child.expires_at > now()
  ),
  thread_metrics as (
    select
      root_id,
      count(*)::integer as total,
      count(*) filter (where created_at > now() - interval '6 hours')::integer as recent
    from descendants
    group by root_id
  ),
  like_metrics as (
    select
      post_id,
      count(*)::integer as total,
      count(*) filter (where created_at > now() - interval '6 hours')::integer as recent
    from public.public_feed_likes
    group by post_id
  ),
  affinity as (
    select p.topic, count(*)::double precision as hits
    from public.public_feed_likes l
    join public.public_feed_posts p on p.id = l.post_id
    where l.user_id = auth.uid()
      and p.topic is not null
      and l.created_at > now() - interval '14 days'
    group by p.topic
  ),
  scored as (
    select
      c.*,
      coalesce(lm.total, 0)  as likes_total,
      coalesce(lm.recent, 0) as likes_recent,
      coalesce(tm.total, 0)  as replies_total,
      coalesce(tm.recent, 0) as replies_recent,
      greatest(
        extract(epoch from (now() - c.created_at))::double precision / 3600.0,
        0.25
      ) as age_hours,
      coalesce(a.hits, 0) as affinity_hits,
      exists (
        select 1 from public.public_feed_post_views v
        where v.post_id = c.id and v.viewer_id = auth.uid()
      ) as already_seen
    from candidates c
    left join like_metrics   lm on lm.post_id = c.id
    left join thread_metrics tm on tm.root_id = c.id
    left join affinity        a on a.topic   = c.topic
  ),
  ranked as (
    select
      s.*,
      (
        (s.likes_recent * 3.0 + s.replies_recent * 5.0)
        + (s.likes_total * 0.6 + s.replies_total * 1.0)
        + (s.view_count * 0.05)
        + 0.5
      )::double precision / power(s.age_hours + 2.0, 1.35) as heat
    from scored s
  )
select
  r.id,
  r.author_id,
  r.body,
  r.whisper_link,
  r.created_at,
  r.expires_at,
  r.parent_post_id,
  r.view_count,
  r.topic,
  (r.image_path is not null) as has_image,
  r.image_preview,
  r.poll_options,
  r.likes_total   as like_count,
  r.replies_total as reply_count,
  pc.counts       as poll_counts,
  exists (
    select 1 from public.public_feed_likes l
    where l.post_id = r.id and l.user_id = auth.uid()
  ) as viewer_liked,
  exists (
    select 1 from public.public_feed_post_image_views iv
    where iv.post_id = r.id and iv.viewer_id = auth.uid()
  ) as viewer_image_viewed,
  (
    select v.option_index::integer
    from public.public_feed_poll_votes v
    where v.post_id = r.id and v.user_id = auth.uid()
  ) as viewer_vote,
  case lower(coalesce(p_sort, 'new'))
    when 'trending'  then r.heat
    when 'discussed' then
      (r.replies_total * 1000.0)
      + (r.replies_recent * 50.0)
      + (extract(epoch from r.created_at)::double precision / 1.0e12)
    when 'for_you' then
      r.heat
      * (1.0 + least(0.8, r.affinity_hits * 0.2))
      * (case when r.already_seen then 0.35 else 1.0 end)
    else extract(epoch from r.created_at)::double precision
  end as rank_score,
  r.author_role
from ranked r
left join lateral (
  select array_agg(tally order by idx) as counts
  from (
    select
      g.idx,
      count(v.user_id)::integer as tally
    from generate_subscripts(r.poll_options, 1) as g(idx)
    left join public.public_feed_poll_votes v
      on v.post_id = r.id
     and v.option_index = g.idx - 1
    group by g.idx
  ) tallies
) pc on true
order by rank_score desc, r.created_at desc
limit greatest(1, least(coalesce(p_limit, 10), 50))
offset greatest(0, least(coalesce(p_offset, 0), 2000));
$fn$;

grant execute on function public.public_feed_page(text, text, text, integer, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- S9. Inbox queries: server-side unread counting + a missing index.
-- ---------------------------------------------------------------------------

-- `unread_message_counts` replaces the inbox pattern of *fetching every unread
-- message row* (`select conversation_id ... .in(ids).neq(sender).is(read_at,
-- null)`) just to count them. A user with a 10k-message unread backlog used to
-- pull 10k rows on every inbox paint and coalesced refresh; this returns one
-- row per conversation instead, counted under the same RLS visibility the
-- direct select had (participants only, via the conversations join — the
-- definer body applies the participant check itself, which is what the
-- per-row policy enforced).
create or replace function public.unread_message_counts(conversation_ids uuid[])
returns table (conversation_id uuid, unread bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.conversation_id, count(*)::bigint
  from public.direct_messages m
  where m.conversation_id = any (coalesce(conversation_ids, '{}'))
    and m.sender_id <> auth.uid()
    and m.read_at is null
    -- definer skips RLS, so re-assert membership: only conversations the
    -- caller is actually in, matching the select policy on direct_messages.
    and exists (
      select 1 from public.conversations c
      where c.id = m.conversation_id
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  group by m.conversation_id
$$;

revoke all on function public.unread_message_counts(uuid[]) from public;
grant execute on function public.unread_message_counts(uuid[]) to authenticated;

-- Indexes the inbox/unread shapes for the first time: `notifications` was
-- created (202608050001) with no index at all and now carries millions of
-- feed rows at scale. Both queries below are `(user_id, is_read, created_at)`.
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, is_read, created_at desc);

-- direct_messages read-receipt scan: `where conversation_id = any(...) and
-- sender_id <> me and read_at is null`. The conversation FK probably already
-- has an index from the base schema; this composite serves the unread filter
-- without re-checking every row of a long thread. Partial: delivered/read
-- rows (the overwhelming majority of history) never enter the index.
do $$
begin
  create index if not exists direct_messages_unread_idx
    on public.direct_messages (conversation_id, created_at desc)
    where read_at is null;
exception when others then
  raise notice 'S9: direct_messages_unread_idx skipped (%).', sqlerrm;
end $$;


-- ---------------------------------------------------------------------------
-- S10. whisper_live_activity(): two full-table count(*) -> catalog estimates.
--
-- The homepage activity strip refires this RPC roughly every 90 seconds per
-- visitor (components/LiveActivityStrip.tsx), and `count(*) from messages`
-- plus `count(*) from conversations` are full scans — the site's single
-- largest recurring read, executed proportionally to how many people are
-- LOOKING AT THE HOMEPAGE. The *_today figures already ride
-- messages_created_at_idx / public_feed_posts_created_at_idx (both from
-- 202608200001) and stay exact.
--
-- The two totals become pg_class.reltuples estimates: maintained by autovacuum
-- ANALYZE, typically within a couple of percent, and the strip animates a
-- rolling vanity number. Exact totals that decay into a timeout are not worth
-- an O(table) scan per view.
--
-- Grants survive this replacement untouched (same signature, so the
-- revoke/grant block of 202608200001 §53-58 still applies).
-- ---------------------------------------------------------------------------
create or replace function public.whisper_live_activity()
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'whispers_today', (
      select count(*) from public.messages
      where created_at >= date_trunc('day', now())
    ),
    'whispers_total', greatest(
      (select reltuples::bigint from pg_class
        where oid = 'public.messages'::regclass), 0),
    'conversations_total', greatest(
      (select reltuples::bigint from pg_class
        where oid = 'public.conversations'::regclass), 0),
    'feed_posts_today', (
      select count(*) from public.public_feed_posts
      where created_at >= date_trunc('day', now())
    )
  );
$$;

comment on function public.whisper_live_activity() is
  'Activity-strip aggregates (202609070001 §S10): today-counts exact and index-bounded; totals are pg_class estimates, not full scans.';


-- ---------------------------------------------------------------------------
-- ROLLBACK NOTES
-- ---------------------------------------------------------------------------
-- S1  Re-granting purchase_whisper_coins restores the free-coin path; do not.
--     Rollback of a bad revoke (if some old server code needs it): grant it
--     back to service_role only.
-- S2  Restores client visibility of hint columns. To undo:
--       grant select(sender_country, sender_state, sender_city, sender_device,
--                    sender_username, sender_email_name, sender_user_id)
--         on public.messages to anon, authenticated;
--     and revert app/notifications to selecting them. The RPC remains harmless.
-- S3  Undo by re-adding the table without a column list:
--       alter publication supabase_realtime drop table public.messages;
--       alter publication supabase_realtime add table public.messages;
-- S4  Old fan-out, verbatim from 202608190003 section 6:
--       create or replace function public.notify_new_public_feed_post() ... profiles ...
--     (git blame this file; it is a two-statement insert into both tables.)
--     The push path (deliver_feed_post_push_trigger) is untouched either way.
-- S5  drop constraint direct_messages_content_len_check / messages_len_check.
-- S6  Re-create the prior "Conversation members can send unlocked direct
--     messages" policy (friends_management 202607100001 section on
--     direct_messages) and drop trigger whisper_image_folder_guard.
-- S7  Restore record_public_feed_impressions from 202608260001.
-- S7b drop the two debit/refund functions; routes fall back to their old
--     (racy) read-modify-write code on revert. Keep the unique index.
-- S8  Restore public_feed_thread and public_feed_page from 202609060001
--     (their bodies are unchanged here except the row/offset ceilings).
-- S9  drop function public.unread_message_counts(uuid[]);
--     drop index if exists notifications_user_unread_idx, direct_messages_unread_idx.
-- S10 restore the exact-count definition verbatim from 202608200001
--     (_live_activity_aggregates.sql) — the estimates simply become full
--     scans again, no data or grant effects.
-- ===========================================================================
