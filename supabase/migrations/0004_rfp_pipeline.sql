-- Marks the RFPs actually being bid on.
--
-- The RFP tracker holds everything the scraper finds, most of which is out of
-- scope. `in_pipeline` is the deliberate act of committing to one, which is a
-- different thing from `status`: a tender can sit at Watching for weeks while
-- you decide, and status alone cannot distinguish "not yet triaged" from
-- "triaged and declined".
--
-- Run in the Supabase SQL Editor after 0003. Safe to re-run.

alter table public.rfps
  add column if not exists in_pipeline boolean not null default false;

comment on column public.rfps.in_pipeline is
  'True once this RFP has been taken on as a live proposal.';

create index if not exists rfps_user_pipeline_idx
  on public.rfps (user_id, in_pipeline, deadline);

notify pgrst, 'reload schema';
