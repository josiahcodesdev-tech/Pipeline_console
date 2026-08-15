-- Security boundaries that must hold even when a caller bypasses the UI.

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active = true
  );
$$;

revoke all on function public.is_active_user() from public;
grant execute on function public.is_active_user() to authenticated;

-- Restrictive policies are ANDed with every existing ownership/admin policy.
-- This closes the old gap where active=false changed the UI role but an old
-- session could still use the REST API against rows owned by the same uid.
do $$
declare
  t text;
begin
  foreach t in array array[
    'leads', 'rfps', 'tasks', 'weekly_reports', 'activities', 'user_settings',
    'proposals', 'profiles', 'rfp_claims', 'consultants', 'knowledge_chunks'
  ] loop
    execute format('drop policy if exists active_members_only on public.%I', t);
    execute format(
      'create policy active_members_only on public.%I as restrictive for all to authenticated
       using ((select public.is_active_user()))
       with check ((select public.is_active_user()))',
      t
    );
  end loop;
end;
$$;

drop policy if exists active_members_only on storage.objects;
create policy active_members_only on storage.objects
  as restrictive for all to authenticated
  using (
    bucket_id not in ('proposals', 'consultants')
    or (select public.is_active_user())
  )
  with check (
    bucket_id not in ('proposals', 'consultants')
    or (select public.is_active_user())
  );

-- A normal member may keep or release their own claim, but cannot transfer it
-- to an arbitrary colleague by issuing a direct UPDATE.
drop policy if exists rfp_claims_update on public.rfp_claims;
create policy rfp_claims_update on public.rfp_claims
  for update to authenticated
  using (claimed_by = (select auth.uid()) or (select public.is_admin()))
  with check (claimed_by = (select auth.uid()) or (select public.is_admin()));

-- Storage enforces these limits even when uploads bypass the browser checks.
update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip'
    ]
where id = 'proposals';

update storage.buckets
set file_size_limit = 15728640,
    allowed_mime_types = array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg', 'image/png', 'image/webp', 'image/gif'
    ]
where id = 'consultants';

notify pgrst, 'reload schema';
