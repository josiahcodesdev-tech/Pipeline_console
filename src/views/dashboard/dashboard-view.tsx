import { useMemo } from 'react'
import { EmptyState, Panel, ViewHeader } from '@/components/panel'
import { KpiCard, type KpiTone } from '@/components/kpi-card'
import { PipelineBar } from '@/components/pipeline-bar'
import { usePipeline } from '@/hooks/use-pipeline'
import { TaskRow } from '@/views/tasks/task-row'
import {
  daysUntil,
  formatDate,
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

export function DashboardView() {
  const { leads, rfps, tasks, toggleTask } = usePipeline()

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

      <Panel title="RFP deadlines this week">
        {soonRfps.length === 0 ? (
          <EmptyState>No RFP deadlines in the next 7 days.</EmptyState>
        ) : (
          soonRfps.map((rfp) => {
            const left = daysUntil(rfp.deadline)
            return (
              <div
                key={rfp.id}
                className="flex items-center gap-2.5 border-b border-border-soft px-1 py-2 last:border-b-0"
              >
                <span className="flex-1 text-[12.5px]">
                  {rfp.title}
                  {rfp.org && <span className="text-faint"> — {rfp.org}</span>}
                </span>
                <span
                  className={cn(
                    'text-[11px] text-muted-foreground',
                    left !== null && left <= 2 && 'font-semibold text-danger',
                    left !== null && left > 2 && left <= 5 && 'text-warning',
                  )}
                >
                  {formatDate(rfp.deadline)}
                  {left !== null && ` (${left}d)`}
                </span>
              </div>
            )
          })
        )}
      </Panel>
    </>
  )
}
