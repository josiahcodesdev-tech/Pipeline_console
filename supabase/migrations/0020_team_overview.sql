-- Firm-wide figures that count tenders rather than copies of tenders.
--
-- Every member holds their own copy of each scraped opportunity, so anything
-- that adds up per-member numbers counts the same tender once per member. With
-- five accounts the console would report 1,195 "active RFPs" when there were
-- 263 — a number that grows when you hire, which is not what anyone reading it
-- would take it to mean.
--
-- Counting is therefore done here, over `distinct external_id`, rather than by
-- summing what each dashboard shows. Hand-added RFPs have no external id and
-- are genuinely one-per-member, so they fall back to their own row id and count
-- individually — which is correct: two members each entering a tender by hand
-- really are two records.
--
-- SECURITY DEFINER so it can see across members, with an explicit role check
-- inside — the function reads everyone's rows, so it must refuse anyone who is
-- not entitled to that rather than relying on the caller to only ask nicely.
--
-- Run after 0019. Safe to re-run.

create or replace function public.team_overview()
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result json;
begin
  if not public.is_admin() then
    raise exception 'Only an admin or the super user can read firm-wide figures.';
  end if;

  select json_build_object(
    -- One entry per real tender, however many members hold a copy.
    'open_tenders', (
      select count(distinct coalesce(r.external_id, r.id::text))
      from public.rfps r
      where r.deadline is null or r.deadline >= current_date
    ),
    'all_tenders', (
      select count(distinct coalesce(r.external_id, r.id::text))
      from public.rfps r
    ),
    -- In-pipeline rows are already one per tender across the firm: a claim is
    -- exclusive, and a hand-added RFP is only ever in its author's list. So
    -- this is a plain count, not a distinct one.
    'in_pipeline', (
      select count(*) from public.rfps r where r.in_pipeline
    ),
    'unclaimed_open', (
      select count(distinct r.external_id)
      from public.rfps r
      where r.external_id is not null
        and (r.deadline is null or r.deadline >= current_date)
        and not exists (
          select 1 from public.rfp_claims c where c.external_id = r.external_id
        )
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.team_overview() from public;
grant execute on function public.team_overview() to authenticated;

comment on function public.team_overview() is
  'Firm-wide tender counts, deduplicated across members. Admin and super user only.';
