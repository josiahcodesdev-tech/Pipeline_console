/**
 * Pulls the text out of a tender document so the drafter can work from the real
 * scope rather than a one-line notice.
 *
 * NOT OCR, deliberately. Almost every tender that arrives by email is a digital
 * PDF with a text layer already in it — rasterising that and asking a model to
 * guess the characters back is strictly worse than reading what is there, as
 * well as slower and, for a hosted OCR, billed per page. OCR only wins on
 * genuinely scanned pages, which is why `scanned` is reported below rather than
 * papered over: a document that comes back empty needs a human to know it,
 * not a silent zero.
 *
 * pdf.js runs in the browser, so this costs no server time and no API key, and
 * the tender never leaves the machine.
 */

/** How much of a document is worth keeping. */
const MAX_CHARS = 60_000

export interface ExtractedPdf {
  text: string
  pages: number
  /** True when the file parsed but carried almost no text — i.e. it is scanned. */
  scanned: boolean
  /** True when the document was longer than MAX_CHARS and was cut. */
  truncated: boolean
}

/**
 * Rebuilds line structure from pdf.js text items.
 *
 * pdf.js returns positioned fragments, not lines — concatenating them yields
 * one long run with headings welded to body text, which is exactly the
 * structure the drafter needs to see. Items carry `hasEOL`, and a change in the
 * vertical transform marks a new line, so both are used: `hasEOL` where the
 * producer set it, and a y-shift as the fallback for the many that do not.
 */
interface PositionedItem {
  str?: string
  transform?: number[]
  width?: number
}

/** Reconstruct rows first, then preserve table-like gaps inside each row. */
function itemsToText(items: PositionedItem[]): string {
  const positioned = items
    .map((item) => ({
      text: item.str?.trim() ?? '',
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
      width: item.width ?? 0,
    }))
    .filter((item) => item.text)
    .sort((a, b) => Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x)

  const rows: typeof positioned[] = []
  for (const item of positioned) {
    const row = rows.find((candidate) => Math.abs(candidate[0].y - item.y) <= 2)
    if (row) row.push(item)
    else rows.push([item])
  }

  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x)
    let line = row[0].text
    let right = row[0].x + row[0].width
    for (const item of row.slice(1)) {
      const gap = item.x - right
      line += gap > 24 && row.length >= 3 ? ` | ${item.text}` : ` ${item.text}`
      right = Math.max(right, item.x + item.width)
    }
    return line
  }).join('\n')
}

/**
 * Reads a PDF and returns its text.
 *
 * `pdfjs-dist` is ~1 MB and only needed when someone actually uploads a tender,
 * so it is imported on demand rather than shipped in the main bundle — the same
 * treatment `docx` gets.
 */
export async function extractPdfText(file: File): Promise<ExtractedPdf> {
  const pdfjs = await import('pdfjs-dist')
  // Vite resolves this to a hashed URL at build time; without it pdf.js looks
  // for the worker on a path that does not exist in the built bundle.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const buffer = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buffer }).promise

  const parts: string[] = []
  let chars = 0
  let truncated = false

  for (let page = 1; page <= doc.numPages; page += 1) {
    if (chars >= MAX_CHARS) {
      truncated = true
      break
    }
    const content = await (await doc.getPage(page)).getTextContent()
    const pageText = itemsToText(content.items as PositionedItem[]).trim()
    const text = pageText ? `<!-- PAGE ${page} -->\n${pageText}` : ''
    if (!text) continue
    parts.push(text)
    chars += text.length
  }

  const joined = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  const text = joined.length > MAX_CHARS ? joined.slice(0, MAX_CHARS) : joined

  return {
    text,
    pages: doc.numPages,
    // A handful of characters across a whole document means the pages are
    // images. Reported so the UI can say so plainly.
    scanned: text.replace(/\s/g, '').length < doc.numPages * 40,
    truncated: truncated || joined.length > MAX_CHARS,
  }
}

export { MAX_CHARS as MAX_TENDER_CHARS }
