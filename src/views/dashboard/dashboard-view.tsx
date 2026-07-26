import { useMemo } from 'react'
import { ExternalLinkIcon } from 'lucide-react'
import { EmptyState, Panel, ViewHeader } from '@/components/panel'
import { KpiCard, type KpiTone } from '@/components/kpi-card'
import { PipelineBar } from '@/components/pipeline-bar'
import { RfpStatusSelect } from '@/components/status-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { usePipeline } from '@/hooks/use-pipeline'
import { TaskRow } from '@/views/tasks/task-row'
import {
  daysUntil,
  formatDateWithYear,
  formatToday,
  today,
  weekEnd,
  weekStart,
} from '@/lib/dates'
import {
  activeRfpCount,
  dueOrOverdueTasks,
  followUpDiscipline,
  qualifiedInWeek,
  upcomingRfpDeadlines,
} from '@/lib/metrics'
import { cn } from '@/lib/utils'
import type { Lead } from '@/lib/types'

function disciplineTone(pct: number): KpiTone {
  if (pct >= 80) return 'good'
  if (pct >= 50) return 'warn'
  return 'bad'
}

/**
 * Deadline with how long is left, or how long it has been missed.
 *
 * "24 Jul (-2d)" was ambiguous — a negative day count reads as a typo rather
 * than a warning — so overdue is spelled out.
 */
function DeadlineCell({ deadline }: { deadline: string }) {
  const left = daysUntil(deadline)

  if (left === null) return <span className="text-muted-foreground">—</span>

  const overdue = left < 0
  const label = overdue
    ? `${Math.abs(left)}d overdue`
    : left === 0
      ? 'due today'
      : `in ${left}d`

  return (
    <span
      className={cn(
        'flex flex-col gap-0.5',
        overdue || left <= 2
          ? 'text-danger'
          : left <= 5
            ? 'text-warning'
            : 'text-foreground',
      )}
    >
      <span className="font-medium">{formatDateWithYear(deadline)}</span>
      <span className={cn('text-[11px]', (overdue || left === 0) && 'font-semibold')}>
        {label}
      </span>
    </span>
  )
}

export function DashboardView() {
  const { leads, rfps, tasks, toggleTask, setRfpStatus } = usePipeline()

  const leadsById = useMemo(() => {
    const map = new Map<string, Lead>()
    for (const lead of leads) map.set(lead.id, lead)
    return map
  }, [leads])

  const start = weekStart(today())
  const qualified = qualifiedInWeek(leads, start, weekEnd(start))
  const discipline = followUpDiscipline(leads)
  const activeRfps = activeRfpCount(rfps)
  const dueTasks = dueOrOverdueTasks(tasks)
  const soonRfps = upcomingRfpDeadlines(rfps, 7)
  const overdueCount = soonRfps.filter((rfp) => {
    const left = daysUntil(rfp.deadline)
    return left !== null && left < 0
  }).length

  return (
    <>
      <ViewHeader
        title="Dashboard"
        meta={<div className="text-[11px] text-muted-foreground">{formatToday()}</div>}
      />

      <PipelineBar leads={leads} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Qualified this week" value={qualified} />
        <KpiCard
          label="Follow-up discipline"
          value={`${discipline}%`}
          tone={disciplineTone(discipline)}
        />
        <KpiCard label="Active RFPs" value={activeRfps} />
        <KpiCard
          label="Tasks due / overdue"
          value={dueTasks.length}
          tone={dueTasks.length > 0 ? 'warn' : 'good'}
        />
      </div>

      <Panel title="Due today & overdue">
        {dueTasks.length === 0 ? (
          <EmptyState>Nothing overdue — you&rsquo;re current.</EmptyState>
        ) : (
          dueTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              lead={task.linkedLead ? leadsById.get(task.linkedLead) : undefined}
              overdue
              onToggle={(id, done) => void toggleTask(id, done)}
            />
          ))
        )}
      </Panel>

      <Panel
        title="RFP deadlines"
        action={
          overdueCount > 0 ? (
            <span className="text-[11px] font-semibold text-danger">
              {overdueCount} overdue
            </span>
          ) : (
            <span className="text-[11px] text-faint">Next 7 days</span>
          )
        }
        bodyClassName="overflow-x-auto"
      >
        {soonRfps.length === 0 ? (
          <EmptyState>
            Nothing closing in the next 7 days, and nothing overdue.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {soonRfps.map((rfp) => (
                <TableRow key={rfp.id}>
                  <TableCell className="max-w-[420px] font-medium">
                    {rfp.link ? (
                      <a
                        href={rfp.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex items-start gap-1 text-primary hover:underline"
                        title="Open the original notice in a new tab"
                      >
                        <span>{rfp.title}</span>
                        <ExternalLinkIcon className="mt-0.5 size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
                      </a>
                    ) : (
                      rfp.title
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {rfp.org || '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <DeadlineCell deadline={rfp.deadline} />
                  </TableCell>
                  <TableCell>
                    {/* Editable here too: this panel is where the urgent ones
                        surface, so acting on them shouldn't need a detour via
                        the RFPs view. */}
                    <RfpStatusSelect
                      value={rfp.status}
                      onChange={(next) => setRfpStatus(rfp.id, next)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </>
  )
}
