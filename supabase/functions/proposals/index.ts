/**
 * Edge Function: proposals
 *
 * SUPERSEDED, AND BEHIND api/_feed.js. DO NOT DEPLOY WITHOUT READING THIS.
 *
 * This was written before the feed's purpose changed. It was never deployed,
 * and it can no longer do the job asked of it: the point of the feed is now to
 * keep answering when Supabase is stuck, and this function runs on Supabase,
 * so it stops exactly when it would be needed. api/proposals.js on Vercel
 * replaced it for that reason.
 *
 * It is also out of date. The published shape has since gained `owner_name`,
 * `claimed_by`, `claimed_by_name` and `claimed_at`, which are resolved from
 * `profiles` and `rfp_claims` — none of which this file reads. Deploying it
 * would put a second, disagreeing version of the contract on the network.
 *
 * Either delete this directory, or bring it back in step with api/_feed.js
 * before deploying. Leaving it half-way is the one option with no upside.
 *
 * ---
 *
 * A read-only JSON feed of every tender in the console, for a partner system
 * that does its own filtering. One route, one verb:
 *
 *   GET /functions/v1/proposals
 *   Authorization: Bearer <PROPOSALS_FEED_TOKEN>
 *
 * WHY THIS IS NOT A SUPABASE CLIENT CALL
 * The caller is a server, not a member. It has no account here and no JWT, so
 * none of the row-level security written in 0013, 0038 and 0039 can decide
 * what it sees — those policies all key off `auth.uid()`. This function reads
 * with the service-role key, which bypasses them, and substitutes the only
 * check left available: a shared secret that either matches or does not.
 *
 * WHAT THE TOKEN IS WORTH, STATED PLAINLY
 * Every row of `rfps`, for every member, regardless of who owns it. That is
 * wider than any single person's view of the console — an ordinary member sees
 * their own pipeline, and oversight sees the firm's. It is what "the whole
 * org's rows, past row-level security" was asked for, and it is why the token
 * belongs in a secret store and not in a browser, a repo or a URL. Anyone
 * holding it can read the firm's entire pipeline.
 *
 * WHY verify_jwt IS OFF
 * The platform's own gate would try to parse `Authorization` as a Supabase JWT
 * and reject this token before the function ran. Turning it off does not leave
 * the door open; it moves the lock from the platform to `authorised()` below,
 * which is the only thing standing between a caller and the rows. Deploying
 * this function WITHOUT --no-verify-jwt makes it return 401 to everyone;
 * deploying it without PROPOSALS_FEED_TOKEN set makes it return 503 to
 * everyone. Both are safe failures, which is the point.
 *
 * WHAT IS STORED, AND WHAT IS STILL TRUE
 * The result is held in the instance and re-served for PROPOSALS_CACHE_TTL_SECONDS
 * (five minutes by default), so a caller polling steadily does not re-read the
 * table on every request. That copy is a convenience and never an authority:
 * `rfps` remains the only place the pipeline is true, the copy dies with the
 * instance, and a cold start simply reads again. See "the stored copy" below.
 *
 * Deploy:
 *   supabase secrets set PROPOSALS_FEED_TOKEN=<token>
 *   npm run deploy:fn proposals
 *
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function send(body: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      // Freshness is decided here, by the stored copy's age, not by a proxy
      // holding its own guess at one. Nothing in between should add a second
      // layer of staleness on top of the one this function already manages.
      'Cache-Control': 'no-store',
      ...extra,
    },
  })
}

function json(body: unknown, status: number): Response {
  return send(JSON.stringify(body), status)
}

/**
 * The console's own address, used to build the link back to a tender.
 *
 * `rfps.link` is deliberately NOT that link — it holds the source notice on
 * the funder's site, which is a different thing and the wrong one to hand a
 * colleague who wants to open the record. Overridable because the preview and
 * production deployments answer on different hosts.
 */
const CONSOLE_ORIGIN =
  Deno.env.get('CONSOLE_ORIGIN')?.trim().replace(/\/+$/, '') ||
  'https://pipeline-console-nine.vercel.app'

/**
 * Compare two secrets without leaking, through timing, how much of one is
 * right.
 *
 * A plain `===` returns as soon as two characters differ, so the time it takes
 * tracks the length of the matching prefix, and a caller who can measure it
 * can recover the token a character at a time. This always walks the full
 * width. Lengths are mixed into the result rather than short-circuited on, so
 * a wrong-length guess costs the same as a right-length one.
 */
function secretsMatch(given: string, expected: string): boolean {
  const width = Math.max(given.length, expected.length)
  let diff = given.length ^ expected.length
  for (let i = 0; i < width; i += 1) {
    diff |= given.charCodeAt(i % (given.length || 1)) ^
      expected.charCodeAt(i % (expected.length || 1))
  }
  return diff === 0
}

function authorised(request: Request, expected: string): boolean {
  const header = request.headers.get('Authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match) return false
  return secretsMatch(match[1].trim(), expected)
}

/**
 * Every column on the row.
 *
 * `*` rather than a list, because the feed now publishes the whole record and
 * a list would be a second place to remember. What is published is decided in
 * `present()` below, which names each key explicitly — so a column added to
 * the table later appears in the feed only when someone chooses to add it
 * there, and never by surprise.
 */
const COLUMNS = '*'

/**
 * How many rows to ask for at a time.
 *
 * PostgREST caps a single response at its own `max_rows` setting — 1000 in
 * `config.toml` today — so one unbounded select does not mean "every row". It
 * means "the first 1000, silently", which is the wrong shape for a feed whose
 * whole promise is that the caller can do its own filtering.
 */
const PAGE = 1000

/**
 * A stop, in pages, so a misbehaving server cannot spin this forever.
 *
 * Set far above any plausible pipeline: at 1000 rows a page this is a million
 * tenders. Reaching it means something is wrong, not that the firm got busy,
 * so it throws rather than returning a quietly half-read feed.
 */
const MAX_PAGES = 1000

type Row = {
  id: string
  user_id: string | null
  title: string | null
  org: string | null
  segment: string | null
  deadline: string | null
  value: number | string | null
  status: string | null
  link: string | null
  notes: string | null
  source: string | null
  sourced: boolean | null
  in_pipeline: boolean | null
  opportunity_type: string | null
  kenya: boolean | null
  service_areas: string | null
  fit_score: number | string | null
  tender_text: string | null
  tender_file_name: string | null
  notice_text: string | null
  analysis: string | null
  analysed_at: string | null
  ingestion: Record<string, unknown> | null
  analysis_json: Record<string, unknown> | null
  enrichment: Record<string, unknown> | null
  intelligence_updated_at: string | null
  external_id: string | null
  created_on: string | null
  status_updated_on: string | null
  created_at: string | null
  updated_at: string | null
}

async function readAll(admin: SupabaseClient): Promise<Row[]> {
  const rows: Row[] = []
  let from = 0

  for (let guard = 0; guard < MAX_PAGES; guard += 1) {
    const { data, error } = await admin
      .from('rfps')
      .select(COLUMNS)
      // Ordered by a unique column last so the sort is total. Without that
      // tiebreak, rows sharing a `created_on` may fall in a different order on
      // each query, and a row can be skipped or repeated across page borders.
      .order('created_on', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(error.message)
    const page = (data ?? []) as Row[]
    rows.push(...page)

    // Stop on an empty page, and step forward by what actually arrived rather
    // than by what was asked for. The obvious alternative — stop as soon as a
    // page comes back shorter than PAGE — is wrong whenever PostgREST's
    // `max_rows` is below PAGE: every page is then "short", and the feed would
    // quietly end after the first one while reporting success. Advancing by
    // the real count costs one empty request at the end and is correct however
    // that setting is tuned.
    if (page.length === 0) return rows
    from += page.length
  }

  throw new Error(`Stopped after ${MAX_PAGES} pages; the pipeline read did not end.`)
}

/**
 * `value` is `numeric(14, 2)`, which PostgREST may hand over as a string to
 * avoid the precision loss a float would introduce. The contract promises a
 * number, so convert here — and treat a value that will not convert as absent
 * rather than emitting NaN, which is not a thing JSON can carry.
 */
function asNumber(value: number | string | null): number | null {
  if (value === null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** `date` columns arrive as YYYY-MM-DD already; this guards the empty case. */
function asDate(value: string | null): string | null {
  return value && value.trim() ? value.slice(0, 10) : null
}

/**
 * One tender, as the feed publishes it.
 *
 * WHY `link` IS NOT THE `link` COLUMN
 * The agreed contract uses `link` for the console's own page, and the table
 * uses `link` for the funder's notice — two different URLs wearing one name.
 * The contract came first and callers already parse it, so `link` keeps its
 * agreed meaning and the column travels as `source_link`. Of the two it is
 * the one that actually resolves today; see the note on deep links.
 *
 * Every other key is the column name unchanged, so the row and the JSON can
 * be read against each other without a mapping table.
 */
function present(row: Row): Record<string, unknown> {
  return {
    // The nine the feed was first agreed on. Unchanged, and first, so a
    // caller reading only these sees exactly what it saw before.
    id: row.id,
    title: row.title ?? '',
    org: row.org ?? '',
    segment: row.segment ?? '',
    status: row.status ?? '',
    deadline: asDate(row.deadline),
    value: asNumber(row.value),
    in_pipeline: row.in_pipeline === true,
    created_on: asDate(row.created_on),
    link: `${CONSOLE_ORIGIN}/opportunity/${row.id}`,

    // The rest of the record.
    user_id: row.user_id ?? null,
    source_link: row.link ?? '',
    notes: row.notes ?? '',
    source: row.source ?? '',
    sourced: row.sourced === true,
    opportunity_type: row.opportunity_type ?? '',
    kenya: row.kenya === true,
    service_areas: row.service_areas ?? '',
    fit_score: asNumber(row.fit_score),
    external_id: row.external_id ?? null,
    status_updated_on: asDate(row.status_updated_on),

    // Timestamps stay as the full ISO instants they are. Cutting them to ten
    // characters the way the date columns are cut would throw away the time,
    // which for `updated_at` is most of what it is for.
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,

    // What reading the tender produced. Empty on nearly every row today.
    tender_text: row.tender_text ?? '',
    tender_file_name: row.tender_file_name ?? '',
    notice_text: row.notice_text ?? '',
    analysis: row.analysis ?? '',
    analysed_at: row.analysed_at ?? null,
    analysis_json: row.analysis_json ?? {},
    enrichment: row.enrichment ?? {},
    ingestion: row.ingestion ?? {},
    intelligence_updated_at: row.intelligence_updated_at ?? null,
  }
}

// ------------------------------------------------------- the stored copy ---
/**
 * How long a stored copy is served before the table is read again.
 *
 * The pipeline is edited by people at human speed, and the caller re-reads the
 * whole feed each time, so a copy a few minutes old is the same answer a fresh
 * query would give in all but the rare case. Set PROPOSALS_CACHE_TTL_SECONDS
 * to 0 to turn storing off and read the table on every request.
 */
const TTL_MS = (() => {
  const raw = Number(Deno.env.get('PROPOSALS_CACHE_TTL_SECONDS')?.trim() ?? '')
  return Number.isFinite(raw) && raw >= 0 ? raw * 1000 : 5 * 60 * 1000
})()

interface Stored {
  at: number
  body: string
}

/**
 * The copy itself, and the read currently filling it.
 *
 * Both are module state, which on Deno Deploy means they live as long as the
 * instance does and vanish with it. That is the honest limit of storing
 * anything here: a cold start reads the table once more. It is not a bug to
 * work around — it is why the fallback path stays a plain query, and why
 * nothing in this function treats the stored copy as the source of truth.
 */
let stored: Stored | null = null
let filling: Promise<Stored> | null = null

async function fill(admin: SupabaseClient): Promise<Stored> {
  const rows = await readAll(admin)
  stored = { at: Date.now(), body: JSON.stringify({ proposals: rows.map(present) }) }
  return stored
}

type Served = { entry: Stored; state: 'stored' | 'fetched' | 'stale' }

async function feed(admin: SupabaseClient, force: boolean): Promise<Served> {
  if (!force && stored && Date.now() - stored.at < TTL_MS) {
    return { entry: stored, state: 'stored' }
  }

  // One read at a time. Without this, N requests arriving together on a cold
  // instance each start their own full paged scan of the table — the moment
  // the copy is least able to help is the moment it would be hit hardest.
  // Latecomers join the read already running instead of starting another.
  if (!filling) {
    filling = fill(admin).finally(() => {
      filling = null
    })
  }

  try {
    return { entry: await filling, state: 'fetched' }
  } catch (cause) {
    // A read can fail while a good copy is still in hand — a blip, a timeout,
    // a moment of maintenance. Handing back the copy we already have is a
    // better answer than a 500, so long as the caller is told it is old. Only
    // with nothing stored at all does the failure become the caller's problem.
    if (stored) {
      console.error('proposals feed refresh failed; serving the stored copy:', cause)
      return { entry: stored, state: 'stale' }
    }
    throw cause
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const expected = Deno.env.get('PROPOSALS_FEED_TOKEN')?.trim() ?? ''
  if (!expected) {
    // Refuse rather than fall back to an open endpoint. A feed that starts
    // answering because its secret went missing is the failure worth avoiding.
    return json({ error: 'This feed is not configured.' }, 503)
  }

  if (!authorised(request, expected)) {
    // One message for a missing header, a malformed one and a wrong token.
    // Telling an unauthorised caller which of the three they are is telling
    // them what to try next.
    return json({ error: 'Unauthorized' }, 401)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) {
    return json({ error: 'This function is missing its Supabase credentials.' }, 500)
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // `?refresh=1` skips the stored copy, for the caller who has just changed
  // something and wants to see it reflected without waiting out the TTL.
  const force = new URL(request.url).searchParams.get('refresh') === '1'

  try {
    const { entry, state } = await feed(admin, force)
    return send(entry.body, 200, {
      // Freshness travels in headers, not in the body, so the JSON stays
      // exactly the shape that was agreed.
      'X-Feed-State': state,
      'Age': String(Math.max(0, Math.round((Date.now() - entry.at) / 1000))),
    })
  } catch (cause) {
    // The reason is for the function log, not the caller. A database error
    // message can name columns and constraints, and the caller is outside.
    console.error('proposals feed failed:', cause)
    return json({ error: 'Could not read the pipeline.' }, 500)
  }
})
