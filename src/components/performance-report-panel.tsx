import { useMemo, useState } from 'react'
import { DownloadIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Panel } from '@/components/panel'
import { Field } from '@/components/field'
import { usePipeline } from '@/hooks/use-pipeline'
import { draftConceptNoteStreaming } from '@/lib/concept-note'
import {
  buildFiguresBlock,
  downloadPerformanceReportDocx,
} from '@/lib/performance-report'

import { formatPeriod, periodRange, today } from '@/lib/dates'
import { periodMetrics } from '@/lib/metrics'
import type { ReportPeriod } from '@/lib/types'

/**
 * A performance report for management, written from the author's own figures.
 *
 * The figures are assembled in the browser and sent as the only source the
 * drafter has. That is the whole design: a report arguing for recognition is
 * read by people who hold the same numbers, so one inflated figure discredits
 * every accurate one beside it. Anything the console does not hold is sent as
 * "NOT HELD" rather than left out, because a gap invites the model to fill it
 * and a stated gap becomes a placeholder the author must supply.
 */
export function PerformanceReportPanel({
  period,
  offset,
  revenue,
}: {
  period: ReportPeriod
  offset: number
  /** Whatever the author entered on the report form, if anything. */
  revenue: number | null
}) {
  const { leads, rfps, tasks, activities } = usePipeline()
  const [authorNotes, setAuthorNotes] = useState('')
  const [report, setReport] = useState('')
  const [busy, setBusy] = useState(false)

  const range = useMemo(() => periodRange(period, today(), offset), [period, offset])
  const previousRange = useMemo(
    () => periodRange(period, today(), offset - 1),
    [period, offset],
  )

  const figures = useMemo(() => {
    const input = { leads, rfps, tasks, activities }
    return buildFiguresBlock({
      period,
      start: range.start,
      end: range.end,
      metrics: periodMetrics(range.start, range.end, input),
      previous: periodMetrics(previousRange.start, previousRange.end, input),
      leads,
      rfps,
      activities,
      revenue,
      authorNotes,
    })
  }, [period, range, previousRange, leads, rfps, tasks, activities, revenue, authorNotes])

  async function write() {
    if (busy) return
    setBusy(true)
    setReport('')
    try {
      const result = await draftConceptNoteStreaming(
        {
          kind: 'performance-report',
          // No client organisation: the subject is the author's own period.
          org: '',
          segment: '',
          notes: figures,
        },
        (chunk) => setReport(chunk),
      )
      setReport(result.text)
      if (result.truncated) {
        toast.warning('The report was cut short at the length ceiling.')
      } else {
        toast.success('Report written — read it before sending it on.')
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function download() {
    try {
      await downloadPerformanceReportDocx(report, formatPeriod(period, range.start))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <Panel
      title="Performance report for management"
      description="Written by the drafter from your own figures for the period above — and from nothing else. Read it before you send it: it is a draft about you, and you are answerable for every line."
      action={
        <div className="flex items-center gap-2">
          {report && (
            <Button type="button" variant="outline" onClick={() => void download()}>
              <DownloadIcon className="size-3.5" aria-hidden />
              Word
            </Button>
          )}
          <Button type="button" onClick={() => void write()} disabled={busy}>
            <SparklesIcon className="size-3.5" aria-hidden />
            {busy ? 'Writing…' : report ? 'Rewrite' : 'Write the report'}
          </Button>
        </div>
      }
    >
      <Field
        label="Anything the figures cannot show"
        htmlFor="perf-notes"
      >
        <Textarea
          id="perf-notes"
          rows={3}
          value={authorNotes}
          onChange={(e) => setAuthorNotes(e.target.value)}
          placeholder="Work done outside this console, obstacles met, what you want management to note. Left blank, the report is built from the figures alone."
        />
      </Field>

      <details className="mb-3 rounded-lg border border-border-soft bg-surface-2/50 px-3 py-2">
        <summary className="cursor-pointer text-[11.5px] font-medium text-muted-foreground">
          The exact figures being sent ({figures.split('\n').length} lines)
        </summary>
        <pre className="mt-2 max-h-[280px] overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
          {figures}
        </pre>
      </details>

      {report ? (
        <div className="max-h-[520px] overflow-y-auto rounded-lg border border-border bg-card p-4">
          <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">
            {report}
          </pre>
        </div>
      ) : (
        <p className="text-[11.5px] leading-relaxed text-faint">
          Nothing written yet. The report will cover {range.start} to {range.end} and
          will compare against the period before it where a comparison exists.
        </p>
      )}
    </Panel>
  )
}
