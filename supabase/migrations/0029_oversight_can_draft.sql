-- Let oversight draft on a tender a member has taken, into that member's name.
--
-- 0028 let an admin insert a proposal against a held tender, but kept the
-- original `user_id = auth.uid()` rule, so the draft landed owned by the admin.
-- The select policy on proposals is `is_admin() or user_id = auth.uid()`, which
-- means the member whose bid it was could not read the draft written for them.
-- A proposal only oversight can see is not help; it is a second copy of the bid
-- in a place the person doing the work never looks.
--
-- So the rule changes from "a proposal belongs to whoever wrote it" to "a
-- proposal belongs to the owner of its tender". That is not a new constraint
-- being imposed on old data: all 16 proposals held today already satisfy it,
-- because until now the only writer was the tender's owner. It is the same
-- invariant, finally written down — and once written down, an admin can be
-- allowed to write a row in somebody else's name without ambiguity about whose
-- bid it belongs to.
--
-- Standard users are unchanged: they may still only write against their own
-- tender, and still not against one a colleague has claimed.
--
-- Files are a separate matter and are handled below.
--
-- Run after 0028.

-- ------------------------------------------------------------------ the row
drop policy if exists proposals_insert on public.proposals;
create policy proposals_insert on public.proposals
  for insert to authenticated
  with check (
    -- Whoever writes it, the proposal belongs to the tender's owner.
    user_id = (
      select r.user_id from public.rfps r where r.id = proposals.rfp_id
    )
    and (
      (select public.is_admin())
      or (
        user_id = (select auth.uid())
        and not exists (
          select 1 from public.rfps r
           where r.id = proposals.rfp_id
             and public.tender_held_by_other(r.external_id)
        )
      )
    )
  );

-- Editing one — starring it as an exemplar, renaming it — follows the same
-- reasoning as 0028's rfps_update: oversight can act, members cannot reach
-- across.
drop policy if exists proposals_update on public.proposals;
create policy proposals_update on public.proposals
  for update to authenticated
  using ((select public.is_admin()) or user_id = (select auth.uid()))
  with check ((select public.is_admin()) or user_id = (select auth.uid()));

-- ---------------------------------------------------------------- the files
-- Object paths begin with a uid and the policies compare that first segment to
-- the caller's. That is what makes a submitted document private to its owner,
-- and it is also what stops an admin attaching one on a member's behalf: the
-- path has to name the member for them to read it afterwards, and naming the
-- member is exactly what the insert policy refuses.
--
-- Admins are therefore matched on the folder belonging to any member rather
-- than on it being their own. Standard users are unchanged — the first segment
-- must still be their own uid, so a member still cannot read, write or delete
-- a colleague's file.
drop policy if exists proposal_files_select_own on storage.objects;
create policy proposal_files_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'proposals'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_admin())
    )
  );

drop policy if exists proposal_files_insert_own on storage.objects;
create policy proposal_files_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'proposals'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      -- An admin may write into a member's folder, but the folder still has to
      -- be a member's: without this, any path at all would pass.
      or (
        (select public.is_admin())
        and exists (
          select 1 from public.profiles p
           where p.id::text = (storage.foldername(name))[1]
        )
      )
    )
  );

drop policy if exists proposal_files_delete_own on storage.objects;
create policy proposal_files_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'proposals'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_admin())
    )
  );

comment on column public.proposals.user_id is
  'The owner of the parent tender, not necessarily whoever wrote the row — oversight may draft on a member''s bid. Enforced by proposals_insert; see migration 0029.';

notify pgrst, 'reload schema';
