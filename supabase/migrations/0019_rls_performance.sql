-- Stops the access check running once per row.
--
-- 0014 wrote every table's read policy as
--
--   using (user_id = auth.uid() or public.is_admin())
--
-- Both of those are function calls sitting in a row filter, so Postgres calls
-- them for every row it examines. `is_admin()` queries `profiles` each time, so
-- reading 478 RFPs asked "what is this person's role?" 478 times — and then did
-- it again for leads, tasks, activities, proposals, reports and consultants on
-- the same page load. It got slower the moment members were added, because
-- adding members is what makes the tables grow.
--
-- Wrapping a call in `(select ...)` turns it into an InitPlan: evaluated once
-- for the whole statement and reused. The result is identical — both functions
-- are STABLE and cannot change mid-statement — so this is purely a matter of
-- how many times the planner chooses to ask.
--
-- Putting the admin check first also lets the common case short-circuit: for a
-- standard user it resolves to false immediately and what remains is
-- `user_id = <constant>`, which the existing (user_id, ...) indexes can serve
-- instead of scanning the table.
--
-- Run after 0014. Safe to re-run.

do $$
declare
  t text;
begin
  foreach t in array array[
    'leads', 'rfps', 'tasks', 'activities', 'weekly_reports', 'proposals', 'consultants'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format($p$
      create policy %I on public.%I for select to authenticated
      using ((select public.is_admin()) or user_id = (select auth.uid()))
    $p$, t || '_select', t);

    execute format($p$
      create policy %I on public.%I for insert to authenticated
      with check (user_id = (select auth.uid()))
    $p$, t || '_insert', t);

    execute format($p$
      create policy %I on public.%I for update to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()))
    $p$, t || '_update', t);

    execute format($p$
      create policy %I on public.%I for delete to authenticated
      using ((select public.is_admin()))
    $p$, t || '_delete', t);
  end loop;
end $$;

-- The same treatment for the two tables 0013/0017 added.
drop policy if exists rfp_claims_insert on public.rfp_claims;
create policy rfp_claims_insert on public.rfp_claims
  for insert to authenticated with check (claimed_by = (select auth.uid()));

drop policy if exists rfp_claims_delete on public.rfp_claims;
create policy rfp_claims_delete on public.rfp_claims
  for delete to authenticated
  using (claimed_by = (select auth.uid()) or (select public.is_admin()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists profiles_manage on public.profiles;
create policy profiles_manage on public.profiles
  for update to authenticated
  using ((select public.is_super_user())) with check ((select public.is_super_user()));

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated with check ((select public.is_super_user()));
