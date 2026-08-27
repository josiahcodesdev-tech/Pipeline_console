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
 * HOW CLOSE IT GETS TO THE DESIGN. Closer than it looks like it should, because
 * Word's layout engine is roughly IE6 — no flexbox, no CSS grid — but it is
 * genuinely good at tables, and every layout in this template is a fixed-column
 * grid. `.grid-2` is two columns, `.stat-grid` is four, `.steps` is seven. Each
 * becomes a table of the same width, so the cards, stat rows and step trains sit
 * side by side rather than unrolling into a column of paragraphs. See TABLEIZE.
 *
 * WHAT STILL WILL NOT SURVIVE, and no amount of work here changes it: rounded
 * corners, box shadows, and multi-stop gradients. Word has no equivalent, drops
 * them, and squares off every card. The proposal reads correctly and is laid out
 * correctly; it is not pixel-identical, and it cannot be.
 *
 * So "Open proposal" stays the primary action beside this one — it renders the
 * real thing, and its Print / Save PDF is the route to a document that IS
 * pixel-identical. Word is the route to one somebody can edit.
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

/**
 * The template's layouts, and how many columns each one has.
 *
 * Read out of the stylesheet's own `grid-template-columns` rather than guessed:
 * `.grid-4` really is `repeat(4,minmax(0,1fr))`. A layout not listed here is
 * left alone, which is the safe default — an unconverted grid stacks, and a
 * wrongly converted one loses cells off the side of the page.
 *
 * `null` means a horizontal flex row of unknown length: one cell per child,
 * however many there are.
 */
const TABLEIZE: ReadonlyArray<{ selector: string; columns: number | null }> = [
  { selector: '.cover-grid', columns: 2 },
  { selector: '.pill-row', columns: 3 },
  { selector: '.grid-2', columns: 2 },
  { selector: '.grid-3', columns: 3 },
  { selector: '.grid-4', columns: 4 },
  { selector: '.stat-grid', columns: 4 },
  { selector: '.steps', columns: 7 },
  { selector: '.gallery', columns: 3 },
  { selector: '.brand', columns: null },
  { selector: '.side-actions', columns: null },
  { selector: '.footer', columns: null },
]

/**
 * Rebuilds one grid container as a table.
 *
 * The children become cells, in order, wrapping to a new row every `columns`.
 * Equal widths are set explicitly — Word distributes by content otherwise, and
 * a four-card stat row where one card has a longer caption comes out with four
 * different widths, which reads as a mistake rather than a design.
 *
 * The gap becomes `border-spacing`, so the cards keep their air. Word honours
 * that on a `border-collapse: separate` table and ignores the CSS `gap` it was
 * written with.
 */
function tableize(document_: Document, container: Element, columns: number | null): void {
  const children = Array.from(container.children)
  if (children.length === 0) return

  const perRow = columns ?? children.length
  const table = document_.createElement('table')
  table.setAttribute('role', 'presentation')
  table.setAttribute(
    'style',
    'width:100%; border-collapse:separate; border-spacing:8px 8px; table-layout:fixed;',
  )

  const width = `${(100 / perRow).toFixed(4)}%`
  for (let index = 0; index < children.length; index += perRow) {
    const row = document_.createElement('tr')
    const slice = children.slice(index, index + perRow)
    for (const child of slice) {
      const cell = document_.createElement('td')
      // No border on the layout cell itself: the card inside carries its own,
      // and a bordered cell around a bordered card draws the grid twice.
      cell.setAttribute('style', `width:${width}; vertical-align:top; border:none; padding:0;`)
      cell.append(child)
      row.append(cell)
    }
    // A short last row would otherwise stretch its cells across the full width.
    for (let pad = slice.length; pad < perRow; pad += 1) {
      const filler = document_.createElement('td')
      filler.setAttribute('style', `width:${width}; border:none; padding:0;`)
      row.append(filler)
    }
    table.append(row)
  }

  container.replaceWith(table)
}

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

  // Layout, before the page breaks are set: converting a container replaces
  // the element, and a break written onto the old one would go with it.
  //
  // Innermost first. A `.grid-2` inside a `.cover-grid` has to become a table
  // while it is still in the tree — convert the outer one first and the inner
  // one moves into a cell and is never visited.
  for (const { selector, columns } of [...TABLEIZE].reverse()) {
    const containers = Array.from(parsed.querySelectorAll(selector)).reverse()
    for (const container of containers) tableize(parsed, container, columns)
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
    /* Real data tables. Layout tables set their own borderless style inline,
       which wins over this, so the two do not fight. */
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
