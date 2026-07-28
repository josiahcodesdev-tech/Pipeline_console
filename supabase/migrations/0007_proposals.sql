-- Proposal history against an RFP.
--
-- Two kinds share one table because they answer the same question — "what have
-- we written for this tender?" — and belong on one timeline:
--   * `draft`     — AI-generated text, kept so a draft survives closing the tab
--   * `submitted` — the actual file that went to the buyer, uploaded for the record
--
-- Run in the Supabase SQL Editor after 0006. Safe to re-run.

create table if not exists public.proposals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  rfp_id      uuid not null references public.rfps (id) on delete cascade,

  kind        text not null default 'draft'
                check (kind in ('draft', 'submitted')),
  title       text not null default '',
  /** Draft body. Empty for uploads, where the file is the content. */
  content     text not null default '',
  /** Storage object path, `<user_id>/<rfp_id>/<uuid>.<ext>`. Empty for drafts. */
  file_path   text not null default '',
  file_name   text not null default '',
  file_size   bigint,
  notes       text not null default '',

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists proposals_rfp_idx
  on public.proposals (rfp_id, created_at desc);
create index if not exists proposals_user_idx
  on public.proposals (user_id, created_at desc);

drop trigger if exists proposals_touch_updated_at on public.proposals;
create trigger proposals_touch_updated_at
  before update on public.proposals
  for each row execute function public.touch_updated_at();

alter table public.proposals enable row level security;

drop policy if exists proposals_select_own on public.proposals;
drop policy if exists proposals_insert_own on public.proposals;
drop policy if exists proposals_update_own on public.proposals;
drop policy if exists proposals_delete_own on public.proposals;

create policy proposals_select_own on public.proposals
  for select to authenticated using (auth.uid() = user_id);
create policy proposals_insert_own on public.proposals
  for insert to authenticated with check (auth.uid() = user_id);
create policy proposals_update_own on public.proposals
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy proposals_delete_own on public.proposals
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------- files -----
-- Private bucket: submitted proposals are commercially sensitive, so objects
-- are reachable only through short-lived signed URLs, never a public path.
insert into storage.buckets (id, name, public)
values ('proposals', 'proposals', false)
on conflict (id) do nothing;

-- Every object is filed under the owner's uid as the first path segment, and
-- the policies compare that segment to auth.uid() — so one user cannot read or
-- overwrite another's uploads even knowing the path.
drop policy if exists proposal_files_select_own on storage.objects;
drop policy if exists proposal_files_insert_own on storage.objects;
drop policy if exists proposal_files_delete_own on storage.objects;

create policy proposal_files_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'proposals' and (storage.foldername(name))[1] = auth.uid()::text);

create policy proposal_files_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'proposals' and (storage.foldername(name))[1] = auth.uid()::text);

create policy proposal_files_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'proposals' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';
