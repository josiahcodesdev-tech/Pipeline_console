-- Somewhere to keep what the tender is actually about.
--
-- The drafter was writing twenty-three-section proposals from a 99-character
-- title. Measured on the live tracker: 1,218 tenders, not one with a tender
-- document attached, notes averaging eight characters. No amount of prompt
-- doctrine fixes that — the model was being asked to respond to a scope it had
-- never been shown, so it invented a plausible one.
--
-- Two columns, because they answer different questions and are refreshed at
-- different times.
--
-- `notice_text` is the source material: the published notice, fetched from its
-- own link and stripped to readable text. Distinct from `tender_text`, which is
-- the full ToR someone uploaded by hand — that one is authoritative and this
-- one is merely what the portal said, so a draft that has both should prefer
-- the upload and neither should overwrite the other.
--
-- `analysis` is the drafter's structured reading of the assignment: client,
-- objectives, scope, deliverables, evaluation criteria, mandatory requirements,
-- assignment type, ambiguities. It is kept rather than recomputed so it can be
-- read and corrected before a proposal is written against it, which is the
-- point — an understanding nobody can inspect is a guess with better manners.
--
-- Run after 0029.

alter table public.rfps
  add column if not exists notice_text text not null default '',
  add column if not exists analysis text not null default '',
  add column if not exists analysed_at timestamptz;

comment on column public.rfps.notice_text is
  'The published notice as fetched from `link` and reduced to readable text. Source material, not authoritative — an uploaded ToR in `tender_text` outranks it.';
comment on column public.rfps.analysis is
  'The drafter''s structured reading of the assignment, written before any proposal and kept so it can be checked and corrected. See migration 0030.';
comment on column public.rfps.analysed_at is
  'When the analysis was produced. A tender edited since then may have moved on from it.';

notify pgrst, 'reload schema';
