-- A freely-edited proposal is stored as an object and re-saved in place.
--
-- The `proposals` bucket has had insert, select and delete since 0007, which
-- was enough while every object was a file uploaded once and never touched
-- again. An edited draft is not that: it is the proposal's current text, and
-- saving it a second time is an upsert — a PUT over the same path.
--
-- Without an update policy the first save of an edit succeeds and every save
-- after it fails, which is the worst shape for this to take: the feature looks
-- like it works until somebody comes back to correct a sentence.
--
-- The predicate mirrors proposal_files_insert_own from 0029 exactly, including
-- the reason an admin's reach is bounded by `profiles` — the folder they write
-- into has to be a member's, or any path at all would pass. `using` and
-- `with check` are both required and both say the same thing: the first
-- decides which rows may be overwritten, the second what they may become, and
-- omitting the second would let a member move an object into someone else's
-- folder by renaming it.

drop policy if exists proposal_files_update_own on storage.objects;
create policy proposal_files_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'proposals'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (
        (select public.is_admin())
        and exists (
          select 1 from public.profiles p
           where p.id::text = (storage.foldername(name))[1]
        )
      )
    )
  )
  with check (
    bucket_id = 'proposals'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (
        (select public.is_admin())
        and exists (
          select 1 from public.profiles p
           where p.id::text = (storage.foldername(name))[1]
        )
      )
    )
  );

notify pgrst, 'reload schema';
