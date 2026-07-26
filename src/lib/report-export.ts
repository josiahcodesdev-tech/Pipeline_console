import type { TableRow as DocxTableRow } from 'docx'
import { formatDate, formatDateLong, formatKes } from './dates'
import type { WeekMetrics } from './metrics'

/**
 * `docx` is ~400 kB and is only needed when someone actually exports a report,
 * so it is imported on demand rather than shipped in the main bundle.
 */

export interface ReportPayload {
  metrics: WeekMetrics
  revenue: number | null
  notes: string
}

/** The plain-text summary shown on screen and copied to the clipboard. */
export function buildReportText({ metrics, revenue, notes }: ReportPayload): string {
  return `WEEKLY LEAD GENERATION REPORT
Week of ${formatDate(metrics.weekStart)} – ${formatDate(metrics.weekEnd)}

New leads added: ${metrics.newLeads}
Leads qualified: ${metrics.qualified}
Conversions/wins: ${metrics.leadWins}
Revenue closed/supported: KES ${revenue ? formatKes(revenue) : '0'}
Active RFPs in pipeline: ${metrics.activeRfps}
Follow-ups completed: ${metrics.tasksCompleted}
Follow-up discipline: ${metrics.followUpPct}%

Lessons / bottlenecks / improvement priorities:
${notes || '(none recorded)'}`
}

/** Builds and downloads the week's report as a .docx file. */
export async function downloadReportDocx(payload: ReportPayload): Promise<void> {
  const { metrics, revenue, notes } = payload

  const [
    {
      AlignmentType,
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

  const metricRow = (label: string, value: string): DocxTableRow =>
    new TableRow({
      children: [
        new TableCell({
          width: { size: 60, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun(label)] })],
        }),
        new TableCell({
          width: { size: 40, type: WidthType.PERCENTAGE },
          children: [
            new Paragraph({
              children: [new TextRun({ text: value, bold: true })],
            }),
          ],
        }),
      ],
    })

  const document = new Document({
    creator: 'Pipeline Console',
    title: `Weekly Lead Generation Report — week of ${formatDateLong(metrics.weekStart)}`,
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.LEFT,
            children: [new TextRun('Weekly Lead Generation Report')],
          }),
          new Paragraph({
            spacing: { after: 240 },
            children: [
              new TextRun({
                text: `Week of ${formatDateLong(metrics.weekStart)} – ${formatDateLong(metrics.weekEnd)}`,
                italics: true,
              }),
            ],
          }),

          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun('Summary')],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              metricRow('New leads added', String(metrics.newLeads)),
              metricRow('Leads qualified', String(metrics.qualified)),
              metricRow('Conversions / wins', String(metrics.wins)),
              metricRow(
                'Revenue closed / supported',
                `KES ${revenue ? formatKes(revenue) : '0'}`,
              ),
              metricRow('Active RFPs in pipeline', String(metrics.activeRfps)),
              metricRow('Follow-ups completed', String(metrics.tasksCompleted)),
              metricRow('Follow-up discipline', `${metrics.followUpPct}%`),
            ],
          }),

          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 360 },
            children: [
              new TextRun('Lessons, bottlenecks and improvement priorities'),
            ],
          }),
          // Blank lines in the textarea become real paragraph breaks.
          ...(notes.trim() ? notes.split('\n') : ['(none recorded)']).map(
            (line) => new Paragraph({ children: [new TextRun(line)] }),
          ),
        ],
      },
    ],
  })

  const blob = await Packer.toBlob(document)
  saveAs(blob, `weekly-report-${metrics.weekStart}.docx`)
}
