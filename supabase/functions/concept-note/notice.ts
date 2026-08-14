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

/** Nothing useful was found — the caller should say so rather than pretend. */
export interface NoticeResult {
  text: string
  /** Readable one-liner when the fetch failed, for the bid team. */
  problem: string | null
}

const BLOCKED = /^(javascript|data|file|mailto):/i

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
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Several of these sites serve a stub to unknown agents.
        'User-Agent':
          'Mozilla/5.0 (compatible; PipelineConsole/1.0; +https://vantageafricaleaders.com)',
        Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.8,*/*;q=0.5',
      },
    }).finally(() => clearTimeout(timer))

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

    const body = await response.text()
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
