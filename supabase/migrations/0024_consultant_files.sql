-- A photo and a CV for each consultant.
--
-- The roster already carries what a proposal's team-composition table needs in
-- structured form. What it could not carry is the two things a bid actually has
-- to attach: the CV itself, which almost every tender demands as an annex, and
-- a photo for the profiles a buyer sees.
--
-- Files go to storage rather than into the row. A CV is a megabyte of PDF that
-- nothing queries and everything would carry — the roster is loaded on every
-- draft, and pulling five CVs into memory to render a list of names would cost
-- more than the whole rest of the snapshot.
--
-- Paths are `{owner uid}/{consultant id}/{kind}.{ext}`. The leading uid is not
-- decoration: the storage policies compare that first segment to auth.uid(),
-- so the shape is what makes a file private rather than a convention.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

alter table public.consultants
  add column if not exists photo_path   text not null default '',
  add column if not exists cv_path      text not null default '',
  add column if not exists cv_file_name text not null default '',
  add column if not exists cv_size      bigint;

comment on column public.consultants.cv_path is
  'Storage object path in the consultants bucket. The CV a tender asks for as an annex.';

-- ---------------------------------------------------------------- storage ---

insert into storage.buckets (id, name, public)
values ('consultants', 'consultants', false)
on conflict (id) do nothing;

drop policy if exists consultant_files_select_own on storage.objects;
drop policy if exists consultant_files_insert_own on storage.objects;
drop policy if exists consultant_files_update_own on storage.objects;
drop policy if exists consultant_files_delete_own on storage.objects;

-- The roster is per-account, so the files are too. An admin reading across the
-- firm sees other members' consultant *rows* but not their files; a CV is a
-- named individual's personal document, and widening that is a decision about
-- someone who is not in this system to make it.
create policy consultant_files_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'consultants'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy consultant_files_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'consultants'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Replacing a photo overwrites in place, which is an update rather than an
-- insert; without this, changing a photo fails while adding one works.
create policy consultant_files_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'consultants'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy consultant_files_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'consultants'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
