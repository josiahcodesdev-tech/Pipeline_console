-- Team access: three roles, private pipelines, oversight for the top two.
--
-- Until now every table answered one question — "is this row mine?" — and that
-- was the whole authorisation model. It works for one person and silently
-- fragments for eight: the same tender gets scraped into eight pipelines and
-- nobody can see what anyone else is bidding on.
--
-- The model here keeps each member's pipeline private, which is what was asked
-- for, and adds oversight above it:
--
--   super_user  own rows, reads everyone's, deletes anything, manages members
--   admin       own rows, reads everyone's, deletes anything
--   user        own rows only, and cannot delete
--
-- Two deliberate limits worth knowing:
--
-- Reading is not editing. An admin can see and delete another member's row but
-- cannot silently edit it, because a bid someone is mid-way through writing is
-- theirs until they hand it over. Widening that is one clause per table if the
-- oversight ever needs teeth.
--
-- The role lives in its own table rather than in auth.users metadata. App
-- metadata is writable from the client with a user's own token, so a role kept
-- there is a role any member can grant themselves.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

-- `create type` has no IF NOT EXISTS, and this file is meant to be re-runnable.
do $$ begin
  create type public.member_role as enum ('super_user', 'admin', 'user');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null default '',
  full_name   text not null default '',
  role        public.member_role not null default 'user',
  /**
   * Cleared rather than deleted when someone leaves: their rows stay owned and
   * their history stays readable, but they cannot sign in and work.
   */
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- helpers ---

-- SECURITY DEFINER so the function can read profiles from inside a policy on
-- profiles itself. Without it, "can this user read profiles?" would consult a
-- policy that has to read profiles to answer, and recurse.
--
-- search_path is pinned because a SECURITY DEFINER function that resolves its
-- own table names through the caller's search_path can be pointed at a
-- look-alike table by any member who can create a schema.
create or replace function public.current_role()
returns public.member_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.role from public.profiles p where p.id = auth.uid() and p.active),
    'user'::public.member_role
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_role() in ('super_user', 'admin');
$$;

create or replace function public.is_super_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_role() = 'super_user';
$$;

-- A profile for every member, created with the account rather than by hand, so
-- there is no window in which a signed-in user has no row and no role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill anyone who signed up before this migration existed.
insert into public.profiles (id, email)
select u.id, coalesce(u.email, '') from auth.users u
on conflict (id) do nothing;

-- --------------------------------------------------------------- profiles ---

alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists profiles_manage on public.profiles;
drop policy if exists profiles_insert on public.profiles;

-- Everyone can see the team list. Knowing who your colleagues are is not
-- privileged information, and the app needs it to show who owns a record.
create policy profiles_select on public.profiles
  for select to authenticated using (true);

-- Anyone may edit their own name. Nobody may edit their own role or active
-- flag — that check lives in the trigger below, because a WITH CHECK clause
-- cannot see the row's previous values to compare against.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_manage on public.profiles
  for update to authenticated
  using (public.is_super_user()) with check (public.is_super_user());

create policy profiles_insert on public.profiles
  for insert to authenticated with check (public.is_super_user());

-- The privilege-escalation guard. Without it, `profiles_update_self` lets any
-- member set their own role to super_user — the policy only checks *which row*
-- is being written, not *which columns*.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active)
     and not public.is_super_user() then
    raise exception 'Only the super user can change a member''s role or access.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

comment on table public.profiles is
  'Team members and their access level. Role is changed only by the super user; the guard trigger enforces it regardless of which policy allowed the write.';
