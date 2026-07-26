export const SEGMENTS = [
  'Government',
  'NGO',
  'Corporate',
  'SOE',
  'University',
  'Development Partner',
] as const

export const LEAD_STATUSES = [
  'New',
  'Contacted',
  'Qualified',
  'Handed Over',
  'Won',
  'Lost',
] as const

export const RFP_STATUSES = [
  'Watching',
  'Preparing',
  'Submitted',
  'Won',
  'Lost',
] as const

export const TASK_PRIORITIES = ['Normal', 'High'] as const

/** The stages shown in the dashboard's pipeline bar, in order. `Lost` is
 *  deliberately excluded — it is an exit, not a stage. */
export const PIPELINE_STAGES = [
  'New',
  'Contacted',
  'Qualified',
  'Handed Over',
  'Won',
] as const

/** Statuses that count as "this lead has been qualified" for reporting. */
export const QUALIFIED_STATUSES = ['Qualified', 'Handed Over', 'Won'] as const

/** RFP statuses that still represent live pipeline. */
export const ACTIVE_RFP_STATUSES = ['Watching', 'Preparing', 'Submitted'] as const

/** Lead statuses that are actively being worked and so need a next action. */
export const ACTIVE_LEAD_STATUSES = ['Contacted', 'Qualified'] as const

export type Segment = (typeof SEGMENTS)[number]
export type LeadStatus = (typeof LEAD_STATUSES)[number]
export type RfpStatus = (typeof RFP_STATUSES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

/** An ISO `YYYY-MM-DD` calendar date. Empty string means "not set". */
export type IsoDate = string

export interface Lead {
  id: string
  org: string
  segment: Segment
  country: string
  contactName: string
  contactRole: string
  email: string
  phone: string
  status: LeadStatus
  nextActionDate: IsoDate
  source: string
  notes: string
  createdOn: IsoDate
  statusUpdatedOn: IsoDate
}

export interface Rfp {
  id: string
  title: string
  org: string
  segment: Segment
  deadline: IsoDate
  /** Estimated value in KES. `null` when not yet known. */
  value: number | null
  status: RfpStatus
  link: string
  notes: string
  source: string
  sourced: boolean
  /**
   * Opportunity id from the CareerCraft public feed. `null` for anything added
   * by hand or pasted in as JSON — it is what makes re-syncing idempotent.
   */
  externalId: string | null
  createdOn: IsoDate
  statusUpdatedOn: IsoDate
}

export interface Task {
  id: string
  text: string
  due: IsoDate
  priority: TaskPriority
  linkedLead: string | null
  done: boolean
  completedOn: IsoDate
  createdOn: IsoDate
}

export interface WeeklyReport {
  id: string
  weekStart: IsoDate
  revenue: number | null
  notes: string
  submitted: boolean
}

/** Payload accepted by the RFP JSON importer. Everything but `title` optional. */
export interface RfpImportItem {
  title?: unknown
  org?: unknown
  segment?: unknown
  deadline?: unknown
  value?: unknown
  link?: unknown
  notes?: unknown
  source?: unknown
}

export function isSegment(value: unknown): value is Segment {
  return SEGMENTS.includes(value as Segment)
}

export function isLeadStatus(value: unknown): value is LeadStatus {
  return LEAD_STATUSES.includes(value as LeadStatus)
}

export function isRfpStatus(value: unknown): value is RfpStatus {
  return RFP_STATUSES.includes(value as RfpStatus)
}
