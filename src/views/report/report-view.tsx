import { useEffect, useMemo, useState } from 'react'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileTextIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, Panel, ViewHeader } from '@/components/panel'
import { KpiCard } from '@/components/kpi-card'
import { Field, FieldRow, SelectField } from '@/components/field'
import { usePipeline } from '@/hooks/use-pipeline'
import { addDays, formatDate, today, weekStart } from '@/lib/dates'
import { weekMetrics } from '@/lib/metrics'
import { buildReportText, downloadReportDocx } from '@/lib/report-export'
import type { IsoDate } from '@/lib/types'

const SUBMITTED_OPTIONS = ['Not yet', 'Yes — submitted'] as const
type SubmittedOption = (typeof SUBMITTED_OPTIONS)[number]

export function ReportView() {
  const { leads, rfps, tasks, reports, saveReport } = usePipeline()
  const [selectedWeek, setSelectedWeek] = useState<IsoDate>(() => weekStart(today()))
  const [revenue, setRevenue] = useState('')
  const [notes, setNotes] = useState('')
  const [submitted, setSubmitted] = useState<SubmittedOption>('Not yet')
  const [busy, setBusy] = useState(false)

  const saved = useMemo(
    () => reports.find((report) => report.weekStart === selectedWeek) ?? null,
    [reports, selectedWeek],
  )

  // Load the stored inputs whenever the visible week changes.
  useEffect(() => {
    setRevenue(saved?.revenue != null ? String(saved.revenue) : '')
    setNotes(saved?.notes ?? '')
    setSubmitted(saved?.submitted ? 'Yes — submitted' : 'Not yet')
  }, [saved, selectedWeek])

  const metrics = useMemo(
    () => weekMetrics(selectedWeek, leads, rfps, tasks),
    [selectedWeek, leads, rfps, tasks],
  )

  const revenueValue = revenue.trim() === '' ? null : Number(revenue)
  const payload = {
    metrics,
    revenue: Number.isFinite(revenueValue) ? revenueValue : null,
    notes,
  }
  const reportText = buildReportText(payload)
  const isCurrentWeek = selectedWeek === weekStart(today())

  async function handleSave() {
    setBusy(true)
    try {
      await saveReport({
        weekStart: selectedWeek,
        revenue: payload.revenue,
        notes,
        submitted: submitted === 'Yes — submitted',
      })
      toast.success(`Report saved for week of ${formatDate(selectedWeek)}`)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(reportText)
    toast.success('Copied — paste into email or Slack')
  }

  async function handleDownload(week: IsoDate) {
    try {
      const target = week === selectedWeek ? payload : null
      const stored = reports.find((report) => report.weekStart === week)
      await downloadReportDocx(
        target ?? {
          metrics: weekMetrics(week, leads, rfps, tasks),
          revenue: stored?.revenue ?? null,
          notes: stored?.notes ?? '',
        },
      )
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const pastReports = useMemo(
    () => reports.slice().sort((a, b) => b.weekStart.localeCompare(a.weekStart)),
    [reports],
  )

  return (
    <>
      <ViewHeader
        eyebrow="Reporting"
        title="Weekly portfolio report"
        description="Figures are counted from the pipeline automatically; revenue and lessons are yours to add. Export as Word when it is ready to send."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedWeek(addDays(selectedWeek, -7))}
              aria-label="Previous week"
            >
              <ChevronLeftIcon />
              Prev
            </Button>
            <div className="text-[11px] text-muted-foreground">
              Week of {formatDate(selectedWeek)} – {formatDate(metrics.weekEnd)}
              {isCurrentWeek && ' (current)'}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedWeek(addDays(selectedWeek, 7))}
              aria-label="Next week"
            >
              Next
              <ChevronRightIcon />
            </Button>
            <Button
              size="sm"
              onClick={() => setSelectedWeek(weekStart(today()))}
              disabled={isCurrentWeek}
            >
              This week
            </Button>
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="New leads added" value={metrics.newLeads} />
        <KpiCard label="Leads qualified" value={metrics.qualified} />
        <KpiCard label="Conversions / wins" value={metrics.wins} />
        <KpiCard label="Follow-up discipline" value={`${metrics.followUpPct}%`} />
        <KpiCard label="Follow-ups completed" value={metrics.tasksCompleted} />
        <KpiCard label="Active RFPs in pipeline" value={metrics.activeRfps} />
      </div>

      <Panel title="This week's manual inputs">
        <FieldRow>
          <Field label="Revenue closed / supported (KES)" htmlFor="report-revenue">
            <Input
              id="report-revenue"
              type="number"
              min={0}
              placeholder="0"
              value={revenue}
              onChange={(event) => setRevenue(event.target.value)}
              className="w-full"
            />
          </Field>
          <SelectField
            label="Report submitted?"
            value={submitted}
            options={SUBMITTED_OPTIONS}
            onChange={setSubmitted}
          />
        </FieldRow>

        <Field label="Lessons, bottlenecks, improvement priorities" htmlFor="report-notes">
          <Textarea
            id="report-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="e.g. Follow-up response times from procurement offices were slow this week; propose earlier first-contact for county-level RFPs…"
            className="min-h-[90px] w-full"
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void handleSave()} disabled={busy}>
            Save this week&rsquo;s report
          </Button>
          <Button variant="outline" onClick={() => void handleCopy()}>
            Copy as text
          </Button>
          <Button variant="outline" onClick={() => void handleDownload(selectedWeek)}>
            <DownloadIcon />
            Download as Word
          </Button>
        </div>
      </Panel>

      <Panel title="Copy-ready summary">
        <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {reportText}
        </pre>
      </Panel>

      <Panel title="Past reports">
        {pastReports.length === 0 ? (
          <EmptyState
            icon={<FileTextIcon className="size-5" />}
            hint="Save this week and it appears here, so you can reopen or re-export any week later."
          >
            No saved reports yet
          </EmptyState>
        ) : (
          pastReports.map((report) => (
            <div
              key={report.id}
              className="flex items-center gap-2.5 border-b border-border-soft px-1 py-2 last:border-b-0"
            >
              <span className="flex-1 text-[12.5px]">
                Week of {formatDate(report.weekStart)}
                {report.weekStart === selectedWeek && (
                  <span className="text-faint"> — currently open</span>
                )}
              </span>
              <span
                className={
                  report.submitted
                    ? 'text-[11px] text-success'
                    : 'text-[11px] text-muted-foreground'
                }
              >
                {report.submitted ? 'submitted' : 'draft'}
              </span>
              <button
                type="button"
                onClick={() => setSelectedWeek(report.weekStart)}
                className="cursor-pointer px-1 text-[11px] text-faint transition-colors hover:text-foreground"
              >
                open &amp; edit
              </button>
              <button
                type="button"
                onClick={() => void handleDownload(report.weekStart)}
                className="cursor-pointer px-1 text-[11px] text-faint transition-colors hover:text-foreground"
              >
                download
              </button>
            </div>
          ))
        )}
      </Panel>
    </>
  )
}
