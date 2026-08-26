import type { TableRow as DocxTableRow } from 'docx'
import { formatDateLong } from '@/domain/dates'
import type { Activity, Lead } from '@/domain/types'

/**
 * The call report a visiting officer files with management.
 *
 * Takes a visit and its client, because the form asks about both and neither
 * alone can fill it: the client's name, location, phone and contact come from
 * the lead, and everything about what happened comes from the activity. Six of
 * the form's fields are therefore never stored twice — see migration 0025.
 *
 * Deliberately a faithful reproduction of the form rather than a prettier
 * version of it: this document is read alongside everyone else's, and one that
 * has been redesigned costs the reader time working out where the fields went.
 * So it keeps the label-left / value-right table, the same field order and the
 * same four numbered headings, down to the trailing bracket in "1.)".
 *
 * `docx` is ~400 kB and only needed when someone exports, so it is imported on
 * demand rather than shipped in the main bundle.
 */

/** Field order, exactly as the form prints it. */
function headerFields(visit: Activity, client: Lead): [string, string][] {
  return [
    ['Name of client', client.org],
    ['Physical location', client.location],
    // The form asks for one phone under one contact; both are useless apart.
    [
      'Phone of Contact Person',
      [client.phone, client.contactName && `(${client.contactName})`]
        .filter(Boolean)
        .join(' '),
    ],
    ['Nature of business', client.natureOfBusiness],
    ['Visiting officers', visit.visitingOfficers],
    ['Names and titles of company officials met', visit.officialsMet],
  ]
}

/**
 * The four numbered sections, in the form's wording.
 *
 * Section 2 falls back to the client's qualification notes: a first visit
 * rarely restates a need that was already established, and an empty box on the
 * form reads as "we did not ask" rather than "we asked earlier".
 */
function sections(visit: Activity, client: Lead): [string, string][] {
  return [
    ['1.)Description of Business/Brief Business Background/Status as it is now', visit.businessBackground],
    ['2.)Identify Key Needs for Training/ Consultancy', visit.keyNeeds || client.needs],
    ['3.)Resolutions/Way Forward/ Actions Plans', visit.wayForward],
    ['4.)Any other comments', visit.otherComments],
  ]
}

/**
 * Which fields are still blank.
 *
 * Used to warn before download rather than to block it — a report is often
 * written over two sittings, and a tool that refuses to produce a draft is a
 * tool people stop using. The caller decides what to do with the list.
 */
export function missingCallReportFields(visit: Activity, client: Lead): string[] {
  const required: [string, string][] = [
    ...headerFields(visit, client),
    ['Date of visit', visit.occurredOn],
    ['Purpose of the meeting', visit.meetingPurpose],
    ...sections(visit, client),
  ]
  return required.filter(([, value]) => !value.trim()).map(([label]) => label)
}

/** A safe, recognisable file name: `Call report - Kenya Water Towers - 2026-08-10.docx`. */
export function callReportFileName(visit: Activity, client: Lead): string {
  const org = (client.org || 'client').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60)
  return `Call report - ${org} - ${visit.occurredOn || visit.reportDate}.docx`
}

export async function downloadCallReportDocx(
  visit: Activity,
  client: Lead,
): Promise<void> {
  const [
    {
      AlignmentType,
      BorderStyle,
      Document,
      Packer,
      Paragraph,
      Table,
      TableCell,
      TableRow,
      TextRun,
      VerticalAlign,
      WidthType,
    },
    { saveAs },
  ] = await Promise.all([import('docx'), import('file-saver')])

  // The form's grid is a plain black hairline on every edge.
  const HAIRLINE = { style: BorderStyle.SINGLE, size: 4, color: '000000' }
  const BORDERS = { top: HAIRLINE, bottom: HAIRLINE, left: HAIRLINE, right: HAIRLINE }

  /** An empty cell still needs a paragraph, or Word renders the row collapsed. */
  const lines = (value: string) => {
    const rows = value.trim() ? value.split('\n') : ['']
    return rows.map((line) => new Paragraph({ children: [new TextRun(line)] }))
  }

  const labelCell = (label: string, width: number) =>
    new TableCell({
      width: { size: width, type: WidthType.PERCENTAGE },
      borders: BORDERS,
      verticalAlign: VerticalAlign.TOP,
      children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
    })

  const valueCell = (value: string, width: number, columnSpan?: number) =>
    new TableCell({
      width: { size: width, type: WidthType.PERCENTAGE },
      borders: BORDERS,
      columnSpan,
      verticalAlign: VerticalAlign.TOP,
      children: lines(value),
    })

  const fieldRow = (label: string, value: string): DocxTableRow =>
    new TableRow({ children: [labelCell(label, 22), valueCell(value, 78, 3)] })

  const headerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      ...headerFields(visit, client).map(([label, value]) => fieldRow(label, value)),
      // The one row the form splits into four columns: visit date and report
      // date sit side by side.
      new TableRow({
        children: [
          labelCell('Date of visit', 22),
          valueCell(visit.occurredOn ? formatDateLong(visit.occurredOn) : '', 28),
          labelCell('Date of Report:', 22),
          valueCell(visit.reportDate ? formatDateLong(visit.reportDate) : '', 28),
        ],
      }),
      fieldRow('Purpose of the meeting', visit.meetingPurpose),
    ],
  })

  // The lower half of the form is one bordered box containing the heading
  // "Business matters discussed" and the four numbered sections beneath it.
  const bodyTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: BORDERS,
            children: [
              new Paragraph({
                spacing: { before: 120, after: 240 },
                children: [new TextRun({ text: 'Business matters discussed', bold: true })],
              }),
              ...sections(visit, client).flatMap(([heading, value]) => [
                new Paragraph({
                  spacing: { before: 120, after: 60 },
                  children: [new TextRun({ text: heading, bold: true })],
                }),
                ...lines(value),
                new Paragraph({ children: [] }),
              ]),
            ],
          }),
        ],
      }),
    ],
  })

  const document = new Document({
    creator: 'Vantage Africa',
    title: `Call report — ${client.org}`,
    description: 'Client visit call report',
    sections: [
      {
        children: [
          headerTable,
          new Paragraph({ spacing: { before: 240 }, children: [] }),
          bodyTable,
          // Signed on paper after printing, which is how these are filed.
          new Paragraph({
            spacing: { before: 480 },
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({ text: 'Prepared by: ', bold: true }),
              new TextRun(visit.visitingOfficers || '________________________'),
            ],
          }),
        ],
      },
    ],
  })

  saveAs(await Packer.toBlob(document), callReportFileName(visit, client))
}
