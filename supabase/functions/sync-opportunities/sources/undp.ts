/**
 * UNDP — Procurement Notices RSS.
 *
 * RSS 1.0 (RDF), refreshed hourly, no key. The global feed carries every open
 * notice UNDP has worldwide.
 *
 * Two things about this feed are worth knowing before changing anything here:
 *
 * 1. It is NOT a list of current tenders. Alongside live notices it carries
 *    evergreen guidance items — "HOW TO REGISTER AND SUBMIT A BID", supplier
 *    information sessions — published years ago with deadlines set far in the
 *    future (2030, 2037) so they never expire off the list. Filtering on the
 *    deadline would keep every one of them; filtering on the PUBLICATION date
 *    is what actually drops them, which is why withinLookback runs against
 *    <dc:date> here.
 *
 * 2. It is served as ISO-8859-1, not UTF-8. Decoding it as UTF-8 mangles every
 *    accented character in the French and Spanish notices, so the fetch below
 *    decodes explicitly rather than calling res.text().
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

const FEED = "https://procurement-notices.undp.org/rss_feeds/rss.xml"

/**
 * Pulls one tag's text out of an item block.
 *
 * Regex rather than a DOM parser: this is machine-generated XML with a fixed
 * shape, and the Edge runtime has no built-in DOMParser — pulling in deno_dom
 * to read four fields would cost more than it returns.
 */
function tag(block: string, name: string): string {
  const match = block.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"),
  )
  return match ? decodeEntities(match[1].replace(/<[^>]+>/g, " ")).trim() : ""
}

export function parseUndp(xml: string, now = new Date()): Notice[] {
  // Items sit at the document root in RSS 1.0, not nested inside <channel>.
  const blocks = xml.match(/<item\s+rdf:about=[\s\S]*?<\/item>/gi) ?? []
  const notices: Notice[] = []
  const seen = new Set<string>()

  for (const block of blocks) {
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "").trim()

    // The feed uses two URL shapes for the same thing — view_notice.cfm?notice_id
    // for open advertisements and view_negotiation.cfm?nego_id for competitive
    // negotiations. Either number is a stable per-notice id.
    const id = link.match(/(?:notice_id|nego_id)=(\d+)/i)?.[1]
    if (!id || seen.has(id)) continue

    const rawTitle = tag(block, "title")
    if (!rawTitle) continue

    // Titles read "REF - Assignment - Office - COUNTRY", country last and
    // uppercased. Every part except the assignment itself is optional, and the
    // reference code is frequently repeated at the head of the assignment too
    // ("UNDP-MDG-00855 - UNDP-MDG-00855 EVALUATION..."), so each piece is
    // peeled off defensively rather than by fixed position.
    const segments = rawTitle.split(" - ").map((part) => part.trim()).filter(Boolean)
    const country = segments.length > 1 ? segments.pop() ?? "" : ""

    // Trailing office segment, e.g. "UNDP", "UNDP Country Office for A2J".
    let office = ""
    if (segments.length > 1 && /^undp\b/i.test(segments[segments.length - 1])) {
      office = segments.pop() ?? ""
    }

    // Leading reference code, dropped only when the next segment repeats it —
    // otherwise it is the only identifier the notice has and is worth keeping.
    if (segments.length > 1 && /^[A-Z]{2,}[-/][A-Z0-9-]+$/i.test(segments[0])) {
      if (segments[1].toUpperCase().startsWith(segments[0].toUpperCase())) segments.shift()
    }

    const title = segments.join(" - ") || rawTitle

    const published = parseDate(tag(block, "dc:date"))
    if (!withinLookback(published, now)) continue

    // "Application Deadline: 14-Aug-26" — the date is prose inside description.
    const description = tag(block, "description")
    const deadline = parseDate(description.replace(/application deadline:?/i, ""))
    if (!stillOpen(deadline, now)) continue

    if (!isRelevant(title, description)) continue

    seen.add(id)
    notices.push({
      externalId: `undp:${id}`,
      title,
      // "UNDP — UNDP" reads as a bug, so a bare office name collapses to UNDP.
      org: office && !/^undp$/i.test(office) ? `UNDP — ${office}` : "UNDP",
      deadline,
      link,
      location: country,
      source: "UNDP",
      opportunityType: "rfp",
      serviceAreas: serviceAreasFor(title, description),
      fitScore: scoreFit(title, description),
    })
  }

  return notices
}

export async function fetchUndp(now = new Date()): Promise<Notice[]> {
  // No Accept header: the server 406s on anything more specific than */*.
  const res = await fetch(FEED)
  if (!res.ok) throw new Error(`UNDP returned ${res.status}`)

  // See the note at the top of this file — this feed is latin1, and res.text()
  // would decode it as UTF-8 and corrupt every accented character.
  const buffer = await res.arrayBuffer()
  const xml = new TextDecoder("iso-8859-1").decode(buffer)

  return parseUndp(text(xml), now)
}
