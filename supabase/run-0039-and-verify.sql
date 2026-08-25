-- =============================================================================
-- PIPELINE CONSOLE — migration 0039 + verification. Run the whole file in ONE
-- SQL Editor tab. Safe to re-run: every statement is `if not exists` or
-- `drop ... if exists` first.
--
-- The editor shows only the LAST result set, so the checks are at the end and
-- folded into a single query.
--
-- Design notes for all of this live in
-- supabase/migrations/0039_teams_and_rfp_shares.sql — kept out of here so the
-- script stays readable in a browser tab.
-- =============================================================================


-- =============================================================================
-- 1. TABLES
-- =============================================================================

create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Case-insensitively unique: "Health" and "health" are not two teams.
create unique index if not exists teams_name_key
  on public.teams (lower(trim(name)));

drop trigger if exists teams_touch_updated_at on public.teams;
create trigger teams_touch_updated_at
  before update on public.teams
  for each row execute function public.touch_updated_at();

create table if not exists public.team_members (
  team_id   uuid not null references public.teams (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  added_by  uuid not null references auth.users (id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists team_members_user_idx
  on public.team_members (user_id);

-- A share grants READ on one tender to one member or one team. Never write.
create table if not exists public.rfp_shares (
  id         uuid primary key default gen_random_uuid(),
  rfp_id     uuid not null references public.rfps (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete cascade,
  team_id    uuid references public.teams (id) on delete cascade,
  shared_by  uuid not null references auth.users (id) on delete cascade,
  shared_at  timestamptz not null default now(),
  constraint rfp_shares_one_subject check (num_nonnulls(user_id, team_id) = 1)
);

-- Partial, not composite: NULLs never compare equal, so a composite unique
-- index would happily admit the same member twice.
create unique index if not exists rfp_shares_member_key
  on public.rfp_shares (rfp_id, user_id) where user_id is not null;
create unique index if not exists rfp_shares_team_key
  on public.rfp_shares (rfp_id, team_id) where team_id is not null;

create index if not exists rfp_shares_rfp_idx on public.rfp_shares (rfp_id);
create index if not exists rfp_shares_user_idx on public.rfp_shares (user_id);
create index if not exists rfp_shares_team_idx on public.rfp_shares (team_id);


-- =============================================================================
-- 2. HELPER FUNCTIONS
--
-- Both SECURITY DEFINER to break the policy recursion: the policy on `rfps`
-- calls these, and they read `rfp_shares`, whose own policy reads `rfps`.
-- =============================================================================

-- Returns an array so the policy can unnest it once per statement rather than
-- calling a function per row — the mistake 0019 exists to undo.
create or replace function public.shared_rfp_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct s.rfp_id), array[]::uuid[])
  from public.rfp_shares s
  where s.user_id = auth.uid()
     or s.team_id in (
       select tm.team_id from public.team_members tm where tm.user_id = auth.uid()
     );
$$;

create or replace function public.owns_rfp(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.rfps r where r.id = target and r.user_id = auth.uid()
  );
$$;


-- =============================================================================
-- 3. TEAM POLICIES — readable by all, managed by the super user
-- =============================================================================

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

drop policy if exists teams_select on public.teams;
drop policy if exists teams_write on public.teams;
drop policy if exists team_members_select on public.team_members;
drop policy if exists team_members_write on public.team_members;

create policy teams_select on public.teams
  for select to authenticated using (true);

create policy teams_write on public.teams
  for all to authenticated
  using ((select public.is_super_user()))
  with check ((select public.is_super_user()));

create policy team_members_select on public.team_members
  for select to authenticated using (true);

create policy team_members_write on public.team_members
  for all to authenticated
  using ((select public.is_super_user()))
  with check ((select public.is_super_user()));


-- =============================================================================
-- 4. SHARE POLICIES
--
-- Granting is the tender's owner or oversight only — someone who was shared a
-- tender cannot pass it on. `shared_by` is pinned to the caller so the audit
-- trail cannot be falsified.
-- =============================================================================

alter table public.rfp_shares enable row level security;

drop policy if exists rfp_shares_select on public.rfp_shares;
drop policy if exists rfp_shares_insert on public.rfp_shares;
drop policy if exists rfp_shares_delete on public.rfp_shares;

create policy rfp_shares_select on public.rfp_shares
  for select to authenticated
  using (
    (select public.is_admin())
    or shared_by = (select auth.uid())
    or user_id = (select auth.uid())
    or public.owns_rfp(rfp_id)
    or team_id in (
      select tm.team_id from public.team_members tm where tm.user_id = (select auth.uid())
    )
  );

create policy rfp_shares_insert on public.rfp_shares
  for insert to authenticated
  with check (
    shared_by = (select auth.uid())
    and ((select public.is_admin()) or public.owns_rfp(rfp_id))
  );

create policy rfp_shares_delete on public.rfp_shares
  for delete to authenticated
  using ((select public.is_admin()) or public.owns_rfp(rfp_id));


-- =============================================================================
-- 5. THE READ POLICY THIS ALL EXISTS FOR
--
-- `id in (select unnest(...))`, NOT `id = any ((select ...))`. The second is
-- what failed with 42883: ANY has an array form and a subquery form, and a bare
-- SELECT inside its parentheses is read as the subquery form, which expects a
-- set of uuid rows. The function returns one uuid[], so Postgres compared uuid
-- to uuid[] and refused.
--
-- IF AN EARLIER RUN FAILED HERE, THIS IS THE REPAIR. The drop below committed
-- while its replacement did not, leaving `rfps` with RLS on and no read policy
-- — every tender invisible to everyone.
-- =============================================================================

drop policy if exists rfps_select on public.rfps;
create policy rfps_select on public.rfps
  for select to authenticated
  using (
    (select public.is_admin())
    or user_id = (select auth.uid())
    or id in (select unnest(public.shared_rfp_ids()))
  );

comment on table public.teams is
  'Standing groups of members, used as the subject of a share. Managed by the super user.';
comment on table public.rfp_shares is
  'Read access to one tender, granted to one member or one team by its owner or by oversight. Never grants write.';


-- =============================================================================
-- 6. VERIFICATION — one result set. Every row should read 'ok'.
--
-- The row that matters most is  policy | rfps.rfps_select.
-- =============================================================================

with expected (name) as (
  values
    ('activities'), ('api_usage'), ('audit_log'), ('consultants'),
    ('impersonation_audit'), ('knowledge_chunks'), ('leads'), ('profiles'),
    ('proposals'), ('rfp_claims'), ('rfp_shares'), ('rfps'), ('tasks'),
    ('team_members'), ('teams'), ('user_settings'), ('weekly_reports')
),
present as (
  select table_name
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
),
required_policy (tablename, policyname) as (
  values
    ('rfps', 'rfps_select'), ('rfps', 'rfps_insert'),
    ('rfps', 'rfps_update'), ('rfps', 'rfps_delete'),
    ('teams', 'teams_select'), ('teams', 'teams_write'),
    ('team_members', 'team_members_select'), ('team_members', 'team_members_write'),
    ('rfp_shares', 'rfp_shares_select'), ('rfp_shares', 'rfp_shares_insert'),
    ('rfp_shares', 'rfp_shares_delete')
)
select 'table' as kind,
       e.name as object,
       case when p.table_name is null then 'MISSING' else 'ok' end as status
from expected e
left join present p on p.table_name = e.name

union all

select 'policy',
       r.tablename || '.' || r.policyname,
       case when pol.policyname is null then 'MISSING' else 'ok' end
from required_policy r
left join pg_policies pol
  on pol.schemaname = 'public'
 and pol.tablename  = r.tablename
 and pol.policyname = r.policyname

union all

select 'function',
       f.name,
       case when p.proname is null then 'MISSING' else 'ok' end
from (values ('shared_rfp_ids'), ('owns_rfp'), ('is_admin'), ('is_super_user')) as f(name)
left join pg_proc p
  on p.proname = f.name
 and p.pronamespace = 'public'::regnamespace

order by 1, 2;
