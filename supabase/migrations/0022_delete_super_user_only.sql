-- Deletion belongs to the super user alone.
--
-- 0014 gave it to both admin roles. The admin now has everything else the
-- super user has — reading every member's pipeline, running the sync, the
-- firm-wide figures — and deletion is the single exception alongside managing
-- members.
--
-- The reason it is the exception: it is the only action in this console with
-- no undo. Removing an RFP cascades to its activities and proposals, so one
-- click can take a bid someone else is mid-way through writing, and there is
-- nothing to restore it from. Everything else an admin can do is either
-- reversible or read-only.
--
-- Standard users still have no delete at all, which is unchanged.
--
-- Run after 0019. Safe to re-run.

do $$
declare
  t text;
begin
  foreach t in array array[
    'leads', 'rfps', 'tasks', 'activities', 'weekly_reports', 'proposals', 'consultants'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format($p$
      create policy %I on public.%I for delete to authenticated
      using ((select public.is_super_user()))
    $p$, t || '_delete', t);
  end loop;
end $$;

-- Releasing a tender claim is not deletion in the destructive sense — it hands
-- the opportunity back so somebody else can take it, and nothing is lost. The
-- admin keeps that, which is what lets them free a tender held by someone who
-- has left or moved on.
drop policy if exists rfp_claims_delete on public.rfp_claims;
create policy rfp_claims_delete on public.rfp_claims
  for delete to authenticated
  using (claimed_by = (select auth.uid()) or (select public.is_admin()));
