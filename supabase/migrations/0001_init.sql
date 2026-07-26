-- Pipeline Console — initial schema
--
-- Every row is owned by the authenticated user that created it and is only ever
-- visible to them. Date-only columns (`*_on`, `due`, `deadline`, `week_start`)
-- are written by the client from its *local* calendar date so that weekly
-- reporting lines up with the user's working week rather than UTC.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- leads -----
create table if not exists public.leads (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  org               text not null check (length(trim(org)) > 0),
  segment           text not null default 'Government',
  country           text not null default '',
  contact_name      text not null default '',
  contact_role      text not null default '',
  email             text not null default '',
  phone             text not null default '',
  status            text not null default 'New'
                      check (status in ('New', 'Contacted', 'Qualified',
                                        'Handed Over', 'Won', 'Lost')),
  next_action_date  date,
  source            text not null default '',
  notes             text not null default '',
  created_on        date not null default current_date,
  status_updated_on date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists leads_user_created_idx
  on public.leads (user_id, created_at desc);
create index if not exists leads_user_status_idx
  on public.leads (user_id, status);

-- ----------------------------------------------------------------- rfps -----
create table if not exists public.rfps (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  title             text not null check (length(trim(title)) > 0),
  org               text not null default '',
  segment           text not null default 'Government',
  deadline          date,
  value             numeric(14, 2),
  status            text not null default 'Watching'
                      check (status in ('Watching', 'Preparing', 'Submitted',
                                        'Won', 'Lost')),
  link              text not null default '',
  notes             text not null default '',
  source            text not null default 'Manual',
  sourced           boolean not null default false,
  created_on        date not null default current_date,
  status_updated_on date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists rfps_user_deadline_idx
  on public.rfps (user_id, deadline);

-- ---------------------------------------------------------------- tasks -----
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  text         text not null check (length(trim(text)) > 0),
  due          date,
  priority     text not null default 'Normal' check (priority in ('Normal', 'High')),
  linked_lead  uuid references public.leads (id) on delete set null,
  done         boolean not null default false,
  completed_on date,
  created_on   date not null default current_date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists tasks_user_due_idx
  on public.tasks (user_id, done, due);

-- ------------------------------------------------------- weekly_reports -----
create table if not exists public.weekly_reports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  revenue    numeric(14, 2),
  notes      text not null default '',
  submitted  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One report per user per week; the client upserts on this constraint.
  unique (user_id, week_start)
);

create index if not exists weekly_reports_user_week_idx
  on public.weekly_reports (user_id, week_start desc);

-- ------------------------------------------------------------ updated_at ----
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['leads', 'rfps', 'tasks', 'weekly_reports'] loop
    execute format(
      'drop trigger if exists %I_touch_updated_at on public.%I', t, t);
    execute format(
      'create trigger %I_touch_updated_at before update on public.%I
         for each row execute function public.touch_updated_at()', t, t);
  end loop;
end;
$$;

-- ------------------------------------------------------------------ RLS -----
alter table public.leads           enable row level security;
alter table public.rfps            enable row level security;
alter table public.tasks           enable row level security;
alter table public.weekly_reports  enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['leads', 'rfps', 'tasks', 'weekly_reports'] loop
    execute format('drop policy if exists %I_select_own on public.%I', t, t);
    execute format('drop policy if exists %I_insert_own on public.%I', t, t);
    execute format('drop policy if exists %I_update_own on public.%I', t, t);
    execute format('drop policy if exists %I_delete_own on public.%I', t, t);

    execute format(
      'create policy %I_select_own on public.%I
         for select to authenticated using (auth.uid() = user_id)', t, t);
    execute format(
      'create policy %I_insert_own on public.%I
         for insert to authenticated with check (auth.uid() = user_id)', t, t);
    execute format(
      'create policy %I_update_own on public.%I
         for update to authenticated
         using (auth.uid() = user_id) with check (auth.uid() = user_id)', t, t);
    execute format(
      'create policy %I_delete_own on public.%I
         for delete to authenticated using (auth.uid() = user_id)', t, t);
  end loop;
end;
$$;
