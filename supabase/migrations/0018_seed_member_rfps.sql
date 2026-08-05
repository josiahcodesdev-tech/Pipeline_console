-- Gives a new member the tender pool on their first sign-in.
--
-- Scraped opportunities are stored per member, so an account created today
-- owns nothing and opens the tracker to an empty page. The 05:00 run would
-- fill it, but only with what the sources publish tomorrow — and only after a
-- day of the console looking broken to someone who has just been given it.
--
-- This copies the currently open tenders from what the firm already holds.
-- Deliberately a *clean* copy: status back to Watching, notes and any attached
-- tender document dropped, nothing marked as in a pipeline. What a colleague
-- has written about a bid is theirs, and a new member inheriting someone
-- else's working notes would be both confusing and a small privacy leak.
--
-- Closed tenders are skipped. They cannot be bid on, and the tracker hides
-- them by default anyway.
--
-- SECURITY DEFINER because it writes rows owned by somebody else, which no
-- policy permits and should not. It is called by the members function straight
-- after an account is created; `revoke ... from public` keeps it off the API
-- surface so a member cannot call it for themselves.
--
-- Run after 0017. Safe to re-run — the unique index on (user_id, external_id)
-- makes a second call a no-op.

create or replace function public.seed_member_rfps(target uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  copied integer;
begin
  if target is null then
    return 0;
  end if;

  insert into public.rfps (
    user_id, title, org, segment, deadline, value, status, link, notes,
    source, sourced, created_on, external_id, in_pipeline, opportunity_type,
    kenya, service_areas, fit_score
  )
  -- One row per tender: the pool is duplicated across existing members, so
  -- without DISTINCT ON the new member would get several copies of each.
  select distinct on (r.external_id)
    target, r.title, r.org, r.segment, r.deadline, r.value, 'Watching',
    r.link, '', r.source, r.sourced, r.created_on, r.external_id, false,
    r.opportunity_type, r.kenya, r.service_areas, r.fit_score
  from public.rfps r
  where r.external_id is not null
    and (r.deadline is null or r.deadline >= current_date)
  order by r.external_id, r.created_at desc
  on conflict (user_id, external_id) do nothing;

  get diagnostics copied = row_count;
  return copied;
end;
$$;

revoke all on function public.seed_member_rfps(uuid) from public;
revoke all on function public.seed_member_rfps(uuid) from anon, authenticated;
