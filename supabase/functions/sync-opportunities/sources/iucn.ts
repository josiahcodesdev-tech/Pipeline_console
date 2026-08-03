/**
 * IUCN — legacy "Currently running tenders" page.
 *
 * The weakest source here, deliberately kept anyway. IUCN has moved to a
 * JavaScript portal at procurement.iucn.org with no API, no RSS and its scopes
 * of work as PDF attachments; the page scraped below is the old static table
 * they have said will be retired once its listed tenders close.
 *
 * As of writing every deadline in its "Open tenders" table has already passed,
 * so this connector legitimately returns close to nothing. That is the source
 * being stale rather than the parser being broken — do not "fix" it by
 * loosening stillOpen(). If IUCN coverage starts mattering, the real work is
 * reaching procurement.iucn.org, which needs a rendering step an Edge Function
 * cannot provide.
 *
 * Structure: a plain <table> under an "Open tenders" heading, columns
 *   Submission Deadline | RfP Title and Link | IUCN Office | Country | ...
 * A second table of tenders under evaluation follows it, which is why this
 * slices the document at the heading rather than reading every table.
 */

import {
  type Notice,
  decodeEntities,
  isRelevant,
  parseDate,
  serviceAreasFor,
  stillOpen,
  stripTags,
} from "../normalize.ts"

const PAGE = "https://iucn.org/procurement/currently-running-tenders"
const ORIGIN = "https://iucn.org"

/** Turns a title into a stable id — IUCN publishes no notice reference. */
function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

export function parseIucn(html: string, now = new Date()): Notice[] {
  // Everything from the "Open tenders" heading to the next heading. Without
  // this the "under evaluation" table below it would be scraped as live work.
  const start = html.search(/<h2[^>]*>\s*(?:<strong>)?\s*Open tenders/i)
  if (start === -1) return []
  const rest = html.slice(start + 1)
  const end = rest.search(/<h2[^>]*>/i)
  const section = end === -1 ? rest : rest.slice(0, end)

  const notices: Notice[] = []
  const seen = new Set<string>()

  for (const row of section.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []
    const [deadlineCell = "", titleCell = "", officeCell = "", countryCell = ""] = cells
    if (!deadlineCell || !titleCell) continue

    // The header row repeats the column names.
    if (/submission deadline/i.test(stripTags(deadlineCell))) continue

    // The title is bolded ahead of the attachment links; falling back to the
    // whole cell would drag in every "download" label with it.
    const bold = titleCell.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)
    const title = stripTags(bold?.[1] ?? titleCell).slice(0, 300)
    if (!title) continue

    const deadline = parseDate(stripTags(deadlineCell))
    if (!stillOpen(deadline, now)) continue

    const office = stripTags(officeCell)
    const country = stripTags(countryCell)
    if (!isRelevant(title)) continue

    const id = slug(title)
    if (!id || seen.has(id)) continue
    seen.add(id)

    // First attachment is the RfP itself; the rest are declaration templates.
    const href = titleCell.match(/href="([^"]+)"/i)?.[1] ?? ""
    const link = href
      ? decodeEntities(href.startsWith("http") ? href : `${ORIGIN}${href}`)
      : PAGE

    notices.push({
      externalId: `iucn:${id}`,
      title,
      org: office && !/^tbd$/i.test(office) ? `IUCN — ${office}` : "IUCN",
      deadline,
      link,
      location: /^tbd$/i.test(country) ? "" : country,
      source: "IUCN",
      opportunityType: "rfp",
      serviceAreas: serviceAreasFor(title),
    })
  }

  return notices
}

export async function fetchIucn(now = new Date()): Promise<Notice[]> {
  const res = await fetch(PAGE, {
    headers: {
      Accept: "text/html",
      // Drupal behind a WAF; the default Deno agent gets a 403.
      "User-Agent": "Mozilla/5.0 (compatible; VantagePipeline/1.0)",
    },
  })
  if (!res.ok) throw new Error(`IUCN returned ${res.status}`)
  return parseIucn(await res.text(), now)
}
