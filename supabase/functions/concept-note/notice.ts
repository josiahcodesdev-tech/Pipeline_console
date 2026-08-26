/**
 * Fetching a published notice and reducing it to readable text.
 *
 * Server-side because it has to be: these portals send no CORS header, so a
 * browser cannot read them at all. It is the same reason the opportunity sync
 * lives in a function rather than in the page.
 *
 * Deliberately crude. A real HTML-to-text library would handle a dozen edge
 * cases better, but the output here is not shown to anyone — it is fed to a
 * model that is tolerant of ragged input and intolerant of missing input. The
 * failure that matters is fetching nothing, not fetching something untidy.
 */

/** Long enough for a full ToR page, short enough to leave room to think. */
export const MAX_NOTICE_CHARS = 40_000
const MAX_NOTICE_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 5

/** Nothing useful was found — the caller should say so rather than pretend. */
export interface NoticeResult {
  text: string
  /** Readable one-liner when the fetch failed, for the bid team. */
  problem: string | null
}

const BLOCKED = /^(javascript|data|file|mailto):/i

function unsafeIp(value: string): boolean {
  const ip = value.toLowerCase().replace(/^\[|\]$/g, '')
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (mapped) return unsafeIp(mapped)
  if (ip.includes(':')) {
    return ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') ||
      /^fe[89ab]/.test(ip) || ip.startsWith('ff') || ip.startsWith('2001:db8:')
  }
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
}

async function safeUrl(value: string): Promise<URL> {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only ordinary HTTP and HTTPS notice links are allowed.')
  }
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || unsafeIp(host)) {
    throw new Error('Private or local network addresses are not allowed.')
  }
  const resolved = [
    ...await Deno.resolveDns(host, 'A').catch(() => [] as string[]),
    ...await Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]),
  ]
  if (resolved.length === 0 || resolved.some(unsafeIp)) {
    throw new Error('The notice hostname did not resolve to a safe public address.')
  }
  return url
}

async function limitedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_NOTICE_BYTES) {
    throw new Error('The notice page is too large to read safely.')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let output = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > MAX_NOTICE_BYTES) {
      await reader.cancel()
      throw new Error('The notice page is too large to read safely.')
    }
    output += decoder.decode(value, { stream: true })
  }
  return output + decoder.decode()
}

function stripHtml(html: string): string {
  return html
    // Script and style carry no prose and a great deal of noise.
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    // Block-level tags become newlines so the structure survives as paragraphs;
    // without this the whole page arrives as one unreadable run.
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

/**
 * ReliefWeb, which refuses to be scraped and offers an API instead.
 *
 * reliefweb.int answers an automated GET of any posting with 403 — not a stub,
 * not a rate limit, a flat refusal. Scraping it was therefore never going to
 * work, and the failure was invisible in the worst way: the fetch returned
 * nothing, the analyser wrote a reading from the title and whatever the sync
 * had scraped, and the result read exactly as confidently as one written from
 * the real notice.
 *
 * Their API serves the same posting in full, keyed by an appname that has to be
 * pre-approved. sync-opportunities already holds one in RELIEFWEB_APPNAME and
 * uses it to pull listings; this reuses the same secret to read one.
 *
 * The id is in the path: /job/4226834/slug, /report/4226834/slug, or a bare
 * /node/4226834. The collection differs by content type, and a /node/ link does
 * not say which, so that case tries each in turn.
 */
const RELIEFWEB_COLLECTIONS: Record<string, string> = {
  job: 'jobs',
  report: 'reports',
  training: 'training',
}

function isReliefWeb(url: URL): boolean {
  return /(^|\.)reliefweb\.int$/i.test(url.hostname)
}

function reliefWebTarget(url: URL): { id: string; collections: string[] } | null {
  if (!isReliefWeb(url)) return null
  const [kind, id] = url.pathname.split('/').filter(Boolean)
  if (!/^\d+$/.test(id ?? '')) return null
  const collection = RELIEFWEB_COLLECTIONS[(kind ?? '').toLowerCase()]
  // A /node/ link names no type, so ask each collection until one answers.
  return { id, collections: collection ? [collection] : Object.values(RELIEFWEB_COLLECTIONS) }
}

/** The parts of a ReliefWeb posting worth reading, as text. */
function reliefWebText(fields: Record<string, unknown>): string {
  const names = (value: unknown) =>
    Array.isArray(value)
      ? value.map((item) => String((item as Record<string, unknown>)?.name ?? '')).filter(Boolean).join(', ')
      : ''
  const date = (fields.date ?? {}) as Record<string, unknown>

  return [
    String(fields.title ?? ''),
    names(fields.source) ? `Source organisation: ${names(fields.source)}` : '',
    names(fields.country) ? `Country: ${names(fields.country)}` : '',
    fields.city ? `City: ${String(fields.city)}` : '',
    names(fields.type) ? `Type: ${names(fields.type)}` : '',
    names(fields.career_categories) ? `Category: ${names(fields.career_categories)}` : '',
    names(fields.experience) ? `Experience required: ${names(fields.experience)}` : '',
    date.closing ? `Closing date: ${String(date.closing)}` : '',
    date.created ? `Published: ${String(date.created)}` : '',
    '',
    String(fields.body ?? ''),
    fields.how_to_apply ? `\n## How to apply\n\n${String(fields.how_to_apply)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim()
}

async function fetchReliefWebNotice(
  target: { id: string; collections: string[] },
  signal: AbortSignal,
): Promise<NoticeResult> {
  const appname = Deno.env.get('RELIEFWEB_APPNAME') ?? ''
  if (!appname) {
    // Named rather than described as a generic failure. The fix is one secret,
    // and saying which turns a support question into a setting.
    return {
      text: '',
      problem:
        'ReliefWeb refuses automated page requests and its API needs RELIEFWEB_APPNAME, which is not set on this project.',
    }
  }

  for (const collection of target.collections) {
    const endpoint = new URL(`https://api.reliefweb.int/v2/${collection}/${target.id}`)
    endpoint.searchParams.set('appname', appname)
    endpoint.searchParams.set('profile', 'full')

    const response = await fetch(endpoint, { signal, headers: { Accept: 'application/json' } })
    if (response.status === 404) continue
    if (response.status === 403) {
      return {
        text: '',
        problem: 'ReliefWeb rejected the appname (403). It must be pre-approved — see apidoc.reliefweb.int/parameters#appname',
      }
    }
    if (!response.ok) {
      return { text: '', problem: `ReliefWeb answered ${response.status} for this posting.` }
    }

    const body = (await response.json()) as { data?: Array<{ fields?: Record<string, unknown> }> }
    const fields = body.data?.[0]?.fields
    if (!fields) continue

    const text = reliefWebText(fields).slice(0, MAX_NOTICE_CHARS)
    if (text) return { text, problem: null }
  }

  return { text: '', problem: 'ReliefWeb has no posting at this link.' }
}

export async function fetchNotice(link: string): Promise<NoticeResult> {
  const url = link.trim()
  if (!url || BLOCKED.test(url)) {
    return { text: '', problem: 'No usable link is stored against this tender.' }
  }
  if (!/^https?:\/\//i.test(url)) {
    return { text: '', problem: `The stored link is not a web address: ${url.slice(0, 80)}` }
  }

  try {
    // These portals are slow and some never answer. A hung fetch would burn the
    // function's whole budget and return nothing, so it is cut off well short.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    let current = await safeUrl(url)

    // Before the scrape, not as a fallback after it: reliefweb.int answers the
    // page request with 403 every time, so trying it first only spends the
    // timeout budget to learn what is already known. That is also why a
    // ReliefWeb link the API cannot address says so immediately rather than
    // falling through — a job link carries its id, a report link does not.
    if (isReliefWeb(current)) {
      const target = reliefWebTarget(current)
      try {
        return target
          ? await fetchReliefWebNotice(target, controller.signal)
          : {
              text: '',
              problem:
                'ReliefWeb refuses automated page requests, and this link carries no posting id to read through its API instead. Open it and attach the Terms of Reference.',
            }
      } finally {
        clearTimeout(timer)
      }
    }

    let response: Response | null = null
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      response = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
        // Several of these sites serve a stub to unknown agents.
        'User-Agent':
          'Mozilla/5.0 (compatible; VantageAfrica/1.0; +https://vantageafricaleaders.com)',
        Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.8,*/*;q=0.5',
        },
      })
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      const location = response.headers.get('location')
      if (!location || redirect === MAX_REDIRECTS) throw new Error('The notice redirected too many times.')
      current = await safeUrl(new URL(location, current).toString())
    }
    clearTimeout(timer)

    if (!response) throw new Error('The notice page returned no response.')

    if (!response.ok) {
      return {
        text: '',
        problem: `The notice page returned ${response.status}. It may have closed or moved.`,
      }
    }

    const type = response.headers.get('content-type') ?? ''
    if (type.includes('pdf')) {
      // Extracting PDF text needs a parser the browser already has and this
      // runtime does not. Saying so beats returning a page of binary.
      return {
        text: '',
        problem:
          'The link points straight at a PDF. Download it and attach it to this tender, which extracts the text properly.',
      }
    }

    const body = await limitedText(response)
    const text = stripHtml(body).slice(0, MAX_NOTICE_CHARS)

    // A page that reduces to almost nothing is a login wall or a JavaScript
    // shell, not a notice. Reporting that is more useful than a stub.
    if (text.length < 400) {
      return {
        text,
        problem:
          'The page returned almost no readable text — it is probably behind a login or built by JavaScript. Attach the ToR by hand.',
      }
    }

    return { text, problem: null }
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    return {
      text: '',
      problem: /abort/i.test(reason)
        ? 'The notice page did not respond within 20 seconds.'
        : `The notice page could not be read: ${reason}`,
    }
  }
}
