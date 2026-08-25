-- Sharing a tender with a colleague, and standing teams to share with.
--
-- Until now the only way to see somebody else's tender was to be oversight.
-- That is the right default — 0013 kept pipelines private on purpose — but it
-- leaves no room for the ordinary case of two people working one bid, and the
-- workaround people reach for instead is worse: hand the claim over, or paste
-- the notice into a second pipeline where it becomes a duplicate nobody
-- reconciles.
--
-- WHAT A SHARE IS, AND IS NOT
-- A share grants READ on one tender, to one member or one team. It never
-- grants write. That is a deliberate limit and the same one 0013 drew for
-- oversight: "a bid someone is mid-way through writing is theirs until they
-- hand it over." Co-editing is a bigger decision than co-reading and would
-- need to answer what happens when two people save the same field; this
-- feature does not pretend to have answered it. Every update, insert and
-- delete policy in the database is untouched by this migration.
--
-- WHY THE SHARE POINTS AT `rfps.id` AND NOT AT A CLAIM
-- `rfp_claims` is the firm-wide identity of a tender and was the obvious
-- candidate. It is the wrong one here for two reasons. Hand-added tenders have
-- no external id and therefore no claim, and they are exactly the rows most
-- worth sharing, being the ones a colleague cannot simply find in their own
-- copy of the feed. And a claim says who is bidding, not which rows to open:
-- resolving one back to a readable row means finding the claimant's copy,
-- which is the join this table stores directly.
--
-- WHY TEAMS AND PER-MEMBER SHARES BOTH EXIST
-- They answer different questions. A team is standing structure — the three
-- people who work health tenders — and survives the tender it was created for.
-- A per-member share is ad hoc: one colleague, one bid, this week. Forcing the
-- ad-hoc case through a team leaves behind a litter of two-person teams named
-- after tenders that closed months ago.
--
-- Run after 0038. Safe to re-run.

-- ------------------------------------------------------------------ teams ---

create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Case-insensitively unique. Two teams called "Health" and "health" is a
-- support ticket, not a distinction anyone meant to draw.
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

-- The lookup every read does: which teams am I in?
create index if not exists team_members_user_idx
  on public.team_members (user_id);

-- ----------------------------------------------------------------- shares ---

create table if not exists public.rfp_shares (
  id         uuid primary key default gen_random_uuid(),
  rfp_id     uuid not null references public.rfps (id) on delete cascade,
  /** Exactly one of these is set — see the check constraint. */
  user_id    uuid references auth.users (id) on delete cascade,
  team_id    uuid references public.teams (id) on delete cascade,
  shared_by  uuid not null references auth.users (id) on delete cascade,
  shared_at  timestamptz not null default now(),
  constraint rfp_shares_one_subject check (num_nonnulls(user_id, team_id) = 1)
);

-- Partial rather than a plain unique on (rfp_id, user_id, team_id): NULLs do
-- not compare equal in a unique index, so a composite one would happily admit
-- the same member twice.
create unique index if not exists rfp_shares_member_key
  on public.rfp_shares (rfp_id, user_id) where user_id is not null;
create unique index if not exists rfp_shares_team_key
  on public.rfp_shares (rfp_id, team_id) where team_id is not null;

create index if not exists rfp_shares_rfp_idx on public.rfp_shares (rfp_id);
create index if not exists rfp_shares_user_idx on public.rfp_shares (user_id);
create index if not exists rfp_shares_team_idx on public.rfp_shares (team_id);

-- ---------------------------------------------------------------- helpers ---

-- Every tender shared with me, directly or through a team I am in.
--
-- RETURNS AN ARRAY, AND THAT IS THE WHOLE POINT. The obvious shape for this is
-- `can_read_rfp(rfp_id) returns boolean`, which reads better and is the wrong
-- thing entirely: a function taking the row's own id cannot be hoisted out of
-- the row filter, so it runs once per row examined. That is precisely the
-- mistake 0019 was written to undo — it found `is_admin()` being called 478
-- times to read 478 RFPs. Returning the whole set instead lets the policy
-- unnest it in an uncorrelated subquery, which the planner runs once and
-- hashes. See the note on `rfps_select` for the form that does and does not
-- parse — the obvious spelling of this is a type error, not a slow query.
--
-- SECURITY DEFINER because the policy on `rfps` calls this, and this reads
-- `rfp_shares`, whose own policy reads `rfps` to find out who owns the row. As
-- a plain function that is a loop the planner refuses to run. As a definer
-- function it steps outside RLS and the loop never forms. It leaks nothing: it
-- returns only rows already keyed to the caller's own id.
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

-- Does the caller own this tender? Used by the share policies to answer "may
-- you give this away?" without reading `rfps` through its own policy.
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

-- ------------------------------------------------------------- team policy ---

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

drop policy if exists teams_select on public.teams;
drop policy if exists teams_write on public.teams;
drop policy if exists team_members_select on public.team_members;
drop policy if exists team_members_write on public.team_members;

-- Readable by everyone, for the same reason `profiles` is: you cannot pick a
-- team to share with from a list you are not allowed to see, and which teams
-- the firm has is not privileged information.
create policy teams_select on public.teams
  for select to authenticated using (true);

-- Managed by the super user alone, matching who may already add members and
-- set their access. A team is a standing grant of read across pipelines, which
-- is an access decision, and 0013 put those in exactly one pair of hands.
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

-- ------------------------------------------------------------ share policy ---

alter table public.rfp_shares enable row level security;

drop policy if exists rfp_shares_select on public.rfp_shares;
drop policy if exists rfp_shares_insert on public.rfp_shares;
drop policy if exists rfp_shares_delete on public.rfp_shares;

-- You can see a share if you granted it, if you own the tender it is on, if it
-- is pointed at you, or if you are oversight. Notably a team share is visible
-- to the whole team: "who else has this?" is a fair question for anyone who
-- can already read the tender.
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

-- Granting. The tender's owner or oversight, and nobody else — a member who
-- was shared a tender cannot pass it on further, which keeps the list of who
-- can see a bid answerable by the person who owns it.
--
-- `shared_by` is pinned to the caller so a share cannot be attributed to
-- somebody else, which would make the audit trail a fiction.
create policy rfp_shares_insert on public.rfp_shares
  for insert to authenticated
  with check (
    shared_by = (select auth.uid())
    and ((select public.is_admin()) or public.owns_rfp(rfp_id))
  );

create policy rfp_shares_delete on public.rfp_shares
  for delete to authenticated
  using ((select public.is_admin()) or public.owns_rfp(rfp_id));

-- --------------------------------------------------------------- the grant ---

-- The one policy this whole migration exists to widen. Same shape as 0019 left
-- it, with shared tenders added as a third way in; the admin check stays first
-- so the common case still short-circuits before reaching the subquery.
--
-- WHY `in (select unnest(...))` AND NOT `= any ((select ...))`.
-- The second is what this said first, and it does not parse. `ANY` has two
-- forms — one taking an array expression, one taking a subquery — and a bare
-- SELECT inside its parentheses is read as the subquery form, which expects a
-- set of uuid rows. `shared_rfp_ids()` returns a single uuid[], so Postgres
-- compares uuid to uuid[] and refuses: 42883, operator does not exist.
--
-- The `(select ...)` wrapper was there to force single evaluation, per 0019.
-- Unnesting into an uncorrelated subquery keeps that property by a different
-- route: nothing in it depends on the row, so the planner runs it once and
-- hashes the result rather than calling the function per row.
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
