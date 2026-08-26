# Vantage Africa

Lead generation and RFP tracking for the Corporate Department BDE function at
Vantage Africa School of Leadership.

Six views — Dashboard, Leads, RFPs, Progress, Tasks, Weekly report — over four
tables in Supabase, with a Word export for the weekly report and an AI concept-note
drafter.

**Stack:** Vite · React 19 · TypeScript · Tailwind v4 · shadcn/ui (`base-nova`, on
Base UI) · Supabase (Postgres + Auth) · Recharts · `docx`.

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Create the database

In your Supabase project, open the **SQL Editor** and run the migrations in
order:

1. [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) —
   creates `leads`, `rfps`, `tasks`, and `weekly_reports`, enables row-level
   security on all four, and adds policies so **each user can only ever read or
   write their own rows**.
2. [`supabase/migrations/0002_external_opportunities.sql`](supabase/migrations/0002_external_opportunities.sql)
   — adds `rfps.external_id` plus a unique index, which is what makes the
   CareerCraft sync idempotent.

Both are safe to re-run.

### 3. Point the app at the project

```bash
cp .env.example .env.local
```

Fill in from **Project Settings → API**:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Both are safe to ship in a browser bundle — RLS is what protects the data, not the
anon key. If these are missing the app shows setup instructions instead of a login
form.

### 4. Run

```bash
npm run dev
```

Create an account on first load. If your Supabase project has email confirmation
enabled (**Authentication → Providers → Email**), confirm before signing in — or
turn it off for a single-user internal tool.

---

## AI drafting (optional)

Two buttons, one Edge Function:

- **Leads → "Draft concept note"** — unsolicited outreach, 350–450 words, has to
  argue its own relevance.
- **RFPs → "Draft proposal"** — a response to a published brief, 500–700 words,
  structured for an evaluation panel: understanding of the requirement, approach
  and methodology, deliverables and timeline, capability, close.

**The OpenAI API key lives only in that function's secrets.** The browser sends
structured context (organisation, segment, notes, RFP title, deadline) and never
sees a key or a prompt.

```bash
npx supabase login
npx supabase link --project-ref your-project-ref
npx supabase secrets set OPENAI_API_KEY=sk-proj-...
npx supabase functions deploy concept-note
```

Everything else in the console works without this; only the two drafting buttons
need it.

Uses `gpt-4o-mini`, matching careercraft-pro. Proposals go into live bids, so if
they need more depth, `MODEL` in
[the function](supabase/functions/concept-note/index.ts) is a one-word change to
`gpt-4o` — at roughly 15× the cost per call.

Both prompts refuse to invent client names, figures, or credentials. Where a
detail is missing the model marks it as a `[square-bracket]` placeholder for the
author rather than writing around it silently — on a live bid an invented
methodology detail is worse than an obvious gap. A draft that hits the token
ceiling is flagged as truncated rather than being passed off as complete.

> **Do not put `OPENAI_API_KEY` in `.env.local`.** Vite only exposes
> `VITE_`-prefixed variables, so it would do nothing there — and prefixing it
> `VITE_` would publish it in the browser bundle.

---

## Scraped RFPs from CareerCraft

The RFPs view has a **Sync from CareerCraft** button that pulls scraped tenders
from `mycareercraft.site/api/public/opportunities` — the same rows behind that
project's `/admin/opportunities` page. It filters to `category=rfp`, so job
postings never arrive.

No configuration is needed: that endpoint sends
`Access-Control-Allow-Origin: *`, so the browser calls it directly with no proxy
or server route in between.

**Re-syncing is safe.** Each synced RFP stores the feed's opportunity id in
`external_id`, and a unique index on `(user_id, external_id)` means a second sync
adds only what is new. Existing rows are left untouched rather than overwritten,
so a status you moved to *Preparing* and notes you added survive.

Buyer segment is inferred from the organisation name
(`classifySegment` in [src/lib/opportunities.ts](src/lib/opportunities.ts)) —
UN bodies and donors map to Development Partner, ministries to Government, and
so on. It is a guess, and editable in the RFP dialog. Feed titles arrive with
HTML entities intact (`Rwanda&apos;s`), so they are decoded on the way in.

## Notes on the implementation

**Dates are calendar dates, not instants.** A lead created on the 3rd belongs to
the week containing the 3rd regardless of clock time, so `src/lib/dates.ts` parses
and formats at *local* midnight and never round-trips through `toISOString()`,
which silently shifts the day for anyone east or west of Greenwich.

**Every reported number comes from `src/lib/metrics.ts`**, so the dashboard, the
progress charts, and the weekly report can't disagree about what "qualified this
week" means.

**`statusUpdatedOn` only moves on an actual status change**, not on incidental
edits — the weekly "leads qualified" count depends on it.

**Charts are single-hue by design.** The segment and RFP-status charts plot one
measure across nominal categories, so identity is carried by the category axis and
every bar shares one colour; colouring them individually would double-encode bar
length as hue. A five-colour status ramp was tried and rejected — `Preparing` and
`Submitted` sit at OKLab ΔE 3.8, indistinguishable even with full colour vision.

**Row types in `database.types.ts` are `type` aliases, not `interface`s.**
PostgREST constrains rows to `Record<string, unknown>`; an interface has no
implicit index signature and fails that constraint *silently*, degrading every
insert payload to `never`.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run typecheck` | Typecheck only |
| `npm run lint` | Oxlint |
| `npm run preview` | Serve the production build locally |

`docx` and Recharts are loaded on demand (Word export and the Progress view
respectively), keeping the initial bundle at ~147 kB gzipped.

Only the shadcn components in use are vendored in `src/components/ui/`. Add more
with `npx shadcn@latest add <name>`.
