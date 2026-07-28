-- Teach the drafter what good looks like: written rules plus worked examples.
--
-- Not fine-tuning. Both of these are injected into the prompt at draft time,
-- which for this volume behaves the same and can be changed in seconds rather
-- than retrained.
--
-- Run in the Supabase SQL Editor after 0007. Safe to re-run.

-- One row per user. `on conflict (user_id)` is what the client upserts against.
create table if not exists public.user_settings (
  user_id             uuid primary key references auth.users (id) on delete cascade,

  /** House rules: structure, boilerplate, tone. Prepended to the system prompt. */
  proposal_guidance   text not null default '',
  /** Same, for the unsolicited concept notes sent to leads. */
  concept_guidance    text not null default '',
  /** Organisation background reused verbatim across both. */
  boilerplate         text not null default '',

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists user_settings_touch_updated_at on public.user_settings;
create trigger user_settings_touch_updated_at
  before update on public.user_settings
  for each row execute function public.touch_updated_at();

alter table public.user_settings enable row level security;

drop policy if exists user_settings_select_own on public.user_settings;
drop policy if exists user_settings_insert_own on public.user_settings;
drop policy if exists user_settings_update_own on public.user_settings;

create policy user_settings_select_own on public.user_settings
  for select to authenticated using (auth.uid() = user_id);
create policy user_settings_insert_own on public.user_settings
  for insert to authenticated with check (auth.uid() = user_id);
create policy user_settings_update_own on public.user_settings
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------ exemplars ----
-- A proposal marked as a model answer. Only ones with `content` can be used:
-- the drafter reads text, and an uploaded .docx is an opaque blob to it.
alter table public.proposals
  add column if not exists is_exemplar boolean not null default false;

comment on column public.proposals.is_exemplar is
  'Use this proposal as a worked example when drafting new ones.';

create index if not exists proposals_exemplar_idx
  on public.proposals (user_id, is_exemplar)
  where is_exemplar;

notify pgrst, 'reload schema';
