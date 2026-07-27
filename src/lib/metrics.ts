import { addDays, inRange, today, weekEnd } from './dates'
import {
  ACTIVE_LEAD_STATUSES,
  ACTIVE_RFP_STATUSES,
  COMMUNICATION_ACTIVITY_TYPES,
  CONVERSION_ACTIVITY_TYPES,
  PIPELINE_STAGES,
  QUALIFIED_STATUSES,
  type Activity,
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

/**
 * Open RFPs whose deadline falls on or before `days` from now, soonest first.
 *
 * Deliberately has no lower bound: an RFP still sitting in Watching or
 * Preparing after its deadline has passed is the most urgent thing on the
 * board, not the least, so it stays in the list and the UI marks it overdue.
 * Anything already Submitted, Won, or Lost drops out — the deadline no longer
 * matters once it has been acted on.
 */
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

/** Outreach logged in a date range — evidence for the Client communication KPI. */
export function communicationsInRange(
  activities: Activity[],
  start: IsoDate,
  end: IsoDate,
): number {
  return activities.filter(
    (activity) =>
      (COMMUNICATION_ACTIVITY_TYPES as readonly string[]).includes(activity.type) &&
      inRange(activity.occurredOn, start, end),
  ).length
}

/**
 * Conversions in a date range.
 *
 * The job description counts "leads converted into paying clients,
 * registrations, demos or proposals" — broader than a lead reaching Won, so a
 * booked demo or a submitted proposal counts even when the lead is still open.
 * Leads and RFPs marked Won are counted too, and the two sources are summed
 * rather than deduplicated: they are different events on the same account.
 */
export function conversionsInRange(
  activities: Activity[],
  leads: Lead[],
  rfps: Rfp[],
  start: IsoDate,
  end: IsoDate,
): number {
  const fromActivities = activities.filter(
    (activity) =>
      (CONVERSION_ACTIVITY_TYPES as readonly string[]).includes(activity.type) &&
      inRange(activity.occurredOn, start, end),
  ).length

  const wonLeads = leads.filter(
    (lead) => lead.status === 'Won' && inRange(lead.statusUpdatedOn, start, end),
  ).length

  const wonRfps = rfps.filter(
    (rfp) => rfp.status === 'Won' && inRange(rfp.statusUpdatedOn, start, end),
  ).length

  return fromActivities + wonLeads + wonRfps
}

/** Leads with no logged activity at all — the ones quietly going cold. */
export function untouchedLeads(leads: Lead[], activities: Activity[]): Lead[] {
  const touched = new Set(
    activities.map((activity) => activity.leadId).filter(Boolean) as string[],
  )
  return leads.filter(
    (lead) => !touched.has(lead.id) && lead.status !== 'Lost' && lead.status !== 'Won',
  )
}

export interface WeekMetrics {
  weekStart: IsoDate
  weekEnd: IsoDate
  newLeads: number
  qualified: number
  /** Leads *and* RFPs marked Won during the period. */
  wins: number
  /** Leads won during the period, excluding RFPs — used in the copy-ready text. */
  leadWins: number
  /** The JD's broader Conversion KPI: wins plus demos, proposals, registrations. */
  conversions: number
  /** Logged calls, emails, LinkedIn messages and meetings. */
  communications: number
  /** Meeting requests sent — a named weekly deliverable. */
  meetingRequests: number
  tasksCompleted: number
  followUpPct: number
  activeRfps: number
}

export interface MetricsInput {
  leads: Lead[]
  rfps: Rfp[]
  tasks: Task[]
  activities: Activity[]
}

/**
 * Every figure the reports quote, for an arbitrary date range.
 *
 * Ranges are inclusive on both ends, so a week, a month and a quarter all go
 * through here — the reporting cadence is a choice of `start`/`end`, not a
 * different set of calculations.
 */
export function periodMetrics(
  start: IsoDate,
  end: IsoDate,
  { leads, rfps, tasks, activities }: MetricsInput,
): WeekMetrics {
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
    conversions: conversionsInRange(activities, leads, rfps, start, end),
    communications: communicationsInRange(activities, start, end),
    meetingRequests: activities.filter(
      (activity) =>
        activity.type === 'Meeting request' &&
        inRange(activity.occurredOn, start, end),
    ).length,
    tasksCompleted: tasks.filter(
      (task) => task.done && inRange(task.completedOn, start, end),
    ).length,
    followUpPct: followUpDiscipline(leads),
    activeRfps: activeRfpCount(rfps),
  }
}

/** Convenience wrapper for the Monday-to-Sunday case. */
export function weekMetrics(start: IsoDate, input: MetricsInput): WeekMetrics {
  return periodMetrics(start, weekEnd(start), input)
}
