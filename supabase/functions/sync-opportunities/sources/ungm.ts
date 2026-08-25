/**
 * UNGM — United Nations Global Marketplace.
 *
 * The widest single source here: UNGM is the shared front door for 30-odd UN
 * agencies (FAO, UNICEF, WFP, UNOPS, WHO...), so it covers agencies that have
 * no feed of their own.
 *
 * There is no public API. The listing page renders its results by POSTing to
 * an internal endpoint that answers with an HTML fragment of table rows, and
 * that is what this reads. Being undocumented, it can change without notice —
 * if this source starts returning zero, compare a browser's network tab for
 * /Public/Notice/Search against the request below before assuming the parser
 * is at fault. The request must look like the page's own: the endpoint needs
 * form encoding and the XMLHttpRequest header, and returns an error page
 * without them.
 *
 * Notices are filtered on UNGM's own type label rather than keywords where
 * possible — "Request for proposal" and "Expression of interest" are the
 * consultancy shapes; "Invitation to bid" and "Request for quotation" are
 * goods and works, and are dropped.
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

const ORIGIN = "https://www.ungm.org"
const SEARCH = `${ORIGIN}/Public/Notice/Search`

/**
 * The endpoint caps a page at 15 rows and ignores any larger PageSize — but it
 * still requires the field to be present, and answers with an error page when
 * it is missing. Paging is the only way to reach depth.
 */
const PAGE_SIZE = 15

/**
 * UNGM publishes 60+ notices a day across all its agencies, so the seven-day
 * LOOKBACK_DAYS window would be roughly thirty requests every morning. Twenty
 * pages covers about three days, which is ample overlap for a job that runs
 * daily, and the loop stops early anyway once a page falls out of the window.
 */
const MAX_PAGES = 20

/** UNGM's own notice-type labels for advisory work. */
const CONSULTANCY_TYPE = /request for proposal|expression of interest|request for eoi/i

function cell(row: string, pattern: RegExp): string {
  return stripTags(row.match(pattern)?.[1] ?? "")
}

export function parseUngm(html: string, now = new Date()): {
  notices: Notice[]
  /** Number of rows on the page, before any filtering — drives paging. */
  rows: number
  /** True when every row on the page predates the lookback window. */
  exhausted: boolean
} {
  const notices: Notice[] = []
  const seen = new Set<string>()
  let rows = 0
  let sawRecent = false

  // Rows are delimited by the next row's opening tag rather than a closing tag,
  // because each row contains nested divs that a lazy </div> match would trip on.
  const matches = html.matchAll(
    /<div role="row"[^>]*data-noticeid="(\d+)"[\s\S]*?(?=<div role="row"|<script|$)/gi,
  )

  for (const match of matches) {
    const row = match[0]
    const id = match[1]
    rows += 1
    if (!id || seen.has(id)) continue

    // Two plain cells carry bare text: published date, then country. The type
    // cell looks similar but wraps its text in a <label>, so requiring a
    // non-tag first character skips it. Read before any other filter so that
    // paging is driven by the page's real age rather than by what survived.
    const plain = [...row.matchAll(/<div role="cell" class="tableCell">\s*<span>\s*([^<]+?)\s*<\/span>/gi)]
      .map((m) => m[1].trim())
    const published = parseDate(plain[0] ?? "")
    const country = plain[1] ?? ""
    if (!withinLookback(published, now)) continue
    sawRecent = true

    const title = cell(row, /class="ungm-title[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
    if (!title) continue

    // The type label sits inside its own <label for='...'> in the type cell.
    const noticeType = cell(row, /<label for='([^']*)'/i)
    if (noticeType && !CONSULTANCY_TYPE.test(noticeType)) continue

    // "17-Aug-2026 23:59 (GMT 4.30)" — parseDate reads the leading date.
    const deadline = parseDate(cell(row, /data-description="Deadline"[^>]*>\s*<span>([\s\S]*?)<\/span>/i))
    if (!stillOpen(deadline, now)) continue

    // noticeType stays in the subject: it is the portal's own short label for
    // what the contract is, which is exactly what the exclusions read.
    if (!isRelevant(`${title} ${noticeType}`)) continue

    const agency = cell(row, /class="tableCell resultAgency"[^>]*>\s*<span>([\s\S]*?)<\/span>/i)

    seen.add(id)
    notices.push({
      externalId: `ungm:${id}`,
      title,
      org: agency || "United Nations",
      deadline,
      link: `${ORIGIN}/Public/Notice/${id}`,
      location: country,
      source: agency ? `UNGM — ${agency}` : "UNGM",
      opportunityType: "rfp",
      serviceAreas: serviceAreasFor(title),
      fitScore: scoreFit(title),
    })
  }

  return { notices, rows, exhausted: rows > 0 && !sawRecent }
}

async function page(index: number): Promise<string> {
  const res = await fetch(SEARCH, {
    method: "POST",
    headers: {
      // Both of these are load-bearing — without them the endpoint answers
      // with a generic error page rather than the results fragment.
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${ORIGIN}/Public/Notice`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    },
    // PageSize is required even though it is capped — omitting it returns an
    // error page rather than defaulting.
    body: new URLSearchParams({
      PageIndex: String(index),
      PageSize: String(PAGE_SIZE),
      SortField: "DatePublished",
      SortAscending: "false",
    }).toString(),
  })
  if (!res.ok) throw new Error(`UNGM returned ${res.status}`)
  return res.text()
}

export async function fetchUngm(now = new Date()): Promise<Notice[]> {
  const all: Notice[] = []
  const seen = new Set<string>()

  for (let index = 0; index < MAX_PAGES; index += 1) {
    let html: string
    try {
      html = await page(index)
    } catch (cause) {
      // Losing a later page should not throw away the ones already read.
      if (index === 0) throw cause
      break
    }

    const { notices, rows, exhausted } = parseUngm(html, now)
    for (const notice of notices) {
      if (seen.has(notice.externalId)) continue
      seen.add(notice.externalId)
      all.push(notice)
    }

    // An empty page means the end of the result set; an entirely stale one
    // means every page after it is stale too, since these are newest-first.
    if (rows === 0 || exhausted) break
  }

  return all
}
