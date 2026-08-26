-- The AI intelligence layer's own tables.
--
-- WHAT THIS IS FOR. A Python service (ai_tender_intelligence/) reads every
-- tender this console holds, scores it against the firm's capability statement,
-- learns from what was won and lost, and writes the result back here. The
-- console reads these rows through the client it already has. Nothing in the
-- browser talks to Python: the service writes to Postgres, the app reads from
-- Postgres, and a service that is down costs yesterday's analysis rather than
-- today's page.
--
-- WHY NEW TABLES RATHER THAN COLUMNS ON `rfps`. Three reasons, in order of how
-- much they cost when ignored:
--
-- 1. An analysis is versioned and a tender is not. The scoring model will
--    change -- that is the point of a learning system -- and a column would keep
--    only the newest answer, which makes "did the model get better?" a question
--    nobody can answer. A row per run keeps the history.
-- 2. `rfps` is written by people through the console and by the sync every
--    morning. Adding a machine writer to the same row invites the lost update
--    that happens when somebody edits a deadline while the analyser writes a
--    score.
-- 3. RLS. These inherit visibility from the tender rather than restating it,
--    so a share granted in 0039 reaches the analysis without a second policy
--    that would drift from the first.
--
-- NAMING. The spec that asked for this called them tender_id; the table in this
-- database is `rfps`, so the column is `rfp_id` and the foreign key is real. A
-- tender and an RFP are the same record here, and inventing a second name for
-- it in one corner of the schema is how you get two of everything.

-- ------------------------------------------------------------ ai_analysis ---
-- One reading of one tender by one version of the model.
create table if not exists public.ai_analysis (
  id                uuid primary key default gen_random_uuid(),
  rfp_id            uuid not null references public.rfps (id) on delete cascade,

  /** The AI Opportunity Summary, as shown on the tender's page. */
  summary           text not null default '',
  /** Capability match, 0-100. See capability_matcher.py. */
  score             integer not null default 0 check (score between 0 and 100),
  /** How much this looks like past wins, 0-100. See bid_learning_model.py. */
  win_probability   integer not null default 0 check (win_probability between 0 and 100),
  /** 'Pursue', 'Consider' or 'Decline' -- advice, never an action. */
  recommendation    text not null default '',

  /** Terms the engine found, ranked. */
  keywords          jsonb not null default '[]'::jsonb,
  /** Themes, as capability-statement labels rather than free text. */
  themes            jsonb not null default '[]'::jsonb,
  /** [{service, score, matched_terms}] -- which parts of the statement fit. */
  matched_capabilities jsonb not null default '[]'::jsonb,
  /** Requirements the engine could name from the tender's own words. */
  requirements      jsonb not null default '[]'::jsonb,
  /** What makes this hard to win or hard to deliver. */
  risks             jsonb not null default '[]'::jsonb,
  /** What the tender does not say and somebody must find out. */
  missing_information jsonb not null default '[]'::jsonb,
  /** Past tenders this most resembles: [{rfp_id, title, status, similarity}]. */
  similar_bids      jsonb not null default '[]'::jsonb,
  /** The sentences the engine will point at when asked why. */
  reasons           jsonb not null default '[]'::jsonb,

  /**
   * Which build of the model produced this.
   *
   * The reason a row is worth keeping rather than overwriting: a score is only
   * interpretable next to the thing that produced it, and "the score dropped"
   * is a different fact from "the model changed".
   */
  model_version     text not null default '',
  /** Where the analyser got its text: 'notice', 'tor' or 'notice+tor'. */
  source_kind       text not null default '',

  created_at        timestamptz not null default now()
);

-- Newest first, per tender: the console reads exactly one row per page.
create index if not exists ai_analysis_rfp_idx
  on public.ai_analysis (rfp_id, created_at desc);

comment on table public.ai_analysis is
  'One AI reading of one tender. Written by ai_tender_intelligence/, read by the console. Append-only: a new run inserts rather than updates, so a score stays interpretable next to the model version that produced it.';

-- ----------------------------------------------------------- bid_learning ---
-- What a finished bid taught the model.
--
-- Written when a tender reaches Won or Lost, which is the only moment this
-- database learns something it did not already assume. `outcome` repeats the
-- status on purpose: `rfps.status` moves on -- a lost bid can be re-run next
-- year under a new notice -- and a training row that silently relabels itself
-- is worse than no training row.
create table if not exists public.bid_learning (
  id                uuid primary key default gen_random_uuid(),
  rfp_id            uuid not null references public.rfps (id) on delete cascade,

  outcome           text not null check (outcome in ('Won', 'Lost', 'Submitted', 'Withdrawn')),
  /** {keywords, capabilities, donor, sector, country, value_band} as at decision time. */
  learned_patterns  jsonb not null default '{}'::jsonb,
  /** Free note from whoever recorded it -- why it went the way it did. */
  note              text not null default '',

  recorded_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),

  -- One lesson per tender per outcome. Re-running the learner must not stack up
  -- ten identical rows and give one tender ten votes in the model.
  unique (rfp_id, outcome)
);

create index if not exists bid_learning_outcome_idx
  on public.bid_learning (outcome, recorded_at desc);

comment on table public.bid_learning is
  'What a decided bid taught the model. One row per tender per outcome -- the unique constraint is what stops a re-run giving one tender ten votes.';

-- ---------------------------------------------------------- rfp_documents ---
-- The TOR and every other file that came with a tender.
--
-- Until now an uploaded tender PDF was read for its text and then dropped: the
-- extraction was kept on `rfps.tender_text` and the file itself was never
-- stored anywhere. That is fine right up to the first time somebody needs to
-- re-read page 14, send the annex to a partner, or check what the OCR got
-- wrong.
--
-- `file_path` points into the `tenders` bucket below and starts with the tender
-- owner's uid, because that is what the storage policies compare to auth.uid().
-- Same arrangement as proposals; see migration 0029 for why the folder names
-- the member rather than whoever uploaded on their behalf.
create table if not exists public.rfp_documents (
  id                uuid primary key default gen_random_uuid(),
  rfp_id            uuid not null references public.rfps (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,

  /** What to call it in the list -- the file's own name. */
  file_name         text not null default '',
  /** Object path, `<user_id>/<rfp_id>/<uuid>.<ext>`. */
  file_path         text not null default '',
  file_size         bigint,
  mime_type         text not null default '',
  /** 'tor', 'rfp', 'evaluation', 'annex' or 'other' -- what the file is. */
  kind              text not null default 'other',

  /** Layout-aware text, from the ingest function or from PyMuPDF. */
  extracted_text    text not null default '',
  /** What the AI layer made of it. Empty until the service has read it. */
  ai_summary        text not null default '',

  uploaded_date     date not null default current_date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists rfp_documents_rfp_idx
  on public.rfp_documents (rfp_id, created_at desc);

comment on table public.rfp_documents is
  'Files attached to a tender -- TOR, RFP, evaluation criteria, annexes. The file lives in the `tenders` bucket; this row holds its name, its extracted text and the AI summary of it.';

drop trigger if exists rfp_documents_touch_updated_at on public.rfp_documents;
create trigger rfp_documents_touch_updated_at
  before update on public.rfp_documents
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------- files ----
-- Private, like proposals: a tender's TOR is not always public, and the ones
-- that are lose nothing by being served through a signed URL.
insert into storage.buckets (id, name, public)
values ('tenders', 'tenders', false)
on conflict (id) do nothing;

-- ------------------------------------------------------------------ RLS -----
alter table public.ai_analysis   enable row level security;
alter table public.bid_learning  enable row level security;
alter table public.rfp_documents enable row level security;

/**
 * Visibility is inherited, not restated.
 *
 * `exists (select 1 from public.rfps ...)` is itself filtered by the policy on
 * `rfps`, so whoever can see a tender can see its analysis -- including through
 * the shares added in 0039 -- and a future widening of that policy reaches
 * these tables without a second copy of the rule to keep in step. The
 * alternative, repeating `user_id = auth.uid() or is_admin() or shared...` in
 * nine more places, is nine more places to forget.
 */
drop policy if exists ai_analysis_select on public.ai_analysis;
create policy ai_analysis_select on public.ai_analysis
  for select to authenticated
  using (exists (select 1 from public.rfps r where r.id = rfp_id));

drop policy if exists bid_learning_select on public.bid_learning;
create policy bid_learning_select on public.bid_learning
  for select to authenticated
  using (exists (select 1 from public.rfps r where r.id = rfp_id));

drop policy if exists rfp_documents_select on public.rfp_documents;
create policy rfp_documents_select on public.rfp_documents
  for select to authenticated
  using (exists (select 1 from public.rfps r where r.id = rfp_id));

/**
 * Writing.
 *
 * ai_analysis and bid_learning have no write policy at all, deliberately. They
 * are written by the Python service over a service-role connection, which
 * bypasses RLS; a browser has no business inserting a score it computed itself.
 * With RLS enabled and no permissive policy, every write from an authenticated
 * session is refused -- which is the intent stated in the only way Postgres
 * enforces.
 *
 * rfp_documents is different: a person uploads a TOR from the console, so the
 * owner and oversight may write, exactly as they may on the tender itself.
 */
drop policy if exists rfp_documents_insert on public.rfp_documents;
create policy rfp_documents_insert on public.rfp_documents
  for insert to authenticated
  with check (
    exists (
      select 1 from public.rfps r
      where r.id = rfp_id
        and (r.user_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

drop policy if exists rfp_documents_update on public.rfp_documents;
create policy rfp_documents_update on public.rfp_documents
  for update to authenticated
  using (
    exists (
      select 1 from public.rfps r
      where r.id = rfp_id
        and (r.user_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

drop policy if exists rfp_documents_delete on public.rfp_documents;
create policy rfp_documents_delete on public.rfp_documents
  for delete to authenticated
  using (
    exists (
      select 1 from public.rfps r
      where r.id = rfp_id
        and (r.user_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

-- -------------------------------------------------------- storage policies --
-- The first path segment is the tender owner's uid, and that is what these
-- compare. An admin attaching a TOR on a member's behalf files it under the
-- member, or it lands in a folder the member cannot open.
drop policy if exists tenders_read on storage.objects;
create policy tenders_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tenders'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );

drop policy if exists tenders_write on storage.objects;
create policy tenders_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tenders'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );

drop policy if exists tenders_delete on storage.objects;
create policy tenders_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tenders'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );

-- PostgREST caches the schema, so a new table is invisible to the browser
-- until it is told. Without this the console's queries return
-- "relation does not exist" against tables that plainly do, until something
-- else happens to restart the API.
notify pgrst, 'reload schema';
