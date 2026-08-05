-- Exactly one admin, enforced by the database.
--
-- The console is meant to have one super user, one admin and everyone else as
-- users. "One admin" kept as a rule people follow is a rule that lasts until
-- somebody is in a hurry; kept as a unique index it cannot be broken at all,
-- including by a direct SQL edit that bypasses the app entirely.
--
-- A unique index on `role` filtered to admins means the second admin row is a
-- duplicate key rather than a policy question. The super user is unaffected —
-- the filter only covers 'admin' — and there is no limit on plain users.
--
-- Any existing extra admins must be demoted before this can be created; the
-- index will refuse to build otherwise, which is the correct failure. It says
-- the data does not match the rule instead of quietly picking a winner.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

create unique index if not exists profiles_one_admin
  on public.profiles (role)
  where role = 'admin';

comment on index public.profiles_one_admin is
  'At most one admin. A second is a duplicate key, not a judgement call.';
