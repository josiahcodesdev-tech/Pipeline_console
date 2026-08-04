-- The tender document behind an opportunity, as text.
--
-- Until now the drafter worked from the notice alone — a title, a deadline and
-- whatever notes were typed in. Its own doctrine says so outright: "You have
-- the published notice only — not the full RFP document, evaluation matrix,
-- company profile, CVs or reference letters." That is the single biggest limit
-- on draft quality, because the scope, the evaluation criteria and the
-- mandatory requirements all live in the attached PDF.
--
-- Stored as text rather than as a file. The drafter can only read text, and the
-- extraction happens in the browser with pdf.js, so there is nothing to gain
-- from keeping the binary as well — `proposals` already exists for attachments
-- that are genuinely worth storing whole.
--
-- Run in the Supabase SQL Editor after 0010. Safe to re-run.

alter table public.rfps
  add column if not exists tender_text text not null default '';

alter table public.rfps
  add column if not exists tender_file_name text not null default '';

comment on column public.rfps.tender_text is
  'Text extracted from the tender PDF in the browser. Sent to the drafter so it works from the real scope rather than the notice alone.';
comment on column public.rfps.tender_file_name is
  'Original filename, so it is obvious which document the text came from.';
