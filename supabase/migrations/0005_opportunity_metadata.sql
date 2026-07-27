-- Metadata the CareerCraft feed now returns and the console was discarding.
--
-- The feed's shape changed: `category` became `type`, and it gained a
-- `categories[]` service-area taxonomy plus a `kenya` locality flag. Without
-- somewhere to put them the console cannot tell a tender from a staff job —
-- which matters now that the sync pulls both, because ReliefWeb files
-- consultancy assignments under "job".
--
-- Run in the Supabase SQL Editor after 0004. Safe to re-run.

alter table public.rfps
  add column if not exists opportunity_type text not null default '';

alter table public.rfps
  add column if not exists kenya boolean not null default false;

-- Comma-separated rather than text[]: it is only ever displayed and substring
-- searched, and a scalar keeps the PostgREST types and the client mapper
-- simple.
alter table public.rfps
  add column if not exists service_areas text not null default '';

comment on column public.rfps.opportunity_type is
  'Feed `type`: "rfp", "job", or empty when the feed did not say.';
comment on column public.rfps.kenya is
  'Feed `kenya` flag — the opportunity is in or relevant to Kenya.';
comment on column public.rfps.service_areas is
  'Feed `categories[]`, comma-separated (VASOL service-area taxonomy).';

create index if not exists rfps_user_type_idx
  on public.rfps (user_id, opportunity_type);

notify pgrst, 'reload schema';
