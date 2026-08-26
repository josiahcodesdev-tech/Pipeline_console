-- A proposal drafted into the firm's designed template, stored as its words.
--
-- WHAT CHANGED ABOVE THIS. Drafting used to produce Markdown, which the console
-- exported to Word. It now fills the designed HTML template in
-- proposal-templates/ — same stylesheet, same layout, same institutional
-- images, this tender's content. See src/documents/template-draft.ts.
--
-- WHY THIS IS NOT A COLUMN HOLDING THE HTML.
-- The house template is 3.6MB, nearly all of it base64 images that are identical
-- in every proposal ever written from it. Storing the filled document would put
-- that 3.6MB in a row per draft, and a tender with five attempts behind it would
-- carry eighteen megabytes of the same logo. It also fixes the design at the
-- moment of drafting: correct a colour in the template and every proposal
-- already written keeps the old one, invisibly, because what was saved was a
-- snapshot rather than a document.
--
-- So a draft stores the *answers* — roughly 350 short strings, about fifty
-- kilobytes — and the document is rebuilt from the current template whenever it
-- is opened. `content` keeps the readable text of the same proposal, which is
-- what the "show text" panel reads, what a starred model answer teaches the
-- drafter, and what survives if the template it was written into is ever
-- deleted.
--
-- Nullable by default rather than backfilled: every proposal written before this
-- is Markdown, and an empty `design` is exactly what says so.
alter table public.proposals
  add column if not exists design jsonb not null default '{}'::jsonb;

comment on column public.proposals.design is
  'Filled slot values for a proposal drafted into a designed template: {template, values, unfilled, failures}. Empty for Markdown drafts and for uploads.';
