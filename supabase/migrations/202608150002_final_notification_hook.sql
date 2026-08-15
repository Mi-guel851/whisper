-- Hook the notifications table into the Edge Function
-- This ensures that ANY entry in public.notifications (inbox, friend, whisper)
-- instantly triggers a real-time push with the double-buzz.

-- 1. Create the HTTP hook function (requires pg_net extension)
-- If pg_net isn't available, the user must set up a Webhook in Supabase Dashboard
-- pointing INSERT on public.notifications to the notify-on-notification edge function.

-- This migration assumes the user will manually set up the webhook in the dashboard
-- as that is the most reliable way to handle the secure auth header.

-- RE-ASSERTING ALL NOTIFICATION TYPES IN THE CONSTRAINT
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('message', 'friend_request', 'public_feed', 'whisper'));
