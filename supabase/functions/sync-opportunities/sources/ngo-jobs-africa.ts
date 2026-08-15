/**
 * NGO Jobs in Africa — consultancy archive.
 *
 * The site is a jobs board, and most of what it publishes is staff vacancies:
 * nurses, finance officers, drivers. Those are not work anyone bids for, so
 * this connector reads one archive only — `job-type/consultancy`, the terms of
 * reference and short assignments. Adding "contract" alongside it is a one-line
 * change to ARCHIVES below, but on a jobs board that label means a fixed-term
 * employment contract rather than an assignment, so it is left out.
 *
 * WHY THE HTML AND NOT A FEED
 * There is a REST API, but the jobs live in a `noo_job` custom post type that
 * is not registered with it — /wp-json/wp/v2/noo_job is a 404, and the posts
 * the API does return are the site's scholarship articles. The RSS feed at
 * ?post_type=noo_job does paginate, but carries only title, link and body:
 * no employer, no country, no closing date. The archive markup carries all
 * three as its own fields, so it is the better read despite being scraped.
 *
 * Structure, per listing:
 *   <article class="... post-334703 ... job_category-monitoring-and-evaluation
 *                   job_type-consultancy job_location-nigeria" data-url="…">
 *     <h2 class="loop-item-title"><a>TITLE</a></h2>
 *     <span class="job-company"><a>Pathfinder International</a></span>
 *     <span class="job-location"><em>Nigeria</em></span>
 *     <span class="job-date"><time datetime="2026-08-13T17:59:40+00:00">
 *       <span>August 13, 2026</span><span>- August 18, 2026</span></time></span>
 *
 * The board's own `job_category` is fed to the relevance check alongside the
 * title. It is the strongest signal on the page — a notice tagged
 * monitoring-and-evaluation is this firm's work whether or not its title
 * happens to use the words — and reading titles alone dropped assignments that
 * said "assess" where the capability list says "evaluation".
 */

import {
  type Notice,
  isRelevant,
  parseDate,
  scoreFit,
  serviceAreasFor,
  stillOpen,
  stripTags,
  withinLookback,
} from "../normalize.ts"

const ORIGIN = "https://ngojobsinafrica.com"

/** Archives read, in order. See the note above on "contract". */
const ARCHIVES = ["consultancy"] as const

/**
 * Pages read per archive before giving up.
 *
 * The board posts roughly a dozen consultancies a week across ten-item pages,
 * so the seven-day lookback is normally satisfied within two. The cap is there
 * for the case where the date filter never trips — a backdated batch, or a
 * pagination change that starts serving page one forever — and stops that
 * turning into an unbounded crawl of a site we do not own.
 */
const MAX_PAGES = 6

/**
 * Slugs the board mashes two words into, which hyphen-splitting alone would
 * leave as "programproject management" — a term no capability list can match.
 */
const CATEGORY_ALIASES: Record<string, string> = {
  "programproject-management": "program management project management",
  "donor-relationsgrants-management": "donor relations grants management",
}

function categoryText(block: string): string {
  const slugs = [...block.matchAll(/job_category-([a-z0-9-]+)/g)].map((m) => m[1])
  return slugs
    .map((slug) => CATEGORY_ALIASES[slug] ?? slug.replace(/-/g, " "))
    .join(" ")
}

/** First capture of a pattern, flattened to text. Empty when it does not match. */
function field(block: string, pattern: RegExp): string {
  return stripTags(block.match(pattern)?.[1] ?? "")
}

/**
 * The closing date, printed after the posting date as "- August 18, 2026".
 *
 * Only the second span carries it, so the leading dash is what identifies it —
 * matching any date inside the block would read the posting date as a deadline
 * and quietly mark every listing as closing the day it opened.
 */
function closingDate(block: string): string | null {
  const dates = block.match(/<span class="job-date">[\s\S]*?<\/span>\s*<\/span>/i)?.[0] ?? block
  const expiry = dates.match(/-\s*([A-Za-z]{3,}\s+\d{1,2},?\s+\d{4})\s*<\/span>/i)
  return expiry ? parseDate(expiry[1]) : null
}

export function parseNgoJobsAfrica(html: string, now = new Date()): Notice[] {
  const notices: Notice[] = []

  for (const block of html.match(/<article[^>]*\bnoo_job\b[\s\S]*?<\/article>/gi) ?? []) {
    const id = block.match(/\bpost-(\d+)\b/)?.[1]
    if (!id) continue

    const title = field(block, /<h2[^>]*class="[^"]*loop-item-title[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)
    if (!title) continue

    // Published, not posted-to-us: the archive is newest-first, so this is
    // also what tells the pager when it has read far enough back.
    const published = parseDate(block.match(/<time[^>]*datetime="([^"]+)"/i)?.[1] ?? "")
    if (!withinLookback(published, now)) continue

    const deadline = closingDate(block)
    if (!stillOpen(deadline, now)) continue

    const org = field(block, /class="job-company"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)
    const location = field(block, /class="job-location"[\s\S]*?<em[^>]*>([\s\S]*?)<\/em>/i)
    const categories = categoryText(block)

    if (!isRelevant(title, categories)) continue

    const link = block.match(/data-url="([^"]+)"/i)?.[1] ?? `${ORIGIN}/job-type/consultancy/`

    notices.push({
      externalId: `ngojobsafrica:${id}`,
      title: title.slice(0, 300),
      org: org || "NGO Jobs in Africa",
      deadline,
      link,
      location,
      source: "NGO Jobs in Africa",
      // The archive is consultancy assignments — terms of reference to bid on,
      // not posts to apply for — so they belong under the tracker's rfp type
      // even though the site frames everything as a job.
      opportunityType: "rfp",
      serviceAreas: serviceAreasFor(title, categories),
      fitScore: scoreFit(title, categories),
    })
  }

  return notices
}

/** True once a page holds listings but none of them are recent enough. */
function pageIsOld(html: string, now: Date): boolean {
  const stamps = [...html.matchAll(/<time[^>]*datetime="([^"]+)"/gi)].map((m) => parseDate(m[1]))
  return stamps.length > 0 && stamps.every((stamp) => !withinLookback(stamp, now))
}

async function fetchPage(archive: string, page: number): Promise<string> {
  const url = page === 1
    ? `${ORIGIN}/job-type/${archive}/`
    : `${ORIGIN}/job-type/${archive}/page/${page}/`

  const res = await fetch(url, {
    headers: {
      Accept: "text/html",
      // Cloudflare in front of WordPress; the default Deno agent is refused.
      "User-Agent": "Mozilla/5.0 (compatible; VantagePipeline/1.0)",
    },
  })
  if (!res.ok) throw new Error(`NGO Jobs in Africa returned ${res.status} for ${url}`)
  return await res.text()
}

export async function fetchNgoJobsAfrica(now = new Date()): Promise<Notice[]> {
  const notices: Notice[] = []
  const seen = new Set<string>()

  for (const archive of ARCHIVES) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const html = await fetchPage(archive, page)

      for (const notice of parseNgoJobsAfrica(html, now)) {
        if (seen.has(notice.externalId)) continue
        seen.add(notice.externalId)
        notices.push(notice)
      }

      // Past the lookback window, or the archive has run out of listings.
      if (pageIsOld(html, now)) break
      if (!/<article[^>]*\bnoo_job\b/i.test(html)) break
    }
  }

  return notices
}
