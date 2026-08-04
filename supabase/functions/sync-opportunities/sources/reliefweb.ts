/**
 * ReliefWeb — jobs API, filtered to consultancies.
 *
 * The strongest source for the kind of work this business bids on: NGO and UN
 * consultancy, evaluation and training assignments, well tagged and with real
 * closing dates.
 *
 * DORMANT UNTIL AN APPNAME IS APPROVED. Since 1 November 2025 the API rejects
 * any request whose `appname` has not been pre-registered — an unregistered one
 * gets 403 "You are not using an approved appname", not a rate limit. Request
 * one at https://apidoc.reliefweb.int/parameters#appname, then set
 *
 *   supabase secrets set RELIEFWEB_APPNAME=<the approved name>
 *
 * and this source starts contributing on the next run with no code change.
 * Until then the handler skips it and says so in the sync report.
 *
 * v1 was decommissioned; v2 is documented as fully compatible with it, so the
 * response shape below is the long-standing {data: [{id, fields}]} envelope.
 *
 * Note this reads the JOBS collection, not reports. ReliefWeb files consultancy
 * and training assignments as jobs of type "Consultancy" — that taxonomy value
 * is a far better filter than any keyword, so it is applied server-side.
 */

import {
  type Notice,
  decodeEntities,
  isRelevant,
  parseDate,
  scoreFit,
  serviceAreasFor,
  stillOpen,
  text,
  withinLookback,
} from "../normalize.ts"

const ENDPOINT = "https://api.reliefweb.int/v2/jobs"
const LIMIT = 200

interface RwField {
  name?: unknown
  shortname?: unknown
}

interface RwJob {
  id?: unknown
  fields?: {
    title?: unknown
    url?: unknown
    date?: { created?: unknown; closing?: unknown }
    source?: RwField[]
    country?: RwField[]
    career_categories?: RwField[]
    theme?: RwField[]
  }
}

const names = (list: RwField[] | undefined): string[] =>
  (list ?? []).map((entry) => text(entry?.name)).filter(Boolean)

export function parseReliefWeb(payload: unknown, now = new Date()): Notice[] {
  const rows = (payload as { data?: unknown })?.data
  if (!Array.isArray(rows)) {
    throw new Error("ReliefWeb: unexpected response shape (no data array)")
  }

  const notices: Notice[] = []

  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue
    const job = row as RwJob
    const fields = job.fields ?? {}

    const id = text(job.id)
    const title = decodeEntities(text(fields.title))
    if (!id || !title) continue

    const published = parseDate(fields.date?.created)
    if (!withinLookback(published, now)) continue

    const deadline = parseDate(fields.date?.closing)
    if (!stillOpen(deadline, now)) continue

    const categories = names(fields.career_categories)
    const themes = names(fields.theme)
    // The server-side type filter already did the heavy lifting; this catches
    // the staff-vacancy-shaped consultancies that slip through it.
    if (!isRelevant(title, categories.join(" "), themes.join(" "))) continue

    const org = names(fields.source)[0] ?? "ReliefWeb"
    const country = names(fields.country).join(", ")

    notices.push({
      externalId: `reliefweb:${id}`,
      title,
      org,
      deadline,
      link: text(fields.url) || `https://reliefweb.int/node/${id}`,
      location: country,
      source: "ReliefWeb",
      // ReliefWeb files these under jobs, and the tracker's type filter uses
      // the feed's own framing rather than second-guessing it.
      opportunityType: "job",
      serviceAreas: serviceAreasFor(title, categories.join(" "), themes.join(" ")),
      fitScore: scoreFit(title, categories.join(" "), themes.join(" ")),
    })
  }

  return notices
}

export async function fetchReliefWeb(appname: string, now = new Date()): Promise<Notice[]> {
  if (!appname) throw new Error("ReliefWeb: RELIEFWEB_APPNAME is not set")

  const url = new URL(ENDPOINT)
  url.searchParams.set("appname", appname)
  url.searchParams.set("limit", String(LIMIT))
  url.searchParams.set("sort[]", "date.created:desc")
  // Consultancy assignments only — excludes permanent and volunteer postings.
  url.searchParams.set("filter[field]", "type.name")
  url.searchParams.set("filter[value]", "Consultancy")
  for (const field of [
    "title", "url", "date.created", "date.closing",
    "source.name", "country.name", "career_categories.name", "theme.name",
  ]) {
    url.searchParams.append("fields[include][]", field)
  }

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } })
  if (res.status === 403) {
    throw new Error(
      "ReliefWeb rejected the appname (403). It must be pre-approved — see apidoc.reliefweb.int/parameters#appname",
    )
  }
  if (!res.ok) throw new Error(`ReliefWeb returned ${res.status}`)
  return parseReliefWeb(await res.json(), now)
}
