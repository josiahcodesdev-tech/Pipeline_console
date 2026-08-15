import { formatDateLong, today } from '@/domain/dates'
import type { TableRow as DocxTableRow } from 'docx'
import {
  BUILT_NOT_LIVE,
  CAVEATS,
  NOT_YET,
  WORKING,
  snapshotRows,
  type Capability,
  type SystemSnapshot,
} from '@/features/report/inventory'

export function systemReportFileName(): string {
  return `Pipeline Console - capability report - ${today()}.docx`
}

export async function downloadSystemReportDocx(
  snapshot: SystemSnapshot,
): Promise<void> {
  const [
    {
      AlignmentType,
      BorderStyle,
      Document,
      HeadingLevel,
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

  const HAIRLINE = { style: BorderStyle.SINGLE, size: 2, color: 'D8D2C8' }
  const BORDERS = { top: HAIRLINE, bottom: HAIRLINE, left: HAIRLINE, right: HAIRLINE }

  const cell = (text: string, opts: { bold?: boolean; width: number }) =>
    new TableCell({
      width: { size: opts.width, type: WidthType.PERCENTAGE },
      borders: BORDERS,
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold: opts.bold })],
        }),
      ],
    })

  const twoColumn = (rows: [string, string][]): InstanceType<typeof Table> =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map(
        ([label, value]): DocxTableRow =>
          new TableRow({
            children: [cell(label, { bold: true, width: 38 }), cell(value, { width: 62 })],
          }),
      ),
    })

  /** Each capability as a heading, a sentence, and the example that proves it. */
  const capabilityBlocks = (items: Capability[]) =>
    items.flatMap((item) => [
      new Paragraph({
        spacing: { before: 260, after: 60 },
        children: [new TextRun({ text: item.area, bold: true })],
      }),
      new Paragraph({ children: [new TextRun(item.what)] }),
      new Paragraph({
        spacing: { before: 60 },
        indent: { left: 340 },
        children: [
          new TextRun({ text: 'Example. ', bold: true, italics: true }),
          new TextRun({ text: item.example, italics: true }),
        ],
      }),
    ])

  const heading = (text: string) =>
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 420, after: 120 },
      children: [new TextRun(text)],
    })

  const document = new Document({
    creator: 'Pipeline Console',
    title: 'Pipeline Console — capability report',
    description: 'What the system does today, and what it does not do yet',
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun('Pipeline Console — capability report')],
          }),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: `Vantage Africa School of Leadership · ${formatDateLong(today())}`,
                italics: true,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 240 },
            children: [
              new TextRun(
                'What the bid and lead management system does today, what is built and waiting to be switched on, and what it does not do yet. Figures are read from the live database at the moment of export; the capability lists are maintained by hand, because a feature that exists but is not deployed looks identical to one that works.',
              ),
            ],
          }),

          heading('1. The system as it stands'),
          twoColumn(snapshotRows(snapshot)),

          heading('2. What it does today'),
          ...capabilityBlocks(WORKING),

          heading('3. Built, waiting to be switched on'),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun(
                'Written and committed. Each needs a database migration or a function deployment before it takes effect.',
              ),
            ],
          }),
          ...capabilityBlocks(BUILT_NOT_LIVE),

          heading('4. What it does not do yet'),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun(
                'Stated plainly so that nobody plans around a capability that is absent.',
              ),
            ],
          }),
          ...capabilityBlocks(NOT_YET),

          heading('5. What to know before relying on it'),
          twoColumn(CAVEATS),

          new Paragraph({
            spacing: { before: 420 },
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({
                text: 'Prepared from the running system. Figures above are live; everything else is a written inventory and is only as current as its last revision.',
                italics: true,
                size: 18,
              }),
            ],
          }),
        ],
      },
    ],
  })

  saveAs(await Packer.toBlob(document), systemReportFileName())
}
