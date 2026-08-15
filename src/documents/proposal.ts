import { formatDateLong, formatKes } from '@/domain/dates'
import { parseProposal, type Block } from './proposal-markdown'
import type { Rfp } from '@/domain/types'

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
  options: {
    size?: number
    bold?: boolean
    color?: string
    italics?: boolean
  } = {},
) {
  return line.split('**').map(
    (part, index) =>
      new TextRun({
        text: part,
        // Odd segments sat between a matched pair of asterisks.
        bold: options.bold || index % 2 === 1,
        size: options.size,
        color: options.color,
        italics: options.italics,
      }),
  )
}

/**
 * The house style, taken from the AFSC fundraising proposal.
 *
 * Not sampled from a rendering — read out of that file's own XML, so these are
 * the exact values the document was built with rather than an eyeballed match.
 * An earlier pass guessed at a brighter gold from a compressed PDF and was
 * wrong; the real accent is noticeably more muted.
 *
 * Usage counts in that document, which is also the hierarchy: maroon carries
 * every heading and label, gold is the accent and rules, cream and tan
 * alternate as table fills.
 */
const BRAND = {
  /** Headings, labels, header and footer. The dominant brand colour. */
  maroon: '6B0F1A',
  /** Accent: rules under headings, sub-headings, cover flourishes. */
  gold: 'C5973A',
  /** Alternating table rows and callout boxes. */
  cream: 'F9F3E8',
  /** The label column of a two-column table, a shade down from cream. */
  tan: 'F5E6C8',
  /** Body text. Deliberately not pure black. */
  ink: '1A1A1A',
  white: 'FFFFFF',
} as const

/**
 * The single typeface, matching the template — every run in it is Arial.
 *
 * A previous version paired Cambria headings with Calibri body, which was a
 * reasonable guess and not what the house actually uses.
 */
const FONT = 'Arial'

/** Fixed house details, as they appear in the template's header and footer. */
const ORG = 'Vantage Africa School of Leadership'
const WEBSITE = 'www.vantageafricaleaders.com'
const EMAIL = 'bkiarie@vantageafricaleaders.com'
const ACCREDITATION = 'Accredited by: NITA | IHRM | TVETA | KASNEB | KISM'

/**
 * Exports a proposal as .docx.
 *
 * The drafter returns Markdown — headings, tables and bullets — because that is
 * what an evaluation panel needs and what a model writes reliably. This is the
 * other half of that contract: without real Word headings and tables the buyer
 * receives a page of `##` and pipe characters.
 *
 * Layout follows the AFSC fundraising proposal: a typographic cover, an
 * auto-built contents page, maroon section headings ruled in gold, tables with
 * a maroon header row and alternating cream fills, and the house running head
 * and footer on every page.
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
      TableOfContents,
      TableRow,
      TabStopType,
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

  // Parsed by the shared module, so the Word file and the live preview can
  // never disagree about what the document is — which section is number 4,
  // which lines form a table, which callout is the dark one.
  const blocks: Block[] = parseProposal(content)
  const body: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = []

  for (const block of blocks) {
    if (block.kind === "blank") {
      body.push(new Paragraph({ children: [] }))
      continue
    }

    if (block.kind === "table") {
      const width = Math.max(...block.rows.map((row) => row.length))
      body.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: block.rows.map(
            (row, rowIndex) =>
              new TableRow({
                // Repeat the header on every page — a work plan or risk
                // register that breaks across pages is unreadable without it.
                tableHeader: rowIndex === 0,
                children: Array.from({ length: width }, (_unused, column) => {
                  const cell = row[column] ?? ""
                  const header = rowIndex === 0
                  // The first body column is the label column, which is the
                  // device running through almost every table in the sent
                  // proposals — and even the schedule, whose Day column is
                  // emphasised the same way.
                  const label = !header && column === 0 && width > 1
                  return new TableCell({
                    width: { size: Math.floor(100 / width), type: WidthType.PERCENTAGE },
                    shading: {
                      fill: header
                        ? BRAND.maroon
                        : label
                          ? BRAND.tan
                          : rowIndex % 2 === 1
                            ? BRAND.white
                            : BRAND.cream,
                    },
                    margins: { top: 80, bottom: 80, left: 120, right: 120 },
                    children: [
                      new Paragraph({
                        alignment: AlignmentType.LEFT,
                        spacing: { before: 20, after: 20 },
                        children: inline(cell, TextRun, {
                          size: 18,
                          bold: header || label,
                          color: header ? BRAND.white : label ? BRAND.maroon : BRAND.ink,
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
      continue
    }

    if (block.kind === "heading") {
      const label = block.number ? `${block.number}. ${block.text}` : block.text
      body.push(
        new Paragraph({
          heading: HEADINGS[block.level - 1],
          spacing: { before: block.level === 1 ? 360 : 240, after: 120 },
          // A level-one heading is the document title or the internal
          // appendix — both are a hard stop, not another chapter.
          pageBreakBefore: block.level === 1 && body.length > 0,
          children: inline(label, TextRun),
        }),
      )
      continue
    }

    if (block.kind === "callout") {
      if (block.label) {
        // The dark panel: gold label over white on maroon, which is the
        // strongest mark the sent proposals use.
        body.push(
          new Paragraph({
            spacing: { before: 200, after: 60 },
            shading: { fill: BRAND.maroon },
            children: [new TextRun({ text: block.label, bold: true, size: 21, color: BRAND.gold })],
          }),
        )
        body.push(
          new Paragraph({
            spacing: { after: 220 },
            shading: { fill: BRAND.maroon },
            children: [new TextRun({ text: block.text, size: 20, color: BRAND.white })],
          }),
        )
        continue
      }
      body.push(
        new Paragraph({
          spacing: { before: 160, after: 200 },
          shading: { fill: BRAND.cream },
          border: {
            top: { style: BorderStyle.SINGLE, size: 6, color: BRAND.gold, space: 10 },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND.gold, space: 10 },
            left: { style: BorderStyle.SINGLE, size: 6, color: BRAND.gold, space: 10 },
            right: { style: BorderStyle.SINGLE, size: 6, color: BRAND.gold, space: 10 },
          },
          children: inline(block.text, TextRun, { size: 20, italics: true, color: BRAND.maroon }),
        }),
      )
      continue
    }

    if (block.kind === "bullet") {
      body.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 60 },
          children: inline(block.text, TextRun),
        }),
      )
      continue
    }

    if (block.kind === "numbered") {
      body.push(
        new Paragraph({
          spacing: { after: 60 },
          indent: { left: 360, hanging: 360 },
          children: [
            new TextRun({ text: `${block.marker}.	` }),
            ...inline(block.text, TextRun),
          ],
        }),
      )
      continue
    }

    body.push(
      new Paragraph({ spacing: { after: 120 }, children: inline(block.text, TextRun) }),
    )
  }

  const document = new Document({
    creator: 'Pipeline Console',
    // Tells Word there are fields needing calculation, so it prompts to update
    // them on open. Without this the contents page stays empty.
    features: { updateFields: true },
    title: rfp.title,
    description: `Proposal to ${rfp.org}`,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 20, color: BRAND.ink },
          // Justified body, as the template sets it.
          paragraph: { alignment: AlignmentType.JUSTIFIED, spacing: { line: 276 } },
        },
        // Section title: maroon, with the gold rule the template puts under
        // every numbered section heading.
        heading1: {
          run: { font: FONT, size: 30, bold: true, color: BRAND.maroon },
          paragraph: {
            alignment: AlignmentType.LEFT,
            spacing: { before: 240, after: 260 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 10, color: BRAND.gold, space: 8 },
            },
          },
        },
        // Sub-headings are gold in the template — "Virtual Facilitation
        // Methods", "Key Assumptions", "Post-Training Package".
        heading2: {
          run: { font: FONT, size: 24, bold: true, color: BRAND.gold },
          paragraph: { alignment: AlignmentType.LEFT, spacing: { before: 280, after: 120 } },
        },
        heading3: {
          run: { font: FONT, size: 21, bold: true, color: BRAND.maroon },
          paragraph: { alignment: AlignmentType.LEFT, spacing: { before: 220, after: 100 } },
        },
        heading4: {
          run: { font: FONT, size: 20, bold: true, italics: true, color: BRAND.maroon },
          paragraph: { alignment: AlignmentType.LEFT },
        },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
        // Running head: the house name in bold maroon, the assignment after a
        // divider, ruled off in gold — as in the template, on every page.
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { after: 60 },
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND.gold, space: 4 },
                },
                children: [
                  new TextRun({ text: ORG, bold: true, size: 15, color: BRAND.maroon }),
                  new TextRun({ text: '  |  ', size: 15, color: BRAND.gold }),
                  new TextRun({
                    text: `Technical Proposal: ${rfp.title}`.slice(0, 110),
                    size: 15,
                    color: BRAND.maroon,
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
                alignment: AlignmentType.LEFT,
                border: {
                  top: { style: BorderStyle.SINGLE, size: 4, color: BRAND.gold, space: 6 },
                },
                // A right-aligned tab stop puts the page number on the far edge
                // while the contact details stay left, which is the template's
                // arrangement.
                tabStops: [{ type: TabStopType.RIGHT, position: 9020 }],
                children: [
                  new TextRun({ text: WEBSITE, size: 15, color: BRAND.maroon }),
                  new TextRun({ text: '  |  ', size: 15, color: BRAND.gold }),
                  new TextRun({ text: EMAIL, size: 15, color: BRAND.maroon }),
                  new TextRun({ text: '\tPage ', size: 15, color: BRAND.maroon }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 15, color: BRAND.maroon }),
                  new TextRun({ text: ' of ', size: 15, color: BRAND.maroon }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, color: BRAND.maroon }),
                ],
              }),
            ],
          }),
        },
        children: [
          // ------------------------------------------------------- cover ---
          // Laid out as the template does it: house name in gold caps, a
          // ruled-off label, the assignment large in maroon, then a two-column
          // block pairing who is submitting with who is receiving.
          new Paragraph({ spacing: { before: 700 }, children: [] }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 260 },
            children: [
              new TextRun({
                text: ORG.toUpperCase(),
                bold: true,
                size: 26,
                color: BRAND.gold,
                // Letter-spacing is what makes a short caps line read as a
                // designed element rather than a stray sentence.
                characterSpacing: 40,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 320 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 8, color: BRAND.gold, space: 10 },
            },
            children: [
              new TextRun({ text: 'Technical Proposal for:', size: 22, color: BRAND.ink }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
            children: [
              new TextRun({ text: rfp.title, bold: true, size: 44, color: BRAND.maroon }),
            ],
          }),
          ...(rfp.serviceAreas.trim()
            ? [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 420 },
                  children: [
                    new TextRun({
                      text: rfp.serviceAreas,
                      italics: true,
                      size: 22,
                      color: BRAND.ink,
                    }),
                  ],
                }),
              ]
            : [new Paragraph({ spacing: { after: 300 }, children: [] })]),

          // Prepared by / Submitted to, as a two-column block. Maroon panel
          // against a cream one is the template's strongest cover device.
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    shading: { fill: BRAND.maroon },
                    margins: { top: 200, bottom: 200, left: 160, right: 160 },
                    children: [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        spacing: { after: 120 },
                        children: [
                          new TextRun({ text: 'Prepared by:', bold: true, size: 20, color: BRAND.gold }),
                        ],
                      }),
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [
                          new TextRun({ text: ORG, bold: true, size: 20, color: BRAND.white }),
                        ],
                      }),
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [
                          new TextRun({ text: EMAIL, size: 18, color: BRAND.gold }),
                        ],
                      }),
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [
                          new TextRun({ text: WEBSITE, size: 18, color: BRAND.gold }),
                        ],
                      }),
                    ],
                  }),
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    shading: { fill: BRAND.cream },
                    margins: { top: 200, bottom: 200, left: 160, right: 160 },
                    children: [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        spacing: { after: 120 },
                        children: [
                          new TextRun({ text: 'Submitted to:', bold: true, size: 20, color: BRAND.maroon }),
                        ],
                      }),
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [
                          new TextRun({
                            text: rfp.org || 'The issuing organization',
                            bold: true,
                            size: 20,
                            color: BRAND.maroon,
                          }),
                        ],
                      }),
                      ...meta.map(
                        (line) =>
                          new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [new TextRun({ text: line, size: 17, color: BRAND.ink })],
                          }),
                      ),
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        spacing: { before: 80 },
                        children: [
                          new TextRun({
                            text: formatDateLong(new Date().toISOString().slice(0, 10)),
                            size: 18,
                            color: BRAND.ink,
                          }),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),

          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 520 },
            border: {
              top: { style: BorderStyle.SINGLE, size: 4, color: BRAND.gold, space: 10 },
            },
            children: [
              new TextRun({ text: ACCREDITATION, bold: true, size: 18, color: BRAND.maroon }),
            ],
          }),

          // ---------------------------------------------------- contents ---
          // A real Word field rather than a written-out list, so it renumbers
          // itself when the document is edited. Word asks to update fields on
          // open; until then it shows the placeholder below.
          new Paragraph({
            pageBreakBefore: true,
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: 'Contents' })],
          }),
          // `dirty` is the difference between a contents page and an empty
          // one. Without it Word treats the field as already calculated and
          // renders only the placeholder — which is exactly what shipped: a
          // page headed "Contents" with nothing beneath it. Marked dirty, Word
          // offers to update fields on open and builds the list.
          //
          // The placeholder still matters for anything that opens the file
          // without evaluating fields, such as a PDF converter.
          new TableOfContents('Update this field to build the contents.', {
            hyperlink: true,
            headingStyleRange: '1-3',
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
