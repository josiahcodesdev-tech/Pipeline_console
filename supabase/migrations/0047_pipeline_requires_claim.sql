-- A synced tender can be in only one member's pipeline: the one holding its claim.
--
-- THE PROBLEM. One proposal per tender has been the rule since migration 0017,
-- but only the console enforced it. Taking a tender on writes the firm-wide
-- claim first and sets `in_pipeline` second, and the primary key on
-- `rfp_claims` refuses a second taker. Nothing stopped `in_pipeline` being set
-- without a claim, though, and a row in somebody's pipeline with no claim is a
-- tender anyone else can still take and bid. One such row was live when this
-- was written.
--
-- THE CHANGE. Two parts.
--   1. A claim is created for every pipeline row that lacks one, in the name of
--      the member whose pipeline it is in.
--   2. A constraint trigger refuses any change that leaves a synced tender in a
--      pipeline whose owner does not hold its claim.
--
-- DEFERRED ON PURPOSE. Reassigning a tender (reassign_rfp, migration 0028)
-- moves the row to the new owner one statement before it moves the claim. A
-- check per statement would refuse that half-way state; checked at commit,
-- the transaction is judged on where it ends, which is consistent.
--
-- Hand-added tenders have no external id and so no claim. They are each
-- member's own record and nobody else can see them to take, so they are out of
-- scope here, as they are in 0017.
--
-- Safe to re-run.

-- 1. Claims for pipeline rows that have none. Oldest row first if a tender is
--    somehow in two pipelines; it was in none when this was written.
insert into public.rfp_claims (external_id, claimed_by, title)
select distinct on (r.external_id) r.external_id, r.user_id, coalesce(r.title, '')
  from public.rfps r
 where r.in_pipeline
   and r.external_id is not null
   and not exists (select 1 from public.rfp_claims c where c.external_id = r.external_id)
 order by r.external_id, r.created_at
on conflict (external_id) do nothing;

-- 2. The rule itself.
create or replace function public.rfp_pipeline_requires_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.in_pipeline and new.external_id is not null and not exists (
    select 1 from public.rfp_claims c
     where c.external_id = new.external_id
       and c.claimed_by = new.user_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'This tender is taken by another member, so it cannot be added to this pipeline.',
      hint = 'Take the tender first (which claims it), or ask an admin to reassign it.';
  end if;
  return null;
end;
$$;

drop trigger if exists rfp_pipeline_requires_claim on public.rfps;
create constraint trigger rfp_pipeline_requires_claim
  after insert or update of in_pipeline, user_id, external_id on public.rfps
  deferrable initially deferred
  for each row
  when (new.in_pipeline and new.external_id is not null)
  execute function public.rfp_pipeline_requires_claim();
