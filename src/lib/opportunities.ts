import type { SyncedRfpDraft } from './db'
import type { Segment } from './types'

/**
 * Client for the CareerCraft public opportunities feed — the same scraped rows
 * shown at /admin/opportunities, exposed read-only at /api/public/opportunities.
 *
 * That endpoint sets `Access-Control-Allow-Origin: *`, so the browser calls it
 * directly; there is no proxy or server route in between.
 */

const DEFAULT_FEED = 'https://www.mycareercraft.site/api/public/opportunities'

/**
 * One row of the public feed. Every field but `id`/`title` can be absent.
 *
 * `category` and `type` are both here because the feed renamed the field: rows
 * used to carry `category: "rfp" | "job"` and now carry `type`. Reading both
 * means the sync survives whichever side is deployed.
 */
interface FeedItem {
  id?: unknown
  source?: unknown
  title?: unknown
  organization?: unknown
  /** Legacy name for `type`. */
  category?: unknown
  type?: unknown
  /** Service-area taxonomy, e.g. ["Monitoring & Evaluation"]. */
  categories?: unknown
  kenya?: unknown
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
 * Pulls every opportunity the scraper has and maps them into RFP drafts.
 *
 * Deliberately unfiltered. This used to request `category=rfp`, which dropped
 * roughly half the feed — but ReliefWeb files consultancy and training
 * assignments under "job", so that filter was throwing away biddable work
 * alongside the staff vacancies. Everything now arrives in the tracker, tagged
 * with its type, and the Proposals pipeline is where triage happens.
 *
 * 500 is the endpoint's hard ceiling (`MAX_LIMIT`), and it exposes no
 * pagination — past 500 opportunities the feed would need an offset parameter
 * before this could stay complete.
 */
export async function fetchOpportunities(
  limit = 500,
): Promise<FetchedOpportunities> {
  let response: Response
  try {
    response = await fetch(feedUrl({ limit: String(limit) }), {
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
    // `type` is the current field; `category` is what it used to be called.
    const opportunityType = (text(item.type) || text(item.category)).toLowerCase()

    const serviceAreas = Array.isArray(item.categories)
      ? item.categories
          .map((entry) => text(entry))
          // The scraper emits this placeholder when nothing matched; carrying
          // it through would just be noise in the table.
          .filter((entry) => entry && entry.toLowerCase() !== 'uncategorized')
          .join(', ')
      : ''

    drafts.push({
      externalId,
      title,
      org,
      segment: classifySegment(org, title),
      deadline: isoDate(item.deadline),
      // The feed carries no contract value.
      value: null,
      status: 'Watching',
      link: text(item.url),
      notes: location ? `Location: ${location}` : '',
      // The scraper's own source name, unprefixed — "reliefweb", "undp".
      // CareerCraft is how it reaches us, not where it came from, and putting
      // it on every row made the column say the same thing 30 times.
      source: feedSource || 'CareerCraft',
      opportunityType,
      kenya: item.kenya === true,
      serviceAreas,
    })
  })

  return { drafts, skipped }
}
