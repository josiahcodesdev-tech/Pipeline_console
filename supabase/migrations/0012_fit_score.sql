-- How well an opportunity fits what Vantage Africa actually delivers, 0-100.
--
-- The capability filter added in the sync already answers "can we bid this at
-- all?", so every row in the tracker is biddable. This answers the next
-- question — which of them first — because a week's worth arriving as an
-- undifferentiated list still leaves the triage to be done by hand.
--
-- Computed at sync time in the Edge Function rather than in a view, because it
-- reads the notice text the row was built from, which is not all kept. See
-- scoreFit in supabase/functions/sync-opportunities/normalize.ts.
--
-- Rows synced before this migration keep 0 and sort last under "Best fit".
-- Backfilling would mean re-scoring from titles alone, which is what the
-- ranking already does for new rows — so a re-sync is the honest fix if the
-- old rows matter.
--
-- Run in the Supabase SQL Editor after 0011. Safe to re-run.

alter table public.rfps
  add column if not exists fit_score integer not null default 0;

create index if not exists rfps_user_fit_score_idx
  on public.rfps (user_id, fit_score desc);

comment on column public.rfps.fit_score is
  'Capability fit, 0-100, summed from weighted capability matches at sync time. Ranking heuristic, not a probability of winning.';
