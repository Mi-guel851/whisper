-- Add parent_post_id to support threaded replies
alter table if exists public.public_feed_posts
  add column if not exists parent_post_id uuid references public.public_feed_posts(id) on delete cascade;

create index if not exists public_feed_posts_parent_idx on public.public_feed_posts (parent_post_id, created_at desc);

-- Allow inserting parent_post_id in RLS policy (inserts already check author_id equality)
-- No policy change needed unless a stricter insert check is in place.
