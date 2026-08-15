/**
 * The site a notice came from, as its bare host.
 *
 * `source` is the connector's own label — "NGO Jobs in Africa", "World Bank" —
 * which names the publisher but not where to go and look. This is the address,
 * read off the notice link so it can never drift from where the row actually
 * points: a source renamed in a connector still shows the site it came from.
 *
 * Returns '' for hand-entered rows with no link, which have no site to name.
 */
export function siteOf(link: string): string {
  if (!link) return ''
  try {
    return new URL(link).hostname.replace(/^www\./, '')
  } catch {
    // Notes pasted into the link field, mostly. Nothing to show.
    return ''
  }
}
