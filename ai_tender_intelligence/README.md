# Tender intelligence

A Python service that reads every tender the console holds, scores it against
the Vantage Africa capability statement, learns from bids already decided, and
writes what it concludes back to the same Postgres database the console reads.

It **adds to** the existing system. Nothing here replaces the sync, the tender
reader, the drafter or the fit score; those keep working exactly as they did
with this service switched off.

## How it fits

```
   sync-opportunities (Deno)          the console (React)
            │                                  │
            ▼                                  ▼
        ┌────────────────── Supabase Postgres ──────────────────┐
        │  rfps · proposals · consultants · rfp_documents       │
        │  ai_analysis · bid_learning                           │
        └───────────────────────────────────────────────────────┘
                             ▲
                             │  SQLAlchemy, service-role
                  ai_tender_intelligence (Python)
```

**The browser never talks to Python.** The service writes analyses to Postgres;
the console reads them with the Supabase client it already has. That is the
whole integration, and it is deliberate:

- A page load never waits on this process, and never fails because it is down.
  The worst a stopped service costs is yesterday's analysis instead of today's.
- No CORS, no second auth path, no service-role key in a browser.
- The console can be deployed, rolled back and developed without this running.

## What it writes, and what it must never touch

| Table | Written by | Why |
|---|---|---|
| `ai_analysis` | this service only | One row per reading. Append-only. |
| `bid_learning` | this service only | One row per tender per outcome. |
| `rfp_documents.extracted_text`, `.ai_summary` | this service | The rest of the row is the console's. |
| everything else | the console | — |

`rfps` in particular is written by people through the console *and* by the
05:00 sync. A third writer on those rows is how a deadline somebody typed gets
overwritten by a machine, so this service does not have one. `ai_analysis` and
`bid_learning` have no write policy for authenticated users at all — the same
rule stated from the other side, in the only place Postgres enforces it.

## Install

Python 3.12.

```bash
cd ai_tender_intelligence
python -m venv .venv && . .venv/Scripts/activate     # Windows
# python -m venv .venv && source .venv/bin/activate  # macOS / Linux
pip install -r requirements.txt

# Optional, and worth it — better entity extraction:
python -m spacy download en_core_web_sm

cp .env.example .env      # then fill it in
```

Apply the migration first, or nothing has anywhere to write:

```bash
psql "$AI_DATABASE_URL" -f ../supabase/migrations/0041_ai_intelligence.sql
```

### The two heavy dependencies are genuinely optional

`spacy` needs a model downloaded separately; `sentence-transformers` pulls
~90MB on first use. Both improve the analysis and **neither is required**. With
them missing, the deterministic layer — phrase lists, section headings, date
patterns — carries the whole extraction, and `GET /health` reports which are
present. A service that will not start without a download is a service nobody
runs.

## Run

```bash
# One pass over everything that needs it, then exit. Start here.
python -m ai_tender_intelligence.scheduler --once --verbose

# Teach the model from bids already marked Won or Lost.
python -m ai_tender_intelligence.scheduler --backfill

# One tender, by id.
python -m ai_tender_intelligence.scheduler --rfp <uuid>

# The loop: every 15 minutes, forever.
python -m ai_tender_intelligence.scheduler

# The HTTP service.
uvicorn ai_tender_intelligence.api:app --port 8099
```

### Endpoints

| | |
|---|---|
| `GET /health` | Unauthenticated. Database reachable? Which optional models loaded? |
| `POST /analyse-tender` | `{"tender_id": "<uuid>"}` → the full reading. Stores it too. |
| `POST /extract-rfp-document` | A PDF upload → text, summary, requirements. Stores nothing. |
| `POST /run` | One scheduler pass on demand. |
| `POST /record-lessons` | Backfill the learning model. |

Every route but `/health` needs `Authorization: Bearer $AI_API_TOKEN`. Without
`AI_API_TOKEN` set, they all return 503 — this process holds a service-role
database connection, and an unauthenticated one of those on a public port is
the whole database.

## Why polling and not webhooks

The triggers this must respond to — a tender imported, a TOR uploaded, a bid
marked Won, a proposal submitted — are all database state changes, and the
database is the only thing that sees all four. A webhook from the console would
miss the 05:00 sync. One query for "tenders whose analysis is older than the
tender" catches all of them, and does nothing when there is nothing to do.

It is idempotent by construction: a tender is returned only when it has no
analysis, or one older than its last edit, or one from a different
`MODEL_VERSION`. Running twice analyses nothing the second time. Bumping
`MODEL_VERSION` re-analyses everything, which is what a model change should do.

## The capability profile

`capability_profile.json` — services, weights, and the phrases that signal
each. Generated once from the map already scoring every synced notice in
`sync-opportunities/normalize.ts`, so the two agree on day one. **Edit it
freely from there.** Adding a term is a text change anybody can review, which
is the point: a capability statement changes, and a scoring model that needs a
developer to follow it will not.

After editing, re-score everything:

```bash
python -m ai_tender_intelligence.scheduler --once
```

## What it will not do

**It does not invent facts.** Every extractor returns `None` or `[]` rather
than a plausible value. An unstated budget is unstated; an unstated duration is
unstated; a "three months" is never quietly turned into 90 days. Absences are
reported through `missing_information` so they are shown rather than skipped —
a placeholder somebody has to resolve beats a confident number nobody can
source.

**It does not write prose.** The summary is assembled from the tender's own
words and the scores computed from them. No language model. This paragraph sits
at the top of a bid decision, and a fluent sentence that smoothed over a
missing budget would be worse than the blunt one that names it.

**It does not pretend to predict.** This firm has tens of decided bids, not
thousands — not enough to train a classifier that generalises. The model is
nearest-neighbour with an explicit cold-start floor: under `MIN_HISTORY`
decided bids it reports *insufficient history* rather than a percentage, and
above it every probability carries a `confidence`. A 78% win probability drawn
from two similar bids is a coin toss with a decimal point on it, and saying so
is the only honest output.

**It does not move anything.** No status changes, no auto-declines. The
recommendation is advice on a page, and the decision stays with the bid team.
