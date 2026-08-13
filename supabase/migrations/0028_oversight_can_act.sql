-- Let oversight act on a tender somebody else has taken, and hand it to
-- somebody else.
--
-- 0023 made a held tender read-only and said so explicitly for admins too:
-- "Oversight is reading; an admin who needs to act releases the claim first."
-- That was the wrong call in practice. Releasing a claim to fix a typo hands
-- the tender back to the pool where anyone can take it, which is a far larger
-- act than the edit being made — and it left the super user, who owns the
-- workspace, unable to touch a bid a member had left half-finished or to move
-- one to a colleague when somebody went on leave. The lock exists to stop two
-- members bidding the same tender in parallel, not to stop the person
-- responsible for the pipeline from managing it.
--
-- Standard users are unchanged: a tender held by a colleague stays read-only,
-- which is the case the lock was built for.
--
-- Run after 0027.

-- ------------------------------------------------------------------ editing
-- `with check` has to admit the admin too, or an admin updating a member's row
-- passes the `using` clause and is then rejected for leaving user_id pointing
-- at somebody else — which is precisely what editing another member's tender
-- means.
drop policy if exists rfps_update on public.rfps;
create policy rfps_update on public.rfps
  for update to authenticated
  using (
    (select public.is_admin())
    or (
      user_id = (select auth.uid())
      and not (select public.tender_held_by_other(external_id))
    )
  )
  with check (
    (select public.is_admin())
    or (
      user_id = (select auth.uid())
      and not (select public.tender_held_by_other(external_id))
    )
  );

-- Drafting and logging against a held tender, same reasoning. The row still has
-- to belong to the writer — an admin drafts on their own copy or on the row
-- they have reassigned to themselves — but the claim no longer blocks them.
drop policy if exists proposals_insert on public.proposals;
create policy proposals_insert on public.proposals
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      (select public.is_admin())
      or not exists (
        select 1 from public.rfps r
         where r.id = proposals.rfp_id
           and public.tender_held_by_other(r.external_id)
      )
    )
  );

drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      rfp_id is null
      or (select public.is_admin())
      or not exists (
        select 1 from public.rfps r
         where r.id = activities.rfp_id
           and public.tender_held_by_other(r.external_id)
      )
    )
  );

-- Oversight may move a claim as part of a reassignment. Members still release
-- only their own.
drop policy if exists rfp_claims_update on public.rfp_claims;
create policy rfp_claims_update on public.rfp_claims
  for update to authenticated
  using (claimed_by = (select auth.uid()) or (select public.is_admin()))
  with check (true);

-- -------------------------------------------------------------- reassigning
/**
 * Hands a tender, and everything attached to it, to another member.
 *
 * A function rather than a sequence of updates from the browser because it is
 * four writes across four tables that have to agree afterwards. Half of it
 * applied — the tender moved but the claim did not — leaves the firm-wide lock
 * pointing at somebody who no longer holds the bid, which is the exact failure
 * the claim exists to prevent.
 *
 * SECURITY DEFINER so it can write rows the caller does not own, with the
 * privilege check written out below rather than left to row-level security.
 */
create or replace function public.reassign_rfp(target uuid, new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_owner uuid;
  tender_external_id text;
  is_in_pipeline boolean;
begin
  if not public.is_admin() then
    raise exception 'Only an admin or the super user can reassign a tender.'
      using errcode = '42501';
  end if;

  select user_id, external_id, in_pipeline
    into current_owner, tender_external_id, is_in_pipeline
    from public.rfps where id = target;

  if not found then
    raise exception 'That tender no longer exists.' using errcode = 'P0002';
  end if;

  -- Checked against profiles rather than auth.users: a member switched off has
  -- an account but no business being handed a live bid.
  if not exists (
    select 1 from public.profiles p where p.id = new_owner and p.active
  ) then
    raise exception 'That member does not exist or has no access.'
      using errcode = 'P0002';
  end if;

  if current_owner = new_owner then
    return;
  end if;

  -- Every member holds their own copy of a scraped tender, so the new owner
  -- probably already has one. Two rows for one opportunity in their tracker is
  -- the confusing outcome, so their untouched copy goes — untouched meaning
  -- exactly what 0027 meant by it, and anything else is left alone rather than
  -- risking a cascade through work somebody did.
  if tender_external_id is not null then
    delete from public.rfps dup
     where dup.user_id = new_owner
       and dup.external_id = tender_external_id
       and dup.id <> target
       and dup.in_pipeline = false
       and not exists (select 1 from public.activities a where a.rfp_id = dup.id)
       and not exists (select 1 from public.proposals p where p.rfp_id = dup.id);
  end if;

  update public.rfps set user_id = new_owner where id = target;

  -- The work follows the tender. A proposal the new owner cannot read is a
  -- proposal that may as well have been deleted: the select policy is scoped by
  -- user_id, so leaving these behind would hide them from the person now
  -- responsible for the bid.
  update public.proposals set user_id = new_owner where rfp_id = target;
  update public.activities set user_id = new_owner where rfp_id = target;

  -- And the firm-wide lock, so nobody else can take what was just handed over.
  if tender_external_id is not null and is_in_pipeline then
    insert into public.rfp_claims (external_id, claimed_by, title)
    values (
      tender_external_id,
      new_owner,
      coalesce((select title from public.rfps where id = target), '')
    )
    on conflict (external_id) do update set claimed_by = excluded.claimed_by;
  end if;
end;
$$;

comment on function public.reassign_rfp(uuid, uuid) is
  'Moves a tender, its proposals, its activities and its claim to another member. Admin and super user only.';

revoke all on function public.reassign_rfp(uuid, uuid) from public;
grant execute on function public.reassign_rfp(uuid, uuid) to authenticated;
