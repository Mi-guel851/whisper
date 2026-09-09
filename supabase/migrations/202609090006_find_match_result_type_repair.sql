-- Repair Find a Match's runtime result-type mismatch.
--
-- `find_match_candidates()` declares `rank_score` as double precision, but the
-- score in 202609090003/005 was made entirely from PostgreSQL numeric literals
-- (`200.0`, `24.0`, `100.0`). PostgreSQL therefore inferred the CTE's score as
-- `numeric`. PL/pgSQL's RETURN QUERY does not silently change a returned
-- `numeric` into the declared `double precision`, so every authenticated scan
-- reached the query and failed with:
--
--   structure of query does not match function result type
--
-- This replacement gives every internal result a name different from the OUT
-- parameter names and casts all four returned fields to their exact declared
-- types. The distinct names also prevent a recurrence of the OUT-column
-- ambiguity repaired in 202609090005. No data is changed or dropped.

create or replace function public.find_match_candidates(p_page integer default 0)
returns table (
  profile_id     uuid,
  country_code   text,
  active_recent  boolean,
  rank_score     double precision
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict error
declare
  v_caller_id uuid := auth.uid();
  v_caller_country_code text;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select p_self.country_code::text
    into v_caller_country_code
  from public.profiles as p_self
  where p_self.id = v_caller_id;

  -- A legacy profile with no self-declared country cannot have a regional
  -- match. This is an empty result, not a database error.
  if v_caller_country_code is null then
    return;
  end if;

  return query
  with ranked_candidates as (
    select
      p.id::uuid as candidate_profile_id,
      p.country_code::text as candidate_country_code,
      (
        coalesce(p.last_active_at, p.created_at) > now() - interval '24 hours'
      )::boolean as candidate_active_recent,
      (
        (case when p.country_code::text = v_caller_country_code then 200.0 else 0.0 end)
        + (case
            when coalesce(p.last_active_at, p.created_at) > now() - interval '24 hours'
              then 100.0
            else 0.0
          end)
        + greatest(
            0.0,
            24.0
              - extract(epoch from now() - coalesce(p.last_active_at, p.created_at)) / 3600.0
          )
        -- Apply modulo before abs: abs(the minimum 32-bit integer) overflows,
        -- while hash % 100 is always safely between -99 and 99.
        + abs(
            hashtext(
              p.id::text
                || ':' || v_caller_id::text
                || ':' || to_char(date_trunc('day', now()), 'YYYY-MM-DD')
            ) % 100
          ) / 100.0
      )::double precision as candidate_rank_score
    from public.profiles as p
    where p.id <> v_caller_id
      and p.profile_completed is distinct from false
      and p.find_a_match_enabled is distinct from false
      and p.country_code is not null
      and not public.user_is_banned(p.id)
      and not exists (
        select 1
        from public.blocked_users as blocked
        where (blocked.user_id = v_caller_id and blocked.blocked_user_id = p.id)
           or (blocked.user_id = p.id and blocked.blocked_user_id = v_caller_id)
      )
      and not exists (
        select 1
        from public.friends as friendship
        where (friendship.user_id = v_caller_id and friendship.friend_id = p.id)
           or (friendship.user_id = p.id and friendship.friend_id = v_caller_id)
      )
      and not exists (
        select 1
        from public.friend_requests as request
        where request.status = 'pending'
          and least(request.sender_id, request.receiver_id) = least(v_caller_id, p.id)
          and greatest(request.sender_id, request.receiver_id) = greatest(v_caller_id, p.id)
      )
  )
  select
    candidate.candidate_profile_id,
    candidate.candidate_country_code,
    candidate.candidate_active_recent,
    candidate.candidate_rank_score
  from ranked_candidates as candidate
  order by candidate.candidate_rank_score desc, candidate.candidate_profile_id
  limit 20
  offset greatest(0, least(coalesce(p_page, 0), 9)) * 20;
end;
$$;

revoke all on function public.find_match_candidates(integer) from public;
revoke all on function public.find_match_candidates(integer) from anon;
grant execute on function public.find_match_candidates(integer) to authenticated;

comment on function public.find_match_candidates(integer) is
  'Find a Match radar: returns type-safe ranked regional candidates, excluding self, incomplete profiles, opt-outs, bans, blocks, friends and pending requests.';
