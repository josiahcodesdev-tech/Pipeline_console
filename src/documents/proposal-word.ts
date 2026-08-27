import type { Rfp } from '@/domain/types'

/**
 * The designed proposal, as a file Word opens and edits.
 *
 * WHY NOT `downloadProposalDocx`. That builds a real .docx with the `docx`
 * library, from Markdown. The designed proposal is not Markdown — it is the
 * firm's HTML template with this tender's words in it — and the only Markdown
 * available for it is the flat text extraction, which has no headings, no
 * tables and no emphasis. Exporting through that route produces forty
 * paragraphs of undifferentiated prose: every fact present, every structure
 * gone.
 *
 * WHAT THIS DOES INSTEAD. Word reads HTML. Handing it an HTML document with a
 * `.doc` extension and the Word MIME type gets headings as headings, tables as
 * tables, bold as bold, and the section order intact — which is what somebody
 * downloading this wants to edit. It is a real Word document in the sense that
 * matters: it opens, it edits, it saves as .docx from there.
 *
 * WHAT IT COSTS, STATED PLAINLY. This is not the designed page. Word's HTML
 * engine is roughly a 2003 browser: no flexbox, no grid, no CSS variables. The
 * cards, the stat grids and the two-column layouts all linearise into ordinary
 * document flow. That is the honest trade for an editable file, and it is why
 * "Open proposal" — which renders the real thing and prints to PDF — stays the
 * primary action beside this one.
 */

/**
 * Everything that is page furniture rather than proposal.
 *
 * `button` and `[onclick]` are the ones that matter and the ones that are easy
 * to miss: the house template carries a "Print / Save PDF" and an "Enable edit
 * mode" control, and a button in Word is not a button — it is a line of text.
 * Left in, the document opens with "Print / Save PDF Enable edit mode" above
 * the cover, which reads as a broken export rather than a proposal.
 *
 * The contents list goes too. It is a column of links to anchors that do not
 * survive, and Word has its own way of building one.
 */
const CHROME = [
  'script',
  'nav',
  'button',
  '[onclick]',
  '.toc',
  '.toc-title',
  '.edit-note',
  '.toolbar',
  '.no-print',
  '[data-print="hide"]',
]

/**
 * CSS Word cannot honour, removed so it does not fight the layout it can.
 *
 * Left in, `display:grid` and `position:fixed` do not degrade — Word ignores
 * the property and keeps the element, which is fine — but `position:fixed` on a
 * sidebar puts it on top of the text on every page. Stripping the layout
 * properties lets everything fall into document order, which is the only order
 * Word has.
 */
const UNSUPPORTED = /(display\s*:\s*(flex|grid|inline-flex|inline-grid)|position\s*:\s*(fixed|sticky|absolute)|transform\s*:[^;]+|animation\s*:[^;]+|transition\s*:[^;]+);?/gi

function fileName(rfp: Rfp): string {
  const base = (rfp.title || 'Proposal')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${base} — proposal.doc`
}

/**
 * Rewrites the filled template into something Word will read.
 *
 * Deliberately conservative: this removes and flattens, it never rewrites
 * content. Anything it does not understand is left alone, because the failure
 * that matters here is a missing paragraph, not an ugly one.
 */
export function proposalWordHtml(html: string, rfp: Rfp): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html')

  for (const selector of CHROME) {
    for (const node of Array.from(parsed.querySelectorAll(selector))) node.remove()
  }

  // Word applies the last stylesheet it understands and ignores the rest, so
  // the template's own styles are kept — minus the properties that would place
  // things it cannot place.
  for (const style of Array.from(parsed.querySelectorAll('style'))) {
    style.textContent = (style.textContent ?? '').replace(UNSUPPORTED, '')
  }
  for (const node of Array.from(parsed.querySelectorAll('[style]'))) {
    const cleaned = (node.getAttribute('style') ?? '').replace(UNSUPPORTED, '')
    if (cleaned.trim()) node.setAttribute('style', cleaned)
    else node.removeAttribute('style')
  }

  // Each `section.page` is a page in the design, so it becomes a page break
  // here. Without this the whole proposal runs together and a nineteen-section
  // document arrives as one wall.
  const sections = Array.from(parsed.querySelectorAll('section.page, section, article'))
  sections.forEach((section, index) => {
    if (index === 0) return
    const existing = section.getAttribute('style') ?? ''
    section.setAttribute('style', `page-break-before: always; ${existing}`)
  })

  const body = parsed.body?.innerHTML ?? ''
  const styles = Array.from(parsed.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n')

  // The `xmlns:w` declaration and the `WordDocument` block are what make Word
  // open this as a document rather than offering to import it as a web page.
  // The @page rule is the only reliable way to set margins from HTML.
  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(rfp.title || 'Proposal')}</title>
  <!--[if gte mso 9]><xml>
    <w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument>
  </xml><![endif]-->
  <style>
    @page { size: A4; margin: 2cm; }
    body { font-family: 'Segoe UI', Calibri, Arial, sans-serif; font-size: 11pt; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #cccccc; padding: 6pt; vertical-align: top; }
    img { max-width: 100%; height: auto; }
${styles}
  </style>
</head>
<body>
${body}
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Saves the designed proposal as a Word file.
 *
 * A BOM in front of the markup, because Word decides the encoding of an HTML
 * file by sniffing rather than by trusting the charset meta — without it a
 * document full of en dashes and curly quotes opens as mojibake.
 */
export function downloadProposalWord(rfp: Rfp, html: string): void {
  const document_ = proposalWordHtml(html, rfp)
  const blob = new Blob(['﻿', document_], {
    type: 'application/msword;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = fileName(rfp)
  document.body.append(link)
  link.click()
  link.remove()

  // Released on a timer rather than immediately: revoking before the browser
  // has committed the download cancels it in Safari.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
