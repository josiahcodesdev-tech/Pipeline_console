-- A tender someone else holds is read-only, enforced rather than hidden.
--
-- The profile page already withholds the draft, edit, attach and log controls
-- when another member has claimed the tender. That is the visible half. This is
-- the half that survives someone opening the console and calling the API
-- directly, which is the only half that counts as protection.
--
-- Every member holds their own copy of a scraped tender, so nothing stopped one
-- of them editing *their* copy of a notice another member is bidding: their own
-- row, their own user_id, permitted by the previous policy. The result would
-- have been two people quietly working the same tender in parallel — worse than
-- the duplicate bidding the claim was introduced to prevent, because it leaves
-- no trace.
--
-- Applies to admins and the super user too. Oversight is reading; an admin who
-- needs to act releases the claim first, which is a deliberate act that shows
-- up rather than a silent edit.
--
-- Hand-added RFPs have no external id, match no claim, and are unaffected.
--
-- Run after 0022. Safe to re-run.

-- The predicate, written once. Both policies below ask the same question:
-- "is this tender held by somebody other than me?"
create or replace function public.tender_held_by_other(target_external_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.rfp_claims c
     where c.external_id = target_external_id
       and c.claimed_by <> auth.uid()
  );
$$;

drop policy if exists rfps_update on public.rfps;
create policy rfps_update on public.rfps
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and not (select public.tender_held_by_other(external_id))
  )
  with check (
    user_id = (select auth.uid())
    and not (select public.tender_held_by_other(external_id))
  );

-- Drafting is an insert into proposals, so blocking the button is not enough:
-- the draft would still save. The parent RFP is the caller's own copy, and its
-- external id is what ties it to the claim.
drop policy if exists proposals_insert on public.proposals;
create policy proposals_insert on public.proposals
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and not exists (
      select 1 from public.rfps r
       where r.id = proposals.rfp_id
         and public.tender_held_by_other(r.external_id)
    )
  );

-- Same reasoning for logging activity against a tender someone else is bidding.
drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      rfp_id is null
      or not exists (
        select 1 from public.rfps r
         where r.id = activities.rfp_id
           and public.tender_held_by_other(r.external_id)
      )
    )
  );

comment on function public.tender_held_by_other(text) is
  'True when a claim on this tender belongs to somebody other than the caller. The read-only rule for locked tenders.';
