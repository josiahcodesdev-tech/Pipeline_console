# Tender intelligence pipeline

## Deployment

1. Apply `supabase/migrations/0031_tender_intelligence.sql`.
2. Set `OPENAI_API_KEY` as a Supabase secret.
3. Deploy `tender-intelligence` and redeploy `concept-note`.

```powershell
npx supabase db push
npx supabase secrets set OPENAI_API_KEY=KEY
npx supabase functions deploy tender-intelligence
npx supabase functions deploy concept-note
```

## Processing flow

- Upload sends the PDF to the authenticated Edge Function. OpenAI
  `gpt-4.1-mini` returns a layout-aware Markdown transcription with headings,
  clauses, tables and page markers. Stored ingestion provenance identifies the
  model and processing path.
- Read indexes verified company facts, methodologies, model proposals and
  consultant profiles, retrieves semantically relevant chunks, and passes those
  alongside the tender to a strict JSON-schema extraction call.
- Structured metadata, deliverables, evaluation criteria, RTM rows and gap
  analysis are stored in `rfps.analysis_json`; the readable representation stays
  in `rfps.analysis` for proposal drafting and review.
- Enrich searches the procurement identifier, an exact tender phrase and the
  client context through OpenAI web search. Results, provider and source URLs
  are retained in `rfps.enrichment`.
- Proposal drafting retrieves evidence again and includes only the matched
  internal context. Missing evidence remains an explicit gap.

All intelligence and vector rows are owner-scoped by row-level security.
Uploaded PDF contents and enrichment queries are sent to OpenAI, enabled by
explicit authorization on 15 August 2026.
