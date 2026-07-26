import { addDays, inRange, today, weekEnd } from './dates'
import {
  ACTIVE_LEAD_STATUSES,
  ACTIVE_RFP_STATUSES,
  PIPELINE_STAGES,
  QUALIFIED_STATUSES,
  type IsoDate,
  type Lead,
  type LeadStatus,
  type Rfp,
  type RfpStatus,
  type Task,
} from './types'

/**
 * Every number the console reports is derived here, so the dashboard, the
 * progress charts and the weekly report can never disagree about what
 * "qualified this week" means.
 */

export function isQualified(status: LeadStatus): boolean {
  return (QUALIFIED_STATUSES as readonly string[]).includes(status)
}

export function isActiveRfp(status: RfpStatus): boolean {
  return (ACTIVE_RFP_STATUSES as readonly string[]).includes(status)
}

export function isActiveLead(status: LeadStatus): boolean {
  return (ACTIVE_LEAD_STATUSES as readonly string[]).includes(status)
}

/** Head-count per pipeline stage, in stage order. */
export function pipelineCounts(leads: Lead[]): { stage: LeadStatus; count: number }[] {
  return PIPELINE_STAGES.map((stage) => ({
    stage,
    count: leads.filter((lead) => lead.status === stage).length,
  }))
}

/**
 * Leads that reached (or passed) Qualified during the given week.
 * Keyed off `statusUpdatedOn`, which only moves on an actual status change.
 */
export function qualifiedInWeek(
  leads: Lead[],
  start: IsoDate,
  end: IsoDate,
): number {
  return leads.filter(
    (lead) => isQualified(lead.status) && inRange(lead.statusUpdatedOn, start, end),
  ).length
}

/**
 * Share of actively-worked leads that have a next action booked. This is the
 * discipline metric: a Contacted lead with no next step is a dropped ball.
 * Returns 100 when there is nothing to track, so an empty pipeline is not a
 * failing grade.
 */
export function followUpDiscipline(leads: Lead[]): number {
  const active = leads.filter((lead) => isActiveLead(lead.status))
  if (active.length === 0) return 100
  const booked = active.filter((lead) => lead.nextActionDate).length
  return Math.round((booked / active.length) * 100)
}

export function activeRfpCount(rfps: Rfp[]): number {
  return rfps.filter((rfp) => isActiveRfp(rfp.status)).length
}

/** Not-yet-done tasks whose due date is today or in the past. */
export function dueOrOverdueTasks(tasks: Task[], asOf: IsoDate = today()): Task[] {
  return tasks
    .filter((task) => !task.done && task.due && task.due <= asOf)
    .sort((a, b) => a.due.localeCompare(b.due))
}

/** Open RFPs with a deadline inside the next `days` days, soonest first. */
export function upcomingRfpDeadlines(
  rfps: Rfp[],
  days: number,
  asOf: IsoDate = today(),
): Rfp[] {
  const limit = addDays(asOf, days)
  return rfps
    .filter(
      (rfp) =>
        (rfp.status === 'Watching' || rfp.status === 'Preparing') &&
        rfp.deadline &&
        rfp.deadline <= limit,
    )
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
}

export interface WeekMetrics {
  weekStart: IsoDate
  weekEnd: IsoDate
  newLeads: number
  qualified: number
  /** Leads *and* RFPs marked Won during the week. */
  wins: number
  /** Leads won during the week, excluding RFPs — used in the copy-ready text. */
  leadWins: number
  tasksCompleted: number
  followUpPct: number
  activeRfps: number
}

export function weekMetrics(
  start: IsoDate,
  leads: Lead[],
  rfps: Rfp[],
  tasks: Task[],
): WeekMetrics {
  const end = weekEnd(start)
  const leadWins = leads.filter(
    (lead) => lead.status === 'Won' && inRange(lead.statusUpdatedOn, start, end),
  ).length
  const rfpWins = rfps.filter(
    (rfp) => rfp.status === 'Won' && inRange(rfp.statusUpdatedOn, start, end),
  ).length

  return {
    weekStart: start,
    weekEnd: end,
    newLeads: leads.filter((lead) => inRange(lead.createdOn, start, end)).length,
    qualified: qualifiedInWeek(leads, start, end),
    wins: leadWins + rfpWins,
    leadWins,
    tasksCompleted: tasks.filter(
      (task) => task.done && inRange(task.completedOn, start, end),
    ).length,
    followUpPct: followUpDiscipline(leads),
    activeRfps: activeRfpCount(rfps),
  }
}
