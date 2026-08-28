-- Narrow the audit trail to the super user.
--
-- WHAT CHANGES. `audit_log_select` was `using (public.is_admin())`, and
-- `is_admin()` is true for the admin role as well as the super user. So every
-- admin could read the firm-wide record of who changed what, when, and which
-- fields moved — across every member's leads, tenders, proposals and activity.
--
-- WHY IT IS A MIGRATION AND NOT A HIDDEN MENU ITEM. The Records page is being
-- hidden from admins in the same change, and hiding it is not the protection.
-- The page is a `select` against `audit_log` and `proposals`; anyone who can
-- open a browser console can issue that select whether or not a link to it
-- appears in the sidebar. This console's own rule, written into nav.ts when
-- Members was narrowed the same way: a hidden button and a refused request are
-- not the same protection, and only the second one survives.
--
-- WHY THE SUPER USER AND NOT OVERSIGHT GENERALLY. The audit trail is the record
-- that says what an administrator did. An administrator who can read it — and
-- who is one of a handful of people it is about — is being asked to audit
-- themselves. That is the one permission in this schema where "oversight" is
-- the wrong boundary.
--
-- WHAT ADMINS KEEP. Everything they had except this page. Migration 0038 gives
-- them the firm-wide read on records themselves; this removes only the trail of
-- changes to them.

drop policy if exists audit_log_select on public.audit_log;

create policy audit_log_select on public.audit_log
  for select
  to authenticated
  using (public.is_super_user());

comment on policy audit_log_select on public.audit_log is
  'Super user only. The audit trail records what administrators do, so an administrator who could read it would be auditing themselves — see migration 0043.';

notify pgrst, 'reload schema';
