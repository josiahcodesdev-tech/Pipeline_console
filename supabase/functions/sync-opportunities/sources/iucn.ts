/**
 * IUCN — the procurement portal at procurement.iucn.org.
 *
 * IUCN retired its old "Currently running tenders" page (it now answers every
 * automated request with "Access denied") and moved tendering to a portal. The
 * portal is a JavaScript app, but the list behind its public overview is a plain
 * JSON endpoint that needs no login: `GET /api/procurement/public-list/`. It
 * returns every procurement on the portal, open or closed — about 250 — so this
 * keeps the ones still taking proposals and lets the shared filters decide
 * relevance.
 *
 * Undocumented, like UNGM's. If this source starts failing, open the portal's
 * overview page with the browser's network tab and compare the request.
 */

import {
  type Notice,
  isRelevant,
  parseDate,
  scoreFit,
  serviceAreasFor,
  stillOpen,
  text,
} from "../normalize.ts"

const ORIGIN = "https://procurement.iucn.org"
const LIST = `${ORIGIN}/api/procurement/public-list/`

/**
 * IUCN's own category labels for advisory work. Everything else on the portal
 * is goods and works — equipment, construction materials, printing, travel.
 */
const ADVISORY_TYPE = /consult|professional fees/i

/** Stages in which the portal is still accepting responses. */
const OPEN_STAGE = /awaiting_proposals|pre_qualification(?!_evaluation)/i

interface Procurement {
  id?: unknown
  short_title?: unknown
  name?: unknown
  type?: unknown
  stage?: unknown
  nav_company?: unknown
  requisitioning_unit?: unknown
  country_of_performance?: unknown
  pre_qualification_response_deadline?: unknown
  tech_financial_response_deadline?: unknown
  requires_pre_qualification?: unknown
}

export function parseIucn(rows: unknown, now = new Date()): Notice[] {
  if (!Array.isArray(rows)) return []
  const notices: Notice[] = []
  const seen = new Set<string>()

  for (const row of rows as Procurement[]) {
    const id = text(row.id)
    const title = text(row.short_title) || text(row.name)
    const type = text(row.type)
    if (!id || !title || seen.has(id)) continue
    if (!ADVISORY_TYPE.test(type)) continue
    if (row.stage && !OPEN_STAGE.test(text(row.stage))) continue

    // Pre-qualification, when a tender has it, closes first and is the
    // deadline a bidder has to meet next.
    const deadline = parseDate(
      row.requires_pre_qualification === true
        ? row.pre_qualification_response_deadline ?? row.tech_financial_response_deadline
        : row.tech_financial_response_deadline ?? row.pre_qualification_response_deadline,
    )
    if (!stillOpen(deadline, now)) continue
    if (!isRelevant(title)) continue

    seen.add(id)
    notices.push({
      externalId: `iucn:${id}`,
      title,
      org: text(row.nav_company) || "IUCN",
      deadline,
      link: `${ORIGIN}/procurement/bidder/detail?id=${encodeURIComponent(id)}`,
      location: text(row.country_of_performance),
      source: "IUCN",
      opportunityType: "rfp",
      serviceAreas: serviceAreasFor(title),
      fitScore: scoreFit(title),
    })
  }

  return notices
}

export async function fetchIucn(now = new Date()): Promise<Notice[]> {
  const res = await fetch(LIST, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    },
  })
  if (!res.ok) throw new Error(`IUCN returned ${res.status}`)
  return parseIucn(await res.json(), now)
}
