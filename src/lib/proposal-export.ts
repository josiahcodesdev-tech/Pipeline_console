import { formatDateLong, formatKes } from './dates'
import type { Rfp } from './types'

/**
 * Turns `**bold**` runs into real Word runs.
 *
 * Splitting on the delimiter rather than regex-replacing keeps the text intact
 * when a stray asterisk appears — an unmatched `**` just ends up in the prose,
 * which is the harmless failure.
 */
function inline(
  line: string,
  TextRun: typeof import('docx').TextRun,
  options: { size?: number; bold?: boolean; color?: string } = {},
) {
  return line.split('**').map(
    (part, index) =>
      new TextRun({
        text: part,
        // Odd segments sat between a matched pair of asterisks.
        bold: options.bold || index % 2 === 1,
        size: options.size,
        color: options.color,
      }),
  )
}

/** A `|`-delimited row, minus the outer pipes and trimmed. */
function cells(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/**
 * The `|---|:--:|` line under a table's header row, which is not data.
 *
 * Only ever applied to the second line of a table. A row of `| - | - |` is
 * legitimate data — "not applicable" in a risk register — and dropping it
 * lower down would quietly lose a row from the buyer's copy.
 */
function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s|:-]+\|[\s|:-]*$/.test(line) && line.includes('-')
}

function isTableRow(line: string): boolean {
  return line.trimStart().startsWith('|')
}

/**
 * Vantage Africa's palette, read off the company profile and the MEIMS
 * proposal rather than guessed.
 *
 * Both documents agree on the core: gold is the signature accent and by far the
 * most-used colour in each, over dark brown text, with maroon and terracotta as
 * secondaries. The export previously used saddle brown (#8B4513) and a duller
 * gold (#C9A227) — the right family, but not the actual brand, and a brand
 * colour that is merely close reads as wrong.
 *
 * Kept as named constants so the next brand change is one block, not a search
 * for hex strings.
 */
const BRAND = {
  /** The signature accent. Rules, table headers, the cover band. */
  gold: 'FAB517',
  /** Headings and the darkest text. */
  brown: '401612',
  /** Secondary headings, so H1 and H2 are distinguishable at a glance. */
  maroon: '50021A',
  /** Used heavily in the company profile; carries the cover subtitle. */
  terracotta: 'A45232',
  /** Table header fill and other tints. */
  cream: 'FFF1E6',
  /** Running heads, captions, anything deliberately quiet. */
  muted: '8A7966',
} as const

/**
 * Exports a proposal as .docx.
 *
 * The drafter returns Markdown — headings, tables and bullets — because that is
 * what an evaluation panel needs and what a model writes reliably. This is the
 * other half of that contract: without real Word headings and tables the buyer
 * receives a page of `##` and pipe characters.
 *
 * Typography follows the proposals actually sent: Cambria for headings, Calibri
 * for body. The covers of those were designed in Canva — GlacialIndifference
 * and CanvaSans appear in the font table — but a Canva cover is a flat image,
 * and Montserrat is not installed on most Windows machines. Naming a font the
 * reader does not have means Word silently substitutes one, so this uses the
 * two that ship with Office and are already in use in the body of those files.
 *
 * `docx` is ~400 kB and only needed when someone actually exports, so it is
 * imported on demand rather than shipped in the main bundle.
 */
export async function downloadProposalDocx(
  rfp: Rfp,
  content: string,
): Promise<void> {
  const [
    {
      AlignmentType,
      BorderStyle,
      Document,
      Footer,
      Header,
      HeadingLevel,
      PageNumber,
      Packer,
      Paragraph,
      Table,
      TableCell,
      TableRow,
      TextRun,
      WidthType,
    },
    { saveAs },
  ] = await Promise.all([import('docx'), import('file-saver')])

  const meta = [
    rfp.org && `Issued by: ${rfp.org}`,
    rfp.deadline && `Submission deadline: ${formatDateLong(rfp.deadline)}`,
    rfp.value !== null && `Estimated value: KES ${formatKes(rfp.value)}`,
    rfp.link && `Notice: ${rfp.link}`,
  ].filter((line): line is string => Boolean(line))

  const HEADINGS = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
  ]

  const lines = content.split('\n').map((line) => line.trimEnd())
  const body: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      body.push(new Paragraph({ children: [] }))
      continue
    }

    // ------------------------------------------------------------- tables ---
    // Consumed as a block: a table's rows only mean anything together, and
    // Word needs the whole grid before it can size the columns.
    if (isTableRow(line)) {
      const rows: string[][] = []
      let offset = 0
      while (index < lines.length && isTableRow(lines[index])) {
        if (offset !== 1 || !isTableDivider(lines[index])) {
          rows.push(cells(lines[index]))
        }
        offset += 1
        index += 1
      }
      index -= 1

      if (rows.length > 0) {
        const width = Math.max(...rows.map((row) => row.length))
        body.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: rows.map(
              (row, rowIndex) =>
                new TableRow({
                  // Repeat the header on every page — a work plan or risk
                  // register that breaks across pages is unreadable without it.
                  tableHeader: rowIndex === 0,
                  children: Array.from({ length: width }, (_unused, column) => {
                    const cell = row[column] ?? ''
                    return new TableCell({
                      width: {
                        size: Math.floor(100 / width),
                        type: WidthType.PERCENTAGE,
                      },
                      shading:
                        rowIndex === 0 ? { fill: BRAND.cream } : undefined,
                      margins: { top: 60, bottom: 60, left: 100, right: 100 },
                      children: [
                        new Paragraph({
                          spacing: { before: 20, after: 20 },
                          children: inline(cell, TextRun, {
                            size: 19,
                            bold: rowIndex === 0,
                            // Header row in brand brown so a work plan or risk
                            // register reads as designed rather than defaulted.
                            color: rowIndex === 0 ? BRAND.brown : undefined,
                          }),
                        }),
                      ],
                    })
                  }),
                }),
            ),
          }),
        )
        // Word merges adjacent tables that touch, so keep them apart.
        body.push(new Paragraph({ spacing: { after: 80 }, children: [] }))
      }
      continue
    }

    // ----------------------------------------------------------- headings ---
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading) {
      const level = heading[1].length
      body.push(
        new Paragraph({
          heading: HEADINGS[level - 1],
          spacing: { before: level === 1 ? 360 : 240, after: 120 },
          // The internal section is a hard stop, not another chapter.
          pageBreakBefore: level === 1 && body.length > 0,
          children: inline(heading[2], TextRun),
        }),
      )
      continue
    }

    // ------------------------------------------------------------ bullets ---
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    if (bullet) {
      body.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 60 },
          children: inline(bullet[1], TextRun),
        }),
      )
      continue
    }

    const numbered = /^\s*(\d+)\.\s+(.*)$/.exec(line)
    if (numbered) {
      body.push(
        new Paragraph({
          spacing: { after: 60 },
          indent: { left: 360, hanging: 360 },
          children: [
            new TextRun({ text: `${numbered[1]}.\t` }),
            ...inline(numbered[2], TextRun),
          ],
        }),
      )
      continue
    }

    // Blockquote — the drafter uses these for positioning statements.
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      body.push(
        new Paragraph({
          spacing: { after: 120 },
          indent: { left: 360 },
          border: {
            left: { style: BorderStyle.SINGLE, size: 12, color: BRAND.gold, space: 12 },
          },
          children: inline(quote[1], TextRun, { size: 21 }),
        }),
      )
      continue
    }

    body.push(
      new Paragraph({
        spacing: { after: 120 },
        children: inline(trimmed, TextRun),
      }),
    )
  }

  const document = new Document({
    creator: 'Pipeline Console',
    title: rfp.title,
    description: `Proposal to ${rfp.org}`,
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22, color: '241109' } },
        // Cambria for headings against Calibri body — the pairing these
        // proposals already use, and both ship with Office so nothing gets
        // substituted on the buyer's machine.
        heading1: {
          run: { font: 'Cambria', size: 34, bold: true, color: BRAND.brown },
          paragraph: { spacing: { before: 360, after: 160 } },
        },
        heading2: {
          run: { font: 'Cambria', size: 27, bold: true, color: BRAND.maroon },
          paragraph: { spacing: { before: 280, after: 120 } },
        },
        heading3: {
          run: { font: 'Cambria', size: 23, bold: true, color: BRAND.terracotta },
        },
        heading4: {
          run: { font: 'Calibri', size: 22, bold: true, italics: true, color: BRAND.terracotta },
        },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: rfp.title.slice(0, 90),
                    size: 16,
                    color: BRAND.muted,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: 'Vantage Africa School of Leadership · Confidential · Page ',
                    size: 16,
                    color: BRAND.muted,
                  }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: BRAND.muted }),
                  new TextRun({ text: ' of ', size: 16, color: BRAND.muted }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: BRAND.muted }),
                ],
              }),
            ],
          }),
        },
        children: [
          // Cover.
          //
          // Typographic rather than illustrated. The sent proposals use a Canva
          // cover, which is a flat image this cannot regenerate — and a
          // half-imitated version of a designed page looks worse than a clean
          // one. So this builds a disciplined cover from the brand palette:
          // gold rules top and bottom, the assignment large in brown, the
          // client in terracotta. Drop a exported cover PNG in and it can be
          // swapped for an ImageRun instead.
          new Paragraph({ spacing: { before: 900 }, children: [] }),
          new Paragraph({
            spacing: { after: 300 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 18, color: BRAND.gold, space: 1 },
            },
            children: [],
          }),
          new Paragraph({
            spacing: { after: 220 },
            children: [
              new TextRun({
                text: 'TECHNICAL PROPOSAL',
                bold: true,
                font: 'Cambria',
                size: 22,
                color: BRAND.terracotta,
                // Letter-spaced, which is what makes a short label read as a
                // designed element rather than a stray line of text.
                characterSpacing: 60,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 260 },
            children: [
              new TextRun({
                text: rfp.title,
                bold: true,
                font: 'Cambria',
                size: 44,
                color: BRAND.brown,
              }),
            ],
          }),
          rfp.org
            ? new Paragraph({
                spacing: { after: 320 },
                children: [
                  new TextRun({
                    text: `Submitted to ${rfp.org}`,
                    font: 'Cambria',
                    size: 26,
                    color: BRAND.maroon,
                  }),
                ],
              })
            : new Paragraph({ children: [] }),
          ...meta.map(
            (line) =>
              new Paragraph({
                spacing: { after: 80 },
                children: [new TextRun({ text: line, size: 20, color: BRAND.muted })],
              }),
          ),
          new Paragraph({
            spacing: { before: 520, after: 160 },
            border: {
              top: { style: BorderStyle.SINGLE, size: 18, color: BRAND.gold, space: 12 },
            },
            children: [],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Vantage Africa School of Leadership',
                bold: true,
                font: 'Cambria',
                size: 24,
                color: BRAND.brown,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 400 },
            children: [
              new TextRun({
                text: `${formatDateLong(new Date().toISOString().slice(0, 10))} · Confidential`,
                size: 18,
                color: BRAND.muted,
              }),
            ],
          }),
          new Paragraph({ pageBreakBefore: true, children: [] }),
          ...body,
        ],
      },
    ],
  })

  const blob = await Packer.toBlob(document)
  // Named to the convention in the proposal doctrine, so a bid folder stays
  // legible: Vantage_Africa_<Client>_<Assignment>_Technical_Proposal.docx
  const part = (value: string, limit: number) =>
    value
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, limit)
  const name = [
    'Vantage_Africa',
    part(rfp.org, 40),
    part(rfp.title, 60) || 'Proposal',
    'Technical_Proposal',
  ]
    .filter(Boolean)
    .join('_')
  saveAs(blob, `${name}.docx`)
}
