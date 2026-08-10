-- The call report a visiting officer files after seeing a client.
--
-- Split across two tables, because the form's fields answer two different
-- questions and they change at different rates.
--
-- A client is visited more than once. Everything about the visit therefore
-- belongs to the visit — which this console already models, as an activity
-- tied to a lead. Putting the report on the lead instead would give each
-- client one report, silently overwritten by the next visit, and the second
-- report would quietly destroy the first.
--
-- What stays on the lead is what does not change between visits: where the
-- client is, and what business they are in. Six fields the form asks for are
-- not added anywhere, because the record already answers them: "Name of
-- client" is leads.org, "Phone of Contact Person" is leads.phone beside
-- leads.contact_name, and "Date of visit" is activities.occurred_on. A second
-- copy of any of them is how a report and a record start disagreeing about a
-- client's phone number.
--
-- Run after 0024. Safe to re-run.

-- ---------------------------------------------------------------- the client
alter table public.leads
  add column if not exists location text not null default '',
  add column if not exists nature_of_business text not null default '';

comment on column public.leads.location is
  'Physical location of the client — the call report wants the address, not the country.';
comment on column public.leads.nature_of_business is
  'What the client actually does, as distinct from `segment`, which is the category we file them under.';

-- ----------------------------------------------------------------- the visit
-- Nullable-by-default throughout: most activities are a phone call or an email
-- and will never carry a report, and a report that cannot be part-filled is a
-- report nobody starts.
alter table public.activities
  add column if not exists visiting_officers text not null default '',
  add column if not exists officials_met text not null default '',
  add column if not exists report_date date,
  add column if not exists meeting_purpose text not null default '',
  -- The four numbered sections of the form.
  add column if not exists business_background text not null default '',
  add column if not exists key_needs text not null default '',
  add column if not exists way_forward text not null default '',
  add column if not exists other_comments text not null default '';

comment on column public.activities.visiting_officers is
  'Vantage Africa staff who made the visit. Free text: a visit is often two people, and one of them is not always a console account.';
comment on column public.activities.officials_met is
  'Names and titles of the client officials met, one per line.';
comment on column public.activities.report_date is
  'When the report was written, as distinct from occurred_on — the gap between them is the thing management reads the pair for.';
comment on column public.activities.key_needs is
  'Section 2 of the form. Falls back to the lead''s `needs` when blank, so a first visit does not have to restate what qualification already established.';

-- Finding the visits that have a report on them, for the lead page and the
-- activity register. Partial, because the overwhelming majority of activities
-- are calls and emails that will never carry one.
create index if not exists activities_with_report
  on public.activities (lead_id, occurred_on desc)
  where report_date is not null;
