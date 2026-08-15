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
export function safeExternalUrl(link: string): string {
  if (!link) return ''
  try {
    const url = new URL(link)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    return url.toString()
  } catch {
    return ''
  }
}

export function siteOf(link: string): string {
  const safe = safeExternalUrl(link)
  return safe ? new URL(safe).hostname.replace(/^www\./, '') : ''
}
