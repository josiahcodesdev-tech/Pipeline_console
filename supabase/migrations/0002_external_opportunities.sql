-- Track where a synced RFP came from, so re-running the CareerCraft sync
-- updates rather than duplicates.
--
-- Run this in the Supabase SQL Editor after 0001_init.sql.

alter table public.rfps
  add column if not exists external_id text;

-- Postgres treats NULLs as distinct in a unique index, so manually-added RFPs
-- (external_id null) never collide with each other — only synced rows are
-- constrained. Named so PostgREST can target it as an upsert conflict key.
create unique index if not exists rfps_user_external_id_key
  on public.rfps (user_id, external_id);

comment on column public.rfps.external_id is
  'Opportunity id from the CareerCraft public feed; null for manual entries.';
