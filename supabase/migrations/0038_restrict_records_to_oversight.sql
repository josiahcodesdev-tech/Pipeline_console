-- Records and audit history are an oversight function. Members continue to
-- work with their own live records, but cannot browse the audit ledger.
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select
  using (public.is_admin());

comment on policy audit_log_select on public.audit_log is
  'Only admin and super_user roles can read the audit trail.';
