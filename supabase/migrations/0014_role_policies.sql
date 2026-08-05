-- Re-states every table's row-level security against the roles from 0013.
--
-- The shape is identical on all seven pipeline tables, so it is generated in a
-- loop rather than written out eight times. Reading eight near-identical copies
-- is how a policy ends up subtly different on one table and nobody notices
-- until someone sees a row they should not.
--
--   select   own rows, or anything at all for an admin or the super user
--   insert   own rows only — user_id is forced to the caller
--   update   own rows only, admins included; see the note in 0013 on why
--            oversight is read-and-delete rather than read-and-write
--   delete   admins and the super user only
--
-- The delete rule is the one that will surprise people: a standard user cannot
-- delete their own records either. That is deliberate — deletion is the single
-- action with no undo in this console, and it was scoped to the two roles that
-- answer for the data.
--
-- user_settings is left alone. It holds one row of the signed-in member's own
-- drafting guidance, nobody else has any reason to read it, and it has no
-- delete path to gate.
--
-- Run after 0013. Safe to re-run.

do $$
declare
  t text;
begin
  foreach t in array array[
    'leads', 'rfps', 'tasks', 'activities', 'weekly_reports', 'proposals', 'consultants'
  ]
  loop
    -- Old ownership-only policies, by the names 0001-0012 gave them.
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    -- and this migration's own, so it can be re-run.
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format($p$
      create policy %I on public.%I for select to authenticated
      using (user_id = auth.uid() or public.is_admin())
    $p$, t || '_select', t);

    execute format($p$
      create policy %I on public.%I for insert to authenticated
      with check (user_id = auth.uid())
    $p$, t || '_insert', t);

    execute format($p$
      create policy %I on public.%I for update to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid())
    $p$, t || '_update', t);

    execute format($p$
      create policy %I on public.%I for delete to authenticated
      using (public.is_admin())
    $p$, t || '_delete', t);
  end loop;
end $$;
