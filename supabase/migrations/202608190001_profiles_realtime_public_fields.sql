-- Live profile fields on the public message link (/u/[username]).
--
-- The send-a-whisper page subscribes to its recipient's profile row so that a
-- bio or avatar edited in /profile appears without a reload. That subscription
-- is inert until `public.profiles` is part of the realtime publication, which
-- it has never been -- every other realtime feature in this app added its own
-- table (see 202607100001, 202607310001, 202608050001), and profiles was never
-- one of them.
--
-- WHY A COLUMN LIST, NOT THE WHOLE TABLE
--
-- `profiles` holds more than the four public fields that page renders --
-- phone_number, dial_code, and fcm_token live on the same row. Publishing the
-- table wholesale would put those columns into the WAL payload of every
-- profile UPDATE and hand them to any subscriber that passes RLS, which for a
-- publicly-readable profile table means anonymous visitors.
--
-- A column list keeps the replication stream to exactly what the public page
-- displays. Anything not named here is never written to the WAL for this
-- publication and therefore can never reach a client, regardless of how a
-- subscription is written now or later.
--
-- `id` is required in the list: it is the table's replica identity, and
-- Postgres rejects a publication column list that omits it.
--
-- Postgres 15+ (Supabase's minimum) is required for publication column lists.

do $$ begin
  alter publication supabase_realtime
    add table public.profiles (id, username, display_name, avatar_url, bio);
exception
  -- Already published. Left as-is on purpose rather than dropped and re-added:
  -- if a later migration widens this list for another feature, re-running this
  -- one must not silently narrow it back.
  when duplicate_object then null;
end $$;
