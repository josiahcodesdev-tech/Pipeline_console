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
  options: { size?: number; bold?: boolean } = {},
) {
  return line.split('**').map(
    (part, index) =>
      new TextRun({
        text: part,
        // Odd segments sat between a matched pair of asterisks.
        bold: options.bold || index % 2 === 1,
        size: options.size,
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
 * Exports a proposal as .docx.
 *
 * The drafter returns Markdown — headings, tables and bullets — because that is
 * what an evaluation panel needs and what a model writes reliably. This is the
 * other half of that contract: without real Word headings and tables the buyer
 * receives a page of `##` and pipe characters.
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
                        rowIndex === 0 ? { fill: 'F3EEE7' } : undefined,
                      margins: { top: 60, bottom: 60, left: 100, right: 100 },
                      children: [
                        new Paragraph({
                          spacing: { before: 20, after: 20 },
                          children: inline(cell, TextRun, {
                            size: 19,
                            bold: rowIndex === 0,
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
            left: { style: BorderStyle.SINGLE, size: 12, color: 'C9A227', space: 12 },
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
        document: { run: { font: 'Calibri', size: 22 } },
        heading1: {
          run: { font: 'Calibri', size: 32, bold: true, color: '8B4513' },
        },
        heading2: {
          run: { font: 'Calibri', size: 26, bold: true, color: '8B4513' },
        },
        heading3: { run: { font: 'Calibri', size: 23, bold: true } },
        heading4: { run: { font: 'Calibri', size: 22, bold: true, italics: true } },
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
                    color: '8A7966',
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
                    color: '8A7966',
                  }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '8A7966' }),
                  new TextRun({ text: ' of ', size: 16, color: '8A7966' }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '8A7966' }),
                ],
              }),
            ],
          }),
        },
        children: [
          // Cover. Kept plain — the doctrine warns off decorative stock imagery,
          // and a real brand template can be applied over this.
          new Paragraph({ spacing: { before: 1400 }, children: [] }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: 'TECHNICAL PROPOSAL',
                bold: true,
                size: 20,
                color: '8A7966',
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 240 },
            children: [
              new TextRun({ text: rfp.title, bold: true, size: 40, color: '8B4513' }),
            ],
          }),
          ...meta.map(
            (line) =>
              new Paragraph({
                spacing: { after: 80 },
                children: [new TextRun({ text: line, size: 20 })],
              }),
          ),
          new Paragraph({ spacing: { before: 400 }, children: [] }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Submitted by Vantage Africa School of Leadership',
                bold: true,
                size: 22,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 400 },
            children: [
              new TextRun({
                text: `${formatDateLong(new Date().toISOString().slice(0, 10))} · Confidential`,
                size: 18,
                color: '8A7966',
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
