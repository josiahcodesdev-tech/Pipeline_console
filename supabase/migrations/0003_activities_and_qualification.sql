-- Activity log + lead qualification fields.
--
-- Closes the gaps between the console and the BDE job description:
--   * "Communication log" is the daily evidence for the Client communication
--     KPI, and outreach (calls, emails, LinkedIn, meeting requests) is a listed
--     responsibility. Tasks record what you intend to do; this records what you
--     actually did.
--   * Qualification requires assessing "need, timing, decision process, budget
--     potential and fit before handover", and databases segmented by priority.
--
-- Run in the Supabase SQL Editor after 0002. Safe to re-run.

-- ----------------------------------------------------------- activities -----
create table if not exists public.activities (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,

  -- An entry may hang off a lead, an RFP, or neither (general market
  -- intelligence). Deleting the parent takes its log with it.
  lead_id      uuid references public.leads (id) on delete cascade,
  rfp_id       uuid references public.rfps (id) on delete cascade,

  type         text not null default 'Call'
                 check (type in ('Call', 'Email', 'LinkedIn', 'Meeting request',
                                 'Meeting held', 'Proposal sent', 'Demo',
                                 'Registration', 'Note')),
  occurred_on  date not null default current_date,
  summary      text not null check (length(trim(summary)) > 0),
  outcome      text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists activities_user_date_idx
  on public.activities (user_id, occurred_on desc);
create index if not exists activities_lead_idx
  on public.activities (lead_id, occurred_on desc);
create index if not exists activities_rfp_idx
  on public.activities (rfp_id, occurred_on desc);

-- ------------------------------------------------ lead qualification --------
alter table public.leads
  add column if not exists priority text not null default 'Medium'
    check (priority in ('High', 'Medium', 'Low'));

alter table public.leads
  add column if not exists needs text not null default '';

alter table public.leads
  add column if not exists budget_band text not null default '';

alter table public.leads
  add column if not exists decision_timeline text not null default '';

alter table public.leads
  add column if not exists decision_process text not null default '';

comment on column public.leads.needs is
  'What the institution needs — the "need" half of qualification.';
comment on column public.leads.budget_band is
  'Indicative budget potential, free text (e.g. "KES 2-5M", "unfunded").';
comment on column public.leads.decision_timeline is
  'Timing / training calendar — when they buy, not when you called.';
comment on column public.leads.decision_process is
  'Who signs off and how, so handover notes are not guesswork.';

create index if not exists leads_user_priority_idx
  on public.leads (user_id, priority);

-- --------------------------------------------- monthly/quarterly reports ---
-- The job description has monthly deliverables and a quarterly strategy
-- review, not just the weekly portfolio report. `week_start` becomes the start
-- of whatever period the row covers, and `period` says which — without it a
-- month beginning on a Monday would collide with that week's report.
alter table public.weekly_reports
  add column if not exists period text not null default 'week'
    check (period in ('week', 'month', 'quarter'));

alter table public.weekly_reports
  drop constraint if exists weekly_reports_user_id_week_start_key;

create unique index if not exists weekly_reports_user_period_start_key
  on public.weekly_reports (user_id, period, week_start);

comment on column public.weekly_reports.week_start is
  'First day of the period this row covers; read together with `period`.';

-- ------------------------------------------------------------ updated_at ----
drop trigger if exists activities_touch_updated_at on public.activities;
create trigger activities_touch_updated_at
  before update on public.activities
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------ RLS -----
alter table public.activities enable row level security;

drop policy if exists activities_select_own on public.activities;
drop policy if exists activities_insert_own on public.activities;
drop policy if exists activities_update_own on public.activities;
drop policy if exists activities_delete_own on public.activities;

create policy activities_select_own on public.activities
  for select to authenticated using (auth.uid() = user_id);
create policy activities_insert_own on public.activities
  for insert to authenticated with check (auth.uid() = user_id);
create policy activities_update_own on public.activities
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy activities_delete_own on public.activities
  for delete to authenticated using (auth.uid() = user_id);

notify pgrst, 'reload schema';
