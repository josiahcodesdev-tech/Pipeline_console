import type { SyncedRfpDraft } from './db'
import { SEGMENTS, type Segment } from './types'

/**
 * Client for the CareerCraft public opportunities feed — the same scraped rows
 * shown at /admin/opportunities, exposed read-only at /api/public/opportunities.
 *
 * That endpoint sets `Access-Control-Allow-Origin: *`, so the browser calls it
 * directly; there is no proxy or server route in between.
 */

const DEFAULT_FEED = 'https://www.mycareercraft.site/api/public/opportunities'

/** One row of the public feed. Every field but `id`/`title` can be absent. */
interface FeedItem {
  id?: unknown
  source?: unknown
  title?: unknown
  organization?: unknown
  category?: unknown
  location?: unknown
  deadline?: unknown
  url?: unknown
  scrapedAt?: unknown
  updatedAt?: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The scraper stores titles with HTML entities intact (`Rwanda&apos;s`), which
 * would otherwise show literally in the table.
 */
function decodeEntities(input: string): string {
  if (!input.includes('&')) return input
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    rsquo: '’',
    lsquo: '‘',
    ldquo: '“',
    rdquo: '”',
    hellip: '…',
  }
  return input
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (whole, name: string) => named[name.toLowerCase()] ?? whole)
}

/** Only `YYYY-MM-DD` survives — a bad date would break deadline sorting. */
function isoDate(value: unknown): string {
  const raw = text(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''
}

/**
 * Guesses the buyer segment from the organization name and title.
 *
 * Ordered most-specific first: "Ministry of Health Foundation Trust" should
 * read as Government, not NGO. Today the feed is entirely UNDP, but the
 * scraper gains sources over time, so this classifies rather than hardcodes.
 * A wrong guess is cheap — the segment is editable in the RFP dialog.
 */
export function classifySegment(organization: string, title = ''): Segment {
  const haystack = `${organization} ${title}`.toLowerCase()

  const has = (...needles: string[]) =>
    needles.some((needle) => haystack.includes(needle))

  if (
    has(
      'undp', 'unicef', 'unesco', 'unhcr', 'unfpa', 'unops', 'unep', 'unido',
      'united nations', 'world bank', 'world health', 'who ', 'wfp', 'fao',
      'ilo', 'iom', 'usaid', 'giz', 'sida', 'danida', 'norad', 'dfid', 'fcdo',
      'european union', 'african development bank', 'afdb', 'gavi',
      'global fund', 'development partner', 'unwomen', 'un women',
    )
  ) {
    return 'Development Partner'
  }

  if (
    has(
      'ministry', 'county government', 'county of', 'government of', 'republic of',
      'state department', 'national treasury', 'public service', 'parliament',
      'commission', 'regulatory authority', 'municipal', 'city council',
    )
  ) {
    return 'Government'
  }

  if (has('university', 'college', 'polytechnic', 'school of', 'institute of technology')) {
    return 'University'
  }

  if (
    has(
      'foundation', 'trust', 'ngo', 'non-governmental', 'charity', 'relief',
      'red cross', 'oxfam', 'save the children', 'care international',
      'world vision', 'plan international', 'mercy corps', 'caritas',
    )
  ) {
    return 'NGO'
  }

  if (
    has(
      'authority', 'corporation', 'parastatal', 'state corporation',
      'kenya power', 'kenya airways', 'kenya ports', 'national oil',
    )
  ) {
    return 'SOE'
  }

  if (has(' ltd', 'limited', ' plc', ' inc', 'holdings', 'group', 'bank', 'insurance')) {
    return 'Corporate'
  }

  return 'Government'
}

function isSegmentValue(value: string): value is Segment {
  return (SEGMENTS as readonly string[]).includes(value)
}

/** Resolves the feed URL, allowing an override for staging or a local server. */
function feedUrl(params: Record<string, string>): string {
  const base = import.meta.env.VITE_OPPORTUNITIES_API_URL || DEFAULT_FEED
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  // Optional. The feed is open unless OPPORTUNITIES_API_KEY is set on the
  // CareerCraft side; note that anything in a Vite bundle is public, so this
  // gates casual access, not a determined caller.
  const key = import.meta.env.VITE_OPPORTUNITIES_API_KEY
  if (key) url.searchParams.set('key', key)
  return url.toString()
}

export interface FetchedOpportunities {
  drafts: SyncedRfpDraft[]
  /** Rows the feed returned but that could not be mapped, with reasons. */
  skipped: string[]
}

/**
 * Pulls RFP-category opportunities and maps them into RFP drafts.
 * Jobs are excluded at the API level via `category=rfp`.
 */
export async function fetchOpportunities(
  limit = 200,
): Promise<FetchedOpportunities> {
  let response: Response
  try {
    response = await fetch(feedUrl({ category: 'rfp', limit: String(limit) }), {
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new Error(
      'Could not reach the CareerCraft feed. Check your connection and try again.',
    )
  }

  if (response.status === 401) {
    throw new Error(
      'The CareerCraft feed rejected the request (401). It now requires an API key — set VITE_OPPORTUNITIES_API_KEY.',
    )
  }
  if (!response.ok) {
    throw new Error(`The CareerCraft feed returned ${response.status}.`)
  }

  const payload: unknown = await response.json()
  const rows =
    typeof payload === 'object' && payload !== null && 'data' in payload
      ? (payload as { data: unknown }).data
      : null

  if (!Array.isArray(rows)) {
    throw new Error('Unexpected response from the CareerCraft feed.')
  }

  const drafts: SyncedRfpDraft[] = []
  const skipped: string[] = []

  rows.forEach((row, index) => {
    if (typeof row !== 'object' || row === null) {
      skipped.push(`Row ${index + 1}: not an object`)
      return
    }
    const item = row as FeedItem
    const externalId = text(item.id)
    const title = decodeEntities(text(item.title))

    if (!externalId) {
      skipped.push(`"${title || `Row ${index + 1}`}": missing id`)
      return
    }
    if (!title) {
      skipped.push(`Row ${index + 1}: missing title`)
      return
    }

    const org = decodeEntities(text(item.organization))
    const location = decodeEntities(text(item.location))
    const feedSource = text(item.source)
    const rawSegment = text(item.category)

    drafts.push({
      externalId,
      title,
      org,
      // `category` is "rfp"/"job", not a buyer segment, so it is never a
      // segment value — but check anyway in case the feed gains one.
      segment: isSegmentValue(rawSegment) ? rawSegment : classifySegment(org, title),
      deadline: isoDate(item.deadline),
      // The feed carries no contract value.
      value: null,
      status: 'Watching',
      link: text(item.url),
      notes: location ? `Location: ${location}` : '',
      source: feedSource ? `CareerCraft · ${feedSource}` : 'CareerCraft',
    })
  })

  return { drafts, skipped }
}
