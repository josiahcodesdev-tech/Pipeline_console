-- Lets the members service actually set a role.
--
-- 0013 added a trigger that refuses any change to `role` or `active` unless
-- `is_super_user()` says so, and `is_super_user()` reads `auth.uid()`. The
-- manage-members function connects with the service-role key, where there is
-- no `auth.uid()` at all — so the trigger read the one caller that is allowed
-- to do this as the one caller that is not, and refused it.
--
-- The symptom was narrow enough to miss: creating a member as `user` worked,
-- because the role never actually changed from its default. Only creating an
-- admin failed.
--
-- The fix keys on the database role rather than the JWT. PostgREST switches to
-- `service_role` for a service-key request, and there is no way to reach that
-- role from a browser — the key that grants it is the one thing never shipped
-- to a client. `postgres` and `supabase_admin` are included so the first super
-- user can be set from the SQL editor without disabling the trigger, which was
-- otherwise the documented bootstrap and is a bad habit to require.
--
-- Run after 0013. Safe to re-run.

create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role is not distinct from old.role
     and new.active is not distinct from old.active then
    return new;
  end if;

  -- A trusted server-side connection: the members function, or a maintainer in
  -- the SQL editor. Never a signed-in member, whose requests arrive as
  -- `authenticated`.
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if public.is_super_user() then
    return new;
  end if;

  raise exception 'Only the super user can change a member''s role or access.';
end;
$$;
