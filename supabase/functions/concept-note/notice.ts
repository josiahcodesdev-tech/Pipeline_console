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
    let response: Response | null = null
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      response = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
        // Several of these sites serve a stub to unknown agents.
        'User-Agent':
          'Mozilla/5.0 (compatible; PipelineConsole/1.0; +https://vantageafricaleaders.com)',
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
