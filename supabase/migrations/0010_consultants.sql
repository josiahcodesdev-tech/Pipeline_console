-- The people a proposal is staffed with.
--
-- The drafter used to write team composition entirely in placeholders — the
-- doctrine tells it to list a role as one to confirm whenever the specialist
-- has not been supplied. This is where they get supplied from: at draft time
-- the roster is sent alongside the notice, and the model builds the team
-- section from real people with real qualifications instead.
--
-- Free text rather than lookup tables for expertise, sectors and countries.
-- These are read by a language model, not joined against — "Monitoring &
-- Evaluation, Youth Leadership" is exactly as useful to it as three foreign
-- keys would be, and a roster of this size does not need the ceremony. The
-- same reasoning already applies to rfps.service_areas.
--
-- Run in the Supabase SQL Editor after 0009. Safe to re-run.

create table if not exists public.consultants (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,

  name              text not null check (length(trim(name)) > 0),
  title             text not null default '',
  /** Comma-separated tags, e.g. "Monitoring & Evaluation, Grant Writing". */
  core_expertise    text not null default '',
  years_experience  integer,
  sectors           text not null default '',
  countries         text not null default '',

  qualifications    text not null default '',
  /**
   * The kinds of RFP component this person should be matched to. Carries more
   * weight than the bios when the drafter is choosing who to put forward,
   * because it is written in the language of the work rather than the person.
   */
  task_fit          text not null default '',
  project_experience text not null default '',
  languages         text not null default '',
  availability      text not null default '',

  /** ~50 words, ready to drop into a team-composition table. */
  short_bio         text not null default '',
  /** ~150 words, for a CV annex or a detailed technical proposal. */
  long_bio          text not null default '',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists consultants_user_name_idx
  on public.consultants (user_id, name);

drop trigger if exists consultants_touch_updated_at on public.consultants;
create trigger consultants_touch_updated_at
  before update on public.consultants
  for each row execute function public.touch_updated_at();

alter table public.consultants enable row level security;

drop policy if exists consultants_select_own on public.consultants;
drop policy if exists consultants_insert_own on public.consultants;
drop policy if exists consultants_update_own on public.consultants;
drop policy if exists consultants_delete_own on public.consultants;

create policy consultants_select_own on public.consultants
  for select to authenticated using (auth.uid() = user_id);
create policy consultants_insert_own on public.consultants
  for insert to authenticated with check (auth.uid() = user_id);
create policy consultants_update_own on public.consultants
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy consultants_delete_own on public.consultants
  for delete to authenticated using (auth.uid() = user_id);

comment on column public.consultants.task_fit is
  'RFP components this consultant should be matched to. Ranked on when the drafter picks a team.';
