import type { WeekMetrics } from './metrics'
import { formatKes, formatPeriod } from './dates'
import type { Activity, Lead, ReportPeriod, Rfp } from './types'

/**
 * The figures a performance report is allowed to contain.
 *
 * Assembled here and sent as one block, because the drafter is forbidden from
 * having any other source. Anything absent from this text cannot appear in the
 * report — so a figure the console does not hold is written out as "not held"
 * rather than omitted. Omitting it invites the model to fill the gap; naming it
 * as missing turns it into a placeholder the author must supply, which is what
 * it actually is.
 *
 * Everything here is computed from the author's own rows. Nothing is estimated,
 * annualised or compared against a period that was not also computed.
 */

export interface PerformanceInput {
  period: ReportPeriod
  start: string
  end: string
  metrics: WeekMetrics
  /** The same figures for the period before, so a trend can be stated honestly. */
  previous: WeekMetrics | null
  leads: Lead[]
  rfps: Rfp[]
  activities: Activity[]
  /** Revenue the author recorded for the period. Often absent. */
  revenue: number | null
  /** Anything the author wants the report to know that the data cannot show. */
  authorNotes: string
}

function line(label: string, value: string | number): string {
  return `- ${label}: ${value}`
}

/** A figure the console genuinely does not hold, said out loud. */
function notHeld(label: string): string {
  return `- ${label}: NOT HELD — the author must supply this or it must not appear`
}

function movement(now: number, before: number | undefined): string {
  if (before === undefined) return String(now)
  const delta = now - before
  if (delta === 0) return `${now} (unchanged on the previous period)`
  return `${now} (${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)} on the previous period, which was ${before})`
}

export function buildFiguresBlock(input: PerformanceInput): string {
  const { metrics: m, previous: p, leads, rfps, activities, revenue } = input

  const mine = rfps.filter((rfp) => rfp.inPipeline)
  const won = mine.filter((rfp) => rfp.status === 'Won')
  const lost = mine.filter((rfp) => rfp.status === 'Lost')
  const live = mine.filter(
    (rfp) => rfp.status === 'Preparing' || rfp.status === 'Submitted',
  )
  const decided = won.length + lost.length
  const openValue = live.reduce((sum, rfp) => sum + (rfp.value ?? 0), 0)

  const visits = activities.filter((a) => a.reportDate)
  const qualifiedLeads = leads.filter((l) =>
    ['Qualified', 'Handed Over', 'Won'].includes(l.status),
  )

  // Named individually rather than counted: a bid is the unit management
  // recognises, and "four tenders" is a weaker sentence than four titles.
  const liveTitles = live
    .slice(0, 12)
    .map((rfp) => `  · ${rfp.title.slice(0, 110)}${rfp.org ? ` — ${rfp.org}` : ''} (${rfp.status})`)
  const wonTitles = won
    .slice(0, 12)
    .map((rfp) => `  · ${rfp.title.slice(0, 110)}${rfp.org ? ` — ${rfp.org}` : ''}`)

  return [
    '## Period',
    line('Reporting period', formatPeriod(input.period, input.start)),
    line('From', input.start),
    line('To', input.end),
    '',
    '## Lead generation',
    line('New leads added', movement(m.newLeads, p?.newLeads)),
    line('Leads qualified', movement(m.qualified, p?.qualified)),
    line('Total leads on the register', leads.length),
    line('Leads at Qualified or beyond', qualifiedLeads.length),
    '',
    '## Conversion',
    line('Conversions (meetings held, demos, proposals sent, registrations)', movement(m.conversions, p?.conversions)),
    line('Wins recorded in the period', movement(m.wins, p?.wins)),
    revenue === null || revenue === 0
      ? notHeld('Revenue closed or supported')
      : line('Revenue closed or supported', `KES ${formatKes(revenue)}`),
    '',
    '## Bids and proposals',
    line('Tenders taken into the pipeline', mine.length),
    line('Bids live at period end (Preparing or Submitted)', live.length),
    line('Bids won', won.length),
    line('Bids lost', lost.length),
    decided > 0
      ? line('Win rate on decided bids', `${Math.round((won.length / decided) * 100)}% (${won.length} of ${decided})`)
      : notHeld('Win rate — no bid has been decided yet, so there is no rate to quote'),
    openValue > 0
      ? line('Estimated value of live bids', `KES ${formatKes(openValue)}`)
      : notHeld('Value of live bids — no estimated values have been entered'),
    liveTitles.length ? '\nLive bids:' : '',
    ...liveTitles,
    wonTitles.length ? '\nBids won:' : '',
    ...wonTitles,
    '',
    '## Client engagement',
    line('Client communications logged', movement(m.communications, p?.communications)),
    line('Meeting requests sent', movement(m.meetingRequests, p?.meetingRequests)),
    line('Client visits with a filed call report', visits.length),
    line('Follow-up discipline', `${m.followUpPct}%`),
    line('Follow-up tasks completed', movement(m.tasksCompleted, p?.tasksCompleted)),
    '',
    '## Targets',
    notHeld('Targets for any of the above — none are recorded in this system'),
    '',
    '## Context supplied by the author',
    input.authorNotes.trim() || '(none supplied)',
    '',
    '## What this system does not hold',
    'Revenue is only present where the author entered it on a report. There are no',
    'targets, no appraisal ratings, no client testimonials and no record of work done',
    'outside this console. If the report needs any of those, they are placeholders.',
  ]
    .filter((row) => row !== '')
    .join('\n')
}

/**
 * Renders the drafted Markdown to Word.
 *
 * A small renderer of its own rather than reusing the proposal exporter: that
 * one builds a tender cover page, a contents field and bid footers, all of
 * which would be wrong on a two-page report about a person. This handles the
 * four things the drafter is told to emit — headings, paragraphs, bullets and
 * pipe tables — and nothing else.
 */
export async function downloadPerformanceReportDocx(
  markdown: string,
  periodLabel: string,
): Promise<void> {
  const [
    { BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType },
    { saveAs },
  ] = await Promise.all([import('docx'), import('file-saver')])

  const HAIRLINE = { style: BorderStyle.SINGLE, size: 2, color: 'D8D2C8' }
  const BORDERS = { top: HAIRLINE, bottom: HAIRLINE, left: HAIRLINE, right: HAIRLINE }

  /** `**bold**` becomes a bold run; everything else is plain. */
  const runs = (text: string) =>
    text
      .split(/(\*\*[^*]+\*\*)/g)
      .filter(Boolean)
      .map((part) =>
        part.startsWith('**') && part.endsWith('**')
          ? new TextRun({ text: part.slice(2, -2), bold: true })
          : new TextRun(part),
      )

  const children: object[] = []
  const lines = markdown.split('\n')

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue

    // A pipe table runs until the first line that is not one.
    if (trimmed.startsWith('|')) {
      const block: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        block.push(lines[i].trim())
        i += 1
      }
      i -= 1
      const rows = block
        // The |---|---| separator carries no content.
        .filter((row) => !/^\|[\s:|-]+\|$/.test(row))
        .map((row) =>
          row.slice(1, row.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim()),
        )
      if (rows.length === 0) continue
      const width = Math.max(...rows.map((r) => r.length))
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map(
            (cells, rowIndex) =>
              new TableRow({
                children: Array.from({ length: width }, (_, col) => {
                  const value = cells[col] ?? ''
                  return new TableCell({
                    borders: BORDERS,
                    width: { size: Math.round(100 / width), type: WidthType.PERCENTAGE },
                    children: [
                      new Paragraph({
                        children:
                          rowIndex === 0
                            ? [new TextRun({ text: value.replace(/\*\*/g, ''), bold: true })]
                            : runs(value),
                      }),
                    ],
                  })
                }),
              }),
          ),
        }),
      )
      children.push(new Paragraph({ spacing: { after: 160 }, children: [] }))
      continue
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      children.push(
        new Paragraph({
          heading:
            heading[1].length === 1
              ? HeadingLevel.HEADING_1
              : heading[1].length === 2
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
          spacing: { before: 320, after: 120 },
          children: runs(heading[2]),
        }),
      )
      continue
    }

    const bullet = trimmed.match(/^[-*]\s+(.*)$/)
    if (bullet) {
      children.push(
        new Paragraph({ bullet: { level: 0 }, children: runs(bullet[1]) }),
      )
      continue
    }

    children.push(new Paragraph({ spacing: { after: 120 }, children: runs(trimmed) }))
  }

  const document = new Document({
    creator: 'Pipeline Console',
    title: `Performance report — ${periodLabel}`,
    sections: [{ children: children as never[] }],
  })

  saveAs(
    await Packer.toBlob(document),
    `Performance report - ${periodLabel.replace(/[\/:*?"<>|]/g, '')}.docx`,
  )
}
