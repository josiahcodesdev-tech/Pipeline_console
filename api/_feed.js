/**
 * The proposals feed: what it reads, and the shape it publishes.
 *
 * Shared by the Vercel endpoint (api/proposals.js) and the file export
 * (scripts/export-proposals.mjs) so the two cannot drift. A caller holding a
 * record cannot tell which produced it, and should never need to.
 *
 * The Supabase Edge Function in supabase/functions/proposals/ carries its own
 * copy of this shape, because Deno bundles that directory alone and cannot
 * import from here. If a field changes, change it there in the same commit.
 *
 * Underscore-prefixed so Vercel treats this as a module and not a route.
 */

import { createClient } from '@supabase/supabase-js'

/**
 * Every column on the row.
 *
 * `*` rather than a list, because the feed publishes the whole record and a
 * list would be a second place to remember. What is published is decided in
 * `present()`, which names each key explicitly — so a column added to the
 * table later appears here only when someone chooses to add it, never by
 * surprise.
 */
export const COLUMNS = '*'

const PAGE = 1000

/**
 * A stop, in pages, so a misbehaving server cannot spin this forever. At 1000
 * rows a page this is a million tenders; reaching it means something is wrong,
 * not that the firm got busy.
 */
const MAX_PAGES = 1000

export function client(url, serviceKey) {
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function readAll(admin) {
  const rows = []
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
    const page = data ?? []
    rows.push(...page)

    // Stop on an empty page, and step forward by what actually arrived. The
    // obvious alternative — stop as soon as a page is shorter than PAGE — is
    // wrong whenever PostgREST's `max_rows` is below PAGE: every page is then
    // "short", and the feed would quietly end after the first one while
    // reporting success.
    if (page.length === 0) return rows
    from += page.length
  }

  throw new Error(`Stopped after ${MAX_PAGES} pages; the pipeline read did not end.`)
}

/**
 * Who each member is, by id.
 *
 * `rfps.user_id` is a bare uuid, which answers "are these two tenders the same
 * person's" and nothing else. The question actually being asked of this feed
 * is "who is working on it", and that needs the name.
 *
 * Six rows today, so this is one small query rather than a join per tender.
 */
export async function readPeople(admin) {
  const { data, error } = await admin.from('profiles').select('id, full_name')
  if (error) throw new Error(error.message)
  return new Map((data ?? []).map((p) => [p.id, p.full_name || null]))
}

/**
 * Who has claimed each tender, firm-wide.
 *
 * Separate from `user_id`, and not the same question. `user_id` owns a row;
 * a claim says which member is bidding a notice across everyone's copies of
 * it, which is what the console shows as "taken by". Keyed by `external_id`,
 * so hand-added tenders have none — see migration 0017.
 */
export async function readClaims(admin) {
  const { data, error } = await admin
    .from('rfp_claims')
    .select('external_id, claimed_by, claimed_at')
  if (error) throw new Error(error.message)
  return new Map((data ?? []).map((c) => [c.external_id, c]))
}

/**
 * The whole feed: every tender, with owner and claim resolved to names.
 *
 * One entry point so a caller cannot read the rows and forget the lookups,
 * which would silently produce a feed where nobody is working on anything.
 */
export async function readFeed(admin, consoleOrigin) {
  const [rows, people, claims] = await Promise.all([
    readAll(admin),
    readPeople(admin),
    readClaims(admin),
  ])
  return rows.map((row) => present(row, consoleOrigin, people, claims))
}

/**
 * `value` is `numeric(14, 2)`, which PostgREST may hand over as a string to
 * avoid the precision loss a float would introduce. The contract promises a
 * number, so convert here — and treat a value that will not convert as absent
 * rather than emitting NaN, which is not a thing JSON can carry.
 */
export function asNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** `date` columns arrive as YYYY-MM-DD already; this guards the empty case. */
export function asDate(value) {
  return value && String(value).trim() ? String(value).slice(0, 10) : null
}

/**
 * One tender, as the feed publishes it.
 *
 * WHY `link` IS NOT THE `link` COLUMN
 * The agreed contract uses `link` for the console's own page, and the table
 * uses `link` for the funder's notice — two different URLs wearing one name.
 * The contract came first and callers already parse it, so `link` keeps its
 * agreed meaning and the column travels as `source_link`. Of the two,
 * `source_link` is the one that actually resolves today.
 *
 * WHY EVERY ROW IS PUBLISHED, NOT JUST THE PIPELINE
 * The console's Proposals page lists only `in_pipeline` rows. This feed sends
 * all of them and includes the flag, because the contract said the caller does
 * its own filtering — and a caller can narrow a full feed, but cannot widen a
 * narrow one. `proposals.filter(p => p.in_pipeline)` is that page exactly.
 */
export function present(row, consoleOrigin, people = new Map(), claims = new Map()) {
  const claim = row.external_id ? (claims.get(row.external_id) ?? null) : null
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
    link: `${consoleOrigin}/opportunity/${row.id}`,

    // Who holds it. `user_id` owns the row; the claim says who is bidding the
    // notice firm-wide. They are usually the same person and occasionally not,
    // which is the case worth being able to see.
    user_id: row.user_id ?? null,
    owner_name: (row.user_id ? people.get(row.user_id) : null) ?? null,
    claimed_by: claim?.claimed_by ?? null,
    claimed_by_name: (claim?.claimed_by ? people.get(claim.claimed_by) : null) ?? null,
    claimed_at: claim?.claimed_at ?? null,

    // The rest of the record.
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

    // Full ISO instants, not cut to ten characters the way the date columns
    // are — for `updated_at` the time is most of the point.
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

/**
 * Compare two secrets without leaking, through timing, how much of one is
 * right.
 *
 * A plain `===` returns as soon as two characters differ, so the time it takes
 * tracks the length of the matching prefix, and a caller who can measure it
 * can recover the token a character at a time. This always walks the full
 * width, and mixes the lengths into the result rather than short-circuiting on
 * them, so a wrong-length guess costs the same as a right-length one.
 */
export function secretsMatch(given, expected) {
  const width = Math.max(given.length, expected.length)
  let diff = given.length ^ expected.length
  for (let i = 0; i < width; i += 1) {
    diff |= given.charCodeAt(i % (given.length || 1)) ^
      expected.charCodeAt(i % (expected.length || 1))
  }
  return diff === 0
}

export function bearerMatches(header, expected) {
  const match = /^Bearer\s+(.+)$/i.exec((header ?? '').trim())
  if (!match) return false
  return secretsMatch(match[1].trim(), expected)
}
