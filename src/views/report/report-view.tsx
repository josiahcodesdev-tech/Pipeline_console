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
import { useAuth } from '@/hooks/use-auth'
import { SystemReportPanel } from '@/components/system-report-panel'
import { cn } from '@/lib/utils'
import {
  formatDate,
  formatPeriod,
  periodOffset,
  periodRange,
  today,
} from '@/lib/dates'
import { periodMetrics } from '@/lib/metrics'
import { buildReportText, downloadReportDocx } from '@/lib/report-export'
import {
  REPORT_PERIODS,
  REPORT_PERIOD_LABEL,
  type IsoDate,
  type ReportPeriod,
} from '@/lib/types'

const SUBMITTED_OPTIONS = ['Not yet', 'Yes — submitted'] as const
type SubmittedOption = (typeof SUBMITTED_OPTIONS)[number]

export function ReportView() {
  const { leads, rfps, tasks, activities, reports, saveReport } = usePipeline()
  const { can } = useAuth()
  const [period, setPeriod] = useState<ReportPeriod>('week')
  // Offset in whole periods from the one containing today; 0 is current.
  const [offset, setOffset] = useState(0)
  const [revenue, setRevenue] = useState('')
  const [notes, setNotes] = useState('')
  const [submitted, setSubmitted] = useState<SubmittedOption>('Not yet')
  const [busy, setBusy] = useState(false)

  const range = useMemo(() => periodRange(period, today(), offset), [period, offset])
  const selectedWeek = range.start

  const saved = useMemo(
    () =>
      reports.find(
        (report) => report.weekStart === selectedWeek && report.period === period,
      ) ?? null,
    [reports, selectedWeek, period],
  )

  // Load the stored inputs whenever the visible period changes.
  useEffect(() => {
    setRevenue(saved?.revenue != null ? String(saved.revenue) : '')
    setNotes(saved?.notes ?? '')
    setSubmitted(saved?.submitted ? 'Yes — submitted' : 'Not yet')
  }, [saved, selectedWeek, period])

  const metrics = useMemo(
    () => periodMetrics(range.start, range.end, { leads, rfps, tasks, activities }),
    [range, leads, rfps, tasks, activities],
  )

  const isCurrent = offset === 0
  const periodLabel = formatPeriod(period, selectedWeek)

  const revenueValue = revenue.trim() === '' ? null : Number(revenue)
  const payload = {
    metrics,
    revenue: Number.isFinite(revenueValue) ? revenueValue : null,
    notes,
    label: periodLabel,
  }
  const reportText = buildReportText(payload)

  async function handleSave() {
    setBusy(true)
    try {
      await saveReport({
        weekStart: selectedWeek,
        period,
        revenue: payload.revenue,
        notes,
        submitted: submitted === 'Yes — submitted',
      })
      toast.success(`Saved — ${periodLabel}`)
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

  async function handleDownload(start: IsoDate, forPeriod: ReportPeriod) {
    try {
      const isOpen = start === selectedWeek && forPeriod === period
      const stored = reports.find(
        (report) => report.weekStart === start && report.period === forPeriod,
      )
      // Re-derive the range from the stored start, so an older report exports
      // the figures for its own period rather than the one on screen.
      const storedRange = periodRange(forPeriod, start, 0)
      await downloadReportDocx(
        isOpen
          ? payload
          : {
              metrics: periodMetrics(storedRange.start, storedRange.end, {
                leads,
                rfps,
                tasks,
                activities,
              }),
              revenue: stored?.revenue ?? null,
              notes: stored?.notes ?? '',
              label: formatPeriod(forPeriod, start),
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
        title="Portfolio report"
        description="Figures are counted from the pipeline automatically; revenue and lessons are yours to add. Export as Word when it is ready to send."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* Cadence first — it changes what Prev/Next mean. */}
            <div className="flex rounded-lg border border-border bg-card p-0.5 shadow-brand-sm">
              {REPORT_PERIODS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setPeriod(option)
                    setOffset(0)
                  }}
                  className={cn(
                    'cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors',
                    period === option
                      ? 'bg-brand-soft text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {REPORT_PERIOD_LABEL[option]}
                </button>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset(offset - 1)}
              aria-label={`Previous ${period}`}
            >
              <ChevronLeftIcon />
            </Button>
            <div className="min-w-[150px] text-center text-[11px] text-muted-foreground">
              {periodLabel}
              {isCurrent && ' (current)'}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset(offset + 1)}
              aria-label={`Next ${period}`}
              disabled={isCurrent}
            >
              <ChevronRightIcon />
            </Button>
            <Button size="sm" onClick={() => setOffset(0)} disabled={isCurrent}>
              Current
            </Button>
          </div>
        }
      />

      <div className="mb-5 text-[11px] text-faint">
        {formatDate(range.start)} – {formatDate(range.end)}
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="New leads added" value={metrics.newLeads} />
        <KpiCard label="Leads qualified" value={metrics.qualified} />
        <KpiCard
          label="Conversions"
          value={metrics.conversions}
          hint="Wins, proposals, demos, registrations"
        />
        <KpiCard
          label="Communications logged"
          value={metrics.communications}
          hint="Calls, emails, messages, meetings"
        />
        <KpiCard label="Meeting requests" value={metrics.meetingRequests} />
        <KpiCard label="Follow-up discipline" value={`${metrics.followUpPct}%`} />
        <KpiCard label="Follow-ups completed" value={metrics.tasksCompleted} />
        <KpiCard label="Active RFPs in pipeline" value={metrics.activeRfps} />
      </div>

      <Panel title={`${REPORT_PERIOD_LABEL[period]} manual inputs`}>
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
            Save this report
          </Button>
          <Button variant="outline" onClick={() => void handleCopy()}>
            Copy as text
          </Button>
          <Button variant="outline" onClick={() => void handleDownload(selectedWeek, period)}>
            <DownloadIcon />
            Download as Word
          </Button>
        </div>
      </Panel>

      {/* Super user only: it is a report on the tool rather than on the work,
          and it is the person answering for the tool who is asked for it. */}
      {can.manageMembers && <SystemReportPanel />}

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
                {formatPeriod(report.period, report.weekStart)}
                <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {REPORT_PERIOD_LABEL[report.period]}
                </span>
                {report.weekStart === selectedWeek && report.period === period && (
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
                onClick={() => {
                  setPeriod(report.period)
                  setOffset(periodOffset(report.period, report.weekStart))
                }}
                className="cursor-pointer px-1 text-[11px] text-faint transition-colors hover:text-foreground"
              >
                open &amp; edit
              </button>
              <button
                type="button"
                onClick={() => void handleDownload(report.weekStart, report.period)}
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
