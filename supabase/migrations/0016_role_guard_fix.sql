-- Closes a privilege-escalation hole opened by 0015.
--
-- 0015 let a trusted server-side connection through the role guard by testing
-- `current_user in ('service_role', 'postgres', 'supabase_admin')`. Inside a
-- SECURITY DEFINER function — which this trigger is, and has to be —
-- `current_user` is the function's *owner*, not the caller. The owner is
-- `postgres`. So the check was true for every caller, and the guard let any
-- signed-in member set their own role to super_user.
--
-- Caught by testing the escalation rather than reading the code: a plain PATCH
-- of /rest/v1/profiles from a standard user's token came back with an empty
-- body, which reads like a refusal, and the role had changed anyway.
--
-- The caller is identified by the JWT role claim instead, which SECURITY
-- DEFINER does not rewrite:
--
--   'authenticated'  a signed-in member  -> must be the super user
--   'service_role'   the members function -> allowed
--   null             a direct database connection (SQL editor, migration,
--                    psql) -> allowed, and this is the bootstrap path for the
--                    first super user
--
-- A member cannot forge the claim: it is signed into the token by the auth
-- server, and the key that mints a service_role token is never shipped to a
-- browser.
--
-- Run after 0015. Safe to re-run.

create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claims text;
  jwt_role text;
begin
  if new.role is not distinct from old.role
     and new.active is not distinct from old.active then
    return new;
  end if;

  -- `true` makes a missing setting return null rather than raising; an unset
  -- GUC can also come back as the empty string, which is not valid json.
  claims := nullif(current_setting('request.jwt.claims', true), '');
  jwt_role := case when claims is null then null else claims::json ->> 'role' end;

  -- No JWT: a direct database connection, not a request from the app.
  if jwt_role is null then
    return new;
  end if;

  if jwt_role = 'service_role' then
    return new;
  end if;

  if public.is_super_user() then
    return new;
  end if;

  raise exception 'Only the super user can change a member''s role or access.';
end;
$$;
