-- One tender, one bidder.
--
-- Every member has their own copy of each scraped opportunity — that is what
-- the per-user sync produces, and it is why two people could take the same
-- tender into their pipeline without either knowing. Two bids from the same
-- firm on one tender is worse than no bid: it splits the effort, confuses the
-- buyer, and usually disqualifies both.
--
-- The claim is kept in its own table rather than as a flag on the rows,
-- because the rows are per-member and a flag on one copy says nothing about
-- the other seven. Here there is exactly one row per tender across the whole
-- firm, and the primary key does the enforcing: a second claim is not a race
-- to be resolved but a duplicate key, refused by the database.
--
-- Keyed on `external_id` — the source's own id for the notice ("worldbank:
-- OP00456106") — which is the only identifier every member's copy shares.
-- Hand-added RFPs have no external id and need no claim: nobody else can see
-- them to take them.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

create table if not exists public.rfp_claims (
  /** The source's id for the notice. One row per tender, firm-wide. */
  external_id text primary key,
  claimed_by  uuid not null references auth.users (id) on delete cascade,
  claimed_at  timestamptz not null default now(),
  /**
   * Copied rather than joined. A member sees every claim, including ones on
   * tenders their own sync has not pulled yet, and a join to a row they cannot
   * read would show them a blank line instead of a title.
   */
  title       text not null default ''
);

create index if not exists rfp_claims_claimed_by_idx
  on public.rfp_claims (claimed_by);

alter table public.rfp_claims enable row level security;

drop policy if exists rfp_claims_select on public.rfp_claims;
drop policy if exists rfp_claims_insert on public.rfp_claims;
drop policy if exists rfp_claims_delete on public.rfp_claims;

-- Everyone sees every claim. That is the entire point: a tender you cannot
-- take should say who has it, not simply refuse.
create policy rfp_claims_select on public.rfp_claims
  for select to authenticated using (true);

-- You may only claim in your own name. Taking a tender "for" someone else is
-- not a thing this supports.
create policy rfp_claims_insert on public.rfp_claims
  for insert to authenticated with check (claimed_by = auth.uid());

-- Release your own; an admin can release anyone's, which is what happens when
-- someone leaves mid-bid or drops one they had taken.
create policy rfp_claims_delete on public.rfp_claims
  for delete to authenticated
  using (claimed_by = auth.uid() or public.is_admin());

-- Seed from the tenders already taken on. Without this, eight RFPs that are
-- being actively worked would show as available the moment this ships, and
-- someone would take one out from under its owner.
insert into public.rfp_claims (external_id, claimed_by, claimed_at, title)
select distinct on (r.external_id)
  r.external_id, r.user_id, coalesce(r.created_at, now()), r.title
from public.rfps r
where r.in_pipeline and r.external_id is not null
order by r.external_id, r.created_at
on conflict (external_id) do nothing;

comment on table public.rfp_claims is
  'One row per scraped tender, firm-wide. The primary key is what stops two members bidding the same opportunity.';
