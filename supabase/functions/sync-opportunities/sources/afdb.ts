/**
 * African Development Bank — procurement listing.
 *
 * A Drupal view, scraped. There is no feed: /rss.xml on that path returns the
 * HTML page rather than XML, and the site has no documented API.
 *
 * EXPECT THIS ONE TO FAIL. www.afdb.org sits behind Cloudflare's "Just a
 * moment..." interstitial, which wants JavaScript and cookies before it serves
 * the page. It can be reached from a residential IP, but Edge Functions call
 * out from datacenter ranges that Cloudflare challenges far more aggressively,
 * so a 403 here is the expected outcome rather than a bug. The connector is
 * kept because the sync isolates each source — AfDB failing costs nothing, and
 * it starts working the day that challenge is relaxed or an allowlist appears.
 *
 * If AfDB coverage becomes important, the options are a headless-browser step
 * outside this runtime, or asking AfDB for feed access directly.
 *
 * Two other things shape this connector:
 *
 * 1. The listing carries a PUBLICATION date but no submission deadline — that
 *    lives on each notice's own page. Fetching ~30 detail pages at ~90KB each
 *    every morning is a lot of fragility to buy one field, so notices land with
 *    a null deadline and the link goes to the notice itself. They still show in
 *    the tracker, they just do not sort by urgency until someone opens one and
 *    fills the date in.
 *
 * 2. AfDB titles are prefixed with the notice type: EOI (expression of
 *    interest), AMI (the French equivalent), SPN (specific procurement notice,
 *    goods and works), PPM (procurement plan). Only the consultancy prefixes
 *    are wanted, and that prefix is a much stronger signal than any keyword —
 *    so it is checked before isRelevant() gets involved.
 */

import {
  type Notice,
  isRelevant,
  parseDate,
  scoreFit,
  serviceAreasFor,
  stripTags,
  withinLookback,
} from "../normalize.ts"

const ORIGIN = "https://www.afdb.org"
const LISTING = `${ORIGIN}/en/projects-and-operations/procurement`

/** Pages are roughly a day each; this is cover for LOOKBACK_DAYS plus slack. */
const MAX_PAGES = 8

/** Consultancy notices only. AMI is "Avis à Manifestation d'Intérêt". */
const CONSULTANCY_PREFIX = /^\s*(EOI|AMI|REOI|RFP|SSC)\b/i

export function parseAfdb(html: string, now = new Date()): {
  notices: Notice[]
  /** True when every row on the page predates the lookback window. */
  exhausted: boolean
} {
  const notices: Notice[] = []
  let sawRecent = false
  let sawAny = false

  // Each result is a publication-date field followed by a title field. Pairing
  // them positionally is what keeps a notice attached to its own date.
  const pattern =
    /views-field-field-publication-date[\s\S]{0,400}?content="([^"]+)"[\s\S]{0,400}?views-field-title[\s\S]{0,300}?<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi

  for (const match of html.matchAll(pattern)) {
    sawAny = true
    const published = parseDate(match[1])
    const href = match[2]
    const title = stripTags(match[3])
    if (!title || !href) continue

    if (withinLookback(published, now)) sawRecent = true
    else continue

    if (!CONSULTANCY_PREFIX.test(title)) continue

    // "EOI - Mauritius - Recruitment of a ..." — type, country, then the work.
    const segments = title.split(" - ").map((part) => part.trim()).filter(Boolean)
    const country = segments.length > 2 ? segments[1] : ""
    const subject = segments.length > 2 ? segments.slice(2).join(" - ") : title

    if (!isRelevant(subject)) continue

    // The document slug is unique and stable, and is the only id AfDB exposes.
    const slug = href.split("/").filter(Boolean).pop() ?? ""
    if (!slug) continue

    notices.push({
      externalId: `afdb:${slug}`,
      title: subject,
      org: "African Development Bank",
      // See the note at the top of this file — deadlines are not on the listing.
      deadline: null,
      link: href.startsWith("http") ? href : `${ORIGIN}${href}`,
      location: country,
      source: "AfDB",
      opportunityType: "rfp",
      serviceAreas: serviceAreasFor(subject),
      fitScore: scoreFit(subject),
    })
  }

  return { notices, exhausted: sawAny && !sawRecent }
}

export async function fetchAfdb(now = new Date()): Promise<Notice[]> {
  const all: Notice[] = []
  const seen = new Set<string>()

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = page === 0 ? LISTING : `${LISTING}?page=${page}`
    const res = await fetch(url, {
      headers: {
        Accept: "text/html",
        // Without a browser-shaped agent this endpoint answers 403.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
    })
    if (!res.ok) {
      // A later page failing should not discard the pages already read.
      if (page === 0) throw new Error(`AfDB returned ${res.status}`)
      break
    }

    const { notices, exhausted } = parseAfdb(await res.text(), now)
    for (const notice of notices) {
      if (seen.has(notice.externalId)) continue
      seen.add(notice.externalId)
      all.push(notice)
    }
    // Pages run newest-first, so once one is entirely outside the window every
    // page after it is too.
    if (exhausted) break
  }

  return all
}
