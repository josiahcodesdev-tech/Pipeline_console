/**
 * Access levels, most privileged first.
 *
 * The database is the authority on these — every rule is a row-level security
 * policy, and the client's copy of the role only decides what to *show*. A
 * hidden button and a refused request are not the same protection, and only
 * the second one survives someone opening the console.
 */
export const MEMBER_ROLES = ['super_user', 'admin', 'user'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

export const ROLE_LABEL: Record<MemberRole, string> = {
  super_user: 'Super user',
  admin: 'Admin',
  user: 'User',
}

export const ROLE_DESCRIPTION: Record<MemberRole, string> = {
  super_user:
    'Full access, plus adding members and setting their access. Sees every pipeline.',
  admin:
    'Everything the super user has except two things: cannot add or manage members, and cannot delete records. Sees every pipeline, every activity and the firm-wide figures, and can run the sync.',
  user:
    'Works their own pipeline. Cannot delete records or run the sync by hand.',
}

/**
 * A tender someone has taken on, firm-wide.
 *
 * Scraped opportunities are stored per member, so "is anyone else bidding
 * this?" cannot be answered from a member's own rows. One claim per tender
 * across the whole firm answers it, and stops two people writing competing
 * proposals for the same buyer.
 */
export interface RfpClaim {
  /** The source's id for the notice — what every member's copy shares. */
  externalId: string
  claimedBy: string
  claimedAt: string
  title: string
}

/** A team member. One row per account, created with the account. */
export interface Profile {
  id: string
  email: string
  fullName: string
  role: MemberRole
  /** Cleared rather than deleted when someone leaves, so their work stays owned. */
  active: boolean
  createdAt: string
}

export function isMemberRole(value: unknown): value is MemberRole {
  return MEMBER_ROLES.includes(value as MemberRole)
}

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

export const LEAD_PRIORITIES = ['High', 'Medium', 'Low'] as const

/**
 * Kinds of logged activity. The first four are the outreach channels the job
 * description names; the next four are the conversion events it counts
 * ("paying clients, registrations, demos or proposals"); `Note` is the
 * catch-all for market intelligence that isn't an interaction.
 */
export const ACTIVITY_TYPES = [
  'Call',
  'Email',
  'LinkedIn',
  'Meeting request',
  'Meeting held',
  'Proposal sent',
  'Demo',
  'Registration',
  'Note',
] as const

/** Activity types that count toward the monthly Conversion KPI. */
export const CONVERSION_ACTIVITY_TYPES = [
  'Meeting held',
  'Proposal sent',
  'Demo',
  'Registration',
] as const

/** Activity types that count as client communication (the daily KPI). */
export const COMMUNICATION_ACTIVITY_TYPES = [
  'Call',
  'Email',
  'LinkedIn',
  'Meeting request',
  'Meeting held',
] as const

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
export type LeadPriority = (typeof LEAD_PRIORITIES)[number]
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

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

  // Qualification — "need, timing, decision process, budget potential and fit".
  priority: LeadPriority
  needs: string
  budgetBand: string
  decisionTimeline: string
  decisionProcess: string

  createdOn: IsoDate
  statusUpdatedOn: IsoDate
}

/**
 * A logged interaction. Distinct from a Task: a task is what you intend to do,
 * an activity is what actually happened — which is what the communication-log
 * KPI asks you to evidence.
 */
export interface Activity {
  id: string
  /**
   * Who logged it. Everyone sees their own; admins and the super user see
   * everyone's, and then need to know whose each entry is.
   */
  userId: string
  /** Parent lead, if any. */
  leadId: string | null
  /** Parent RFP, if any. */
  rfpId: string | null
  type: ActivityType
  occurredOn: IsoDate
  summary: string
  outcome: string
}

export function isActivityType(value: unknown): value is ActivityType {
  return ACTIVITY_TYPES.includes(value as ActivityType)
}

export function isLeadPriority(value: unknown): value is LeadPriority {
  return LEAD_PRIORITIES.includes(value as LeadPriority)
}

export interface Rfp {
  id: string
  /**
   * The member this copy belongs to — who took the tender on. Every member
   * holds their own copy of a scraped tender, so on an oversight read this is
   * the only thing that distinguishes two rows for the same opportunity.
   */
  ownerId: string
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
   * True once this has been taken on as a live proposal. Distinct from
   * `status`: the tracker holds every scraped tender, most of which is out of
   * scope, and a tender can sit at Watching for weeks while you decide.
   */
  inPipeline: boolean
  /**
   * The feed's `type`: "rfp", "job", or "" when it did not say. Worth keeping
   * because ReliefWeb files consultancy assignments under "job", so the label
   * is a hint to triage by, not a filter to trust.
   */
  opportunityType: string
  /** The feed's `kenya` flag — in, or relevant to, Kenya. */
  kenya: boolean
  /** The feed's `categories[]` service areas, comma-separated. */
  serviceAreas: string
  /**
   * Text of the tender document, extracted from an uploaded PDF in the browser.
   * Sent to the drafter so it writes against the real scope and evaluation
   * criteria rather than the notice alone. Empty when none is attached.
   */
  tenderText: string
  /** Filename the tender text came from, so its provenance is visible. */
  tenderFileName: string
  /**
   * How well this fits what the firm delivers, 0-100, scored at sync time from
   * weighted capability matches. A ranking heuristic, not a probability of
   * winning. Manually added RFPs and rows synced before the score existed sit
   * at 0 and sort last under "Best fit".
   */
  fitScore: number
  /**
   * Opportunity id from the CareerCraft public feed. `null` for anything added
   * by hand or pasted in as JSON — it is what makes re-syncing idempotent.
   */
  externalId: string | null
  createdOn: IsoDate
  /**
   * Full insertion timestamp. `createdOn` is date-only, so a batch synced in
   * one go would tie — this is what makes "newest first" a stable order.
   */
  createdAt: string
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

/** Reporting cadences the JD asks for: weekly portfolio, monthly, quarterly. */
export const REPORT_PERIODS = ['week', 'month', 'quarter'] as const
export type ReportPeriod = (typeof REPORT_PERIODS)[number]

export const REPORT_PERIOD_LABEL: Record<ReportPeriod, string> = {
  week: 'Weekly',
  month: 'Monthly',
  quarter: 'Quarterly',
}

export interface WeeklyReport {
  id: string
  /** First day of the period covered — read together with `period`. */
  weekStart: IsoDate
  period: ReportPeriod
  revenue: number | null
  notes: string
  submitted: boolean
}

export function isReportPeriod(value: unknown): value is ReportPeriod {
  return REPORT_PERIODS.includes(value as ReportPeriod)
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

/** Kinds of proposal record kept against an RFP. */
export const PROPOSAL_KINDS = ['draft', 'submitted'] as const
export type ProposalKind = (typeof PROPOSAL_KINDS)[number]

/**
 * Something written for an RFP. A `draft` holds generated text so it survives
 * closing the tab; a `submitted` record points at the file that actually went
 * to the buyer.
 */
export interface Proposal {
  id: string
  rfpId: string
  kind: ProposalKind
  title: string
  content: string
  /** Storage object path. Empty on drafts. */
  filePath: string
  fileName: string
  fileSize: number | null
  notes: string
  /** Use as a worked example when drafting new proposals. */
  isExemplar: boolean
  createdAt: string
}

export function isProposalKind(value: unknown): value is ProposalKind {
  return PROPOSAL_KINDS.includes(value as ProposalKind)
}

/**
 * What the drafter has been taught. Injected into the prompt at draft time —
 * prompt engineering, not fine-tuning, so it takes effect on the next draft.
 */
export interface UserSettings {
  proposalGuidance: string
  conceptGuidance: string
  boilerplate: string
}

export const EMPTY_SETTINGS: UserSettings = {
  proposalGuidance: '',
  conceptGuidance: '',
  boilerplate: '',
}

/**
 * Someone who can be staffed onto a bid.
 *
 * Exists to answer the team-composition section of a proposal with real people.
 * The fields are deliberately the ones an evaluator scores — qualifications,
 * years, sectors, countries and what the person has actually delivered — rather
 * than a general profile.
 *
 * Several fields are comma-separated free text (`coreExpertise`, `sectors`,
 * `countries`). They are read by a language model rather than joined against,
 * so a phrase is worth as much as a foreign key and costs far less.
 */
export interface Consultant {
  id: string
  name: string
  /** e.g. "Senior MEL Specialist". */
  title: string
  /** Comma-separated tags, e.g. "Monitoring & Evaluation, Grant Writing". */
  coreExpertise: string
  yearsExperience: number | null
  sectors: string
  countries: string
  qualifications: string
  /**
   * The RFP components this person should be put forward for. Weighted most
   * heavily when the drafter picks a team, because it is written in the
   * language of the work rather than of the person.
   */
  taskFit: string
  projectExperience: string
  languages: string
  availability: string
  /** ~50 words, ready to drop into a team-composition table. */
  shortBio: string
  /** ~150 words, for a CV annex or a detailed technical proposal. */
  longBio: string

  /** Storage path of the profile photo. Empty when none is attached. */
  photoPath: string
  /**
   * Storage path of the CV. Almost every tender asks for one as an annex, so
   * this is the file the bid team actually attaches rather than a summary of it.
   */
  cvPath: string
  cvFileName: string
  cvSize: number | null
}

export const EMPTY_CONSULTANT: Omit<Consultant, 'id'> = {
  name: '',
  title: '',
  coreExpertise: '',
  yearsExperience: null,
  sectors: '',
  countries: '',
  qualifications: '',
  taskFit: '',
  projectExperience: '',
  languages: '',
  availability: '',
  shortBio: '',
  longBio: '',
  photoPath: '',
  cvPath: '',
  cvFileName: '',
  cvSize: null,
}
