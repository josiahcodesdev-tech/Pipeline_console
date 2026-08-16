-- Records every super-user switch into a standard member account.
create table if not exists public.impersonation_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  target_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (actor_id <> target_id)
);

create index if not exists impersonation_audit_created_idx
  on public.impersonation_audit (created_at desc);

alter table public.impersonation_audit enable row level security;

-- The Edge Function writes with service role. Super users may inspect the log,
-- but nobody can edit or delete it through the Data API.
drop policy if exists impersonation_audit_select on public.impersonation_audit;
create policy impersonation_audit_select on public.impersonation_audit
  for select to authenticated
  using ((select public.is_super_user()));

notify pgrst, 'reload schema';
