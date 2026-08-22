-- Sender context on anonymous whispers — the four columns the paid Hint reads.
--
-- WHY THIS MIGRATION EXISTS AT ALL
--
-- These columns already exist in the live database: `app/notifications/page.tsx`
-- has always selected them, and a select against a missing column errors rather
-- than returning null, so production proves they are there. They were added
-- outside this repo's migration history, which means a fresh environment built
-- from `supabase/migrations` alone would NOT have them, and the anonymous send
-- path would start failing the moment it tried to write them.
--
-- So this is a reconciliation, not a change: every statement is idempotent, it is
-- a no-op against production, and it makes the schema the Hint depends on
-- reproducible from the repo. Nothing is dropped and no existing value is touched.
--
-- WHAT IS STORED, AND WHAT DELIBERATELY IS NOT
--
-- Coarse location (city / subdivision / country) and a device family string of
-- the form '<device> • <browser>'. That is exactly what the Hint has always
-- claimed to show and what the recipient spends coins to see.
--
-- Not stored: the sender's IP address, coordinates, or raw user-agent. The point
-- of the feature is to narrow "somebody" to "somebody on an Android phone in
-- Lagos" — enough to be worth a coin, nowhere near enough to identify a person.
-- Storing the IP would cross that line and is why the capture route returns only
-- these four derived strings. See `lib/senderContext.ts`.

alter table public.messages
  add column if not exists sender_country text,
  add column if not exists sender_state   text,
  add column if not exists sender_city    text,
  add column if not exists sender_device  text;

comment on column public.messages.sender_country is
  'Coarse country name (e.g. "Nigeria"), from edge geo headers at send time. Shown in the paid Hint. Never an IP.';
comment on column public.messages.sender_state is
  'ISO-3166-2 subdivision code, only populated when no city was resolvable — see app/api/sender-context/route.ts.';
comment on column public.messages.sender_city is
  'Coarse city name from edge geo headers at send time. Shown in the paid Hint.';
comment on column public.messages.sender_device is
  'Device family and browser as "<device> • <browser>", derived from client hints / user-agent. The raw UA is never stored.';

-- No index. These columns are only ever read as part of a row already being
-- fetched by `recipient_id`, never filtered or grouped on, so an index would cost
-- write throughput on the app's highest-volume insert and buy nothing.
--
-- No RLS change either. `messages` policies are row-level and Supabase's grants
-- are table-wide, so the existing anonymous-insert policy already covers these
-- columns — which is why the now-dead `app/u/[username]/Profile.tsx` was able to
-- write them without a policy of its own.
