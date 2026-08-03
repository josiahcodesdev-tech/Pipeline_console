/**
 * World Bank — Procurement Notices API.
 *
 * The best-behaved source by a wide margin: plain JSON, no key, no rate limit,
 * and filters that actually bind server-side.
 *
 * `procurement_group=CS` (Consultant Services) is a far better relevance signal
 * than any keyword list, so this source does NOT run through isRelevant() — the
 * Bank has already told us these are consultancy assignments. Within CS the
 * only two notice types are "Request for Expression of Interest" and "Contract
 * Award"; awards are results rather than opportunities and carry no deadline,
 * so filtering to REOI server-side drops them cleanly.
 *
 * Sorted newest-first and cut by LOOKBACK_DAYS rather than requesting a date
 * range, because the API exposes no date-range parameter. At roughly 15 CS
 * notices a day worldwide, one page of 500 is weeks of headroom.
 */

import {
  type Notice,
  decodeEntities,
  isRelevant,
  parseDate,
  serviceAreasFor,
  stillOpen,
  text,
  withinLookback,
} from "../normalize.ts"

const ENDPOINT = "https://search.worldbank.org/api/v2/procnotices"
const ROWS = 500

interface WbNotice {
  id?: unknown
  notice_type?: unknown
  noticedate?: unknown
  submission_deadline_date?: unknown
  project_ctry_name?: unknown
  project_name?: unknown
  bid_description?: unknown
  contact_organization?: unknown
  notice_text?: unknown
  notice_status?: unknown
}

export function parseWorldBank(payload: unknown, now = new Date()): Notice[] {
  const rows = (payload as { procnotices?: unknown })?.procnotices
  if (!Array.isArray(rows)) {
    throw new Error("World Bank: unexpected response shape (no procnotices array)")
  }

  const notices: Notice[] = []

  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue
    const item = row as WbNotice

    const id = text(item.id)
    if (!id) continue

    // `bid_description` is the assignment title. It is occasionally blank, in
    // which case the project name is the only human-readable label available.
    const title = decodeEntities(text(item.bid_description)) ||
      decodeEntities(text(item.project_name))
    if (!title) continue

    // Belt and braces: the request already filters to REOI, but a notice type
    // added later should not slip awards back in.
    if (/contract award/i.test(text(item.notice_type))) continue

    const published = parseDate(item.noticedate)
    if (!withinLookback(published, now)) continue

    const deadline = parseDate(item.submission_deadline_date)
    if (!stillOpen(deadline, now)) continue

    const country = decodeEntities(text(item.project_ctry_name))
    const org = decodeEntities(text(item.contact_organization)) || "World Bank"

    // `procurement_group=CS` proves it is consultancy, not that it is OUR
    // consultancy — the same bucket carries environmental impact studies,
    // procurement specialists and engineering design. This source used to skip
    // isRelevant on the strength of the structural filter alone, which is why
    // the tracker filled with advisory work nobody here could bid.
    if (!isRelevant(title)) continue

    notices.push({
      externalId: `worldbank:${id}`,
      title,
      org,
      deadline,
      // The API returns no canonical permalink, but this route resolves by id.
      link: `https://projects.worldbank.org/en/projects-operations/procurement-detail/${id}`,
      location: country,
      source: "World Bank",
      opportunityType: "rfp",
      // Title only. The flattened body is a whole HTML table of boilerplate and
      // tagging against it made almost everything look like Training — these
      // areas are a filter facet, so a false positive costs more than a miss.
      serviceAreas: serviceAreasFor(title),
    })
  }

  return notices
}

export async function fetchWorldBank(now = new Date()): Promise<Notice[]> {
  const url = new URL(ENDPOINT)
  url.searchParams.set("format", "json")
  url.searchParams.set("rows", String(ROWS))
  url.searchParams.set("os", "0")
  url.searchParams.set("procurement_group_exact", "CS")
  url.searchParams.set("notice_type_exact", "Request for Expression of Interest")
  url.searchParams.set("sort", "noticedate")
  url.searchParams.set("order", "desc")

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } })
  if (!res.ok) throw new Error(`World Bank returned ${res.status}`)
  return parseWorldBank(await res.json(), now)
}
