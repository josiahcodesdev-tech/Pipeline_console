import type { PostgrestSingleResponse } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { today } from './dates'
import {
  isActivityType,
  isLeadPriority,
  isLeadStatus,
  isReportPeriod,
  isProposalKind,
  isRfpStatus,
  isSegment,
  type Activity,
  type Lead,
  type Proposal,
  type UserSettings,
  EMPTY_SETTINGS,
  type LeadStatus,
  type Rfp,
  type RfpClaim,
  type RfpStatus,
  type Consultant,
  type Task,
  type TaskPriority,
  type WeeklyReport,
} from './types'
import type {
  ActivityRow,
  ConsultantRow,
  LeadRow,
  ProposalRow,
  RfpRow,
  TaskRow,
  WeeklyReportRow,
} from './database.types'

/**
 * The single boundary between the Postgres row shape (snake_case, nullable)
 * and the app's domain shape (camelCase, never-null strings). Everything above
 * this file works with the domain types only.
 */

export type LeadDraft = Omit<Lead, 'id' | 'createdOn' | 'statusUpdatedOn'>
// `inPipeline` is deliberately not part of the draft: it is set by the
// add/remove action, not by the edit form, so saving a dialog can never
// silently pull something out of the pipeline.
// `ownerId` is omitted with them: the owner comes from the session at write
// time, so a form that could set it would be a form that could hand a tender
// to someone else.
export type RfpDraft = Omit<
  Rfp,
  | 'id'
  | 'ownerId'
  | 'createdOn'
  | 'createdAt'
  | 'statusUpdatedOn'
  | 'sourced'
  | 'externalId'
  | 'inPipeline'
  // Written by reading the tender, not by the edit form — the same reasoning
  // as the file fields on a consultant. See migration 0030.
  | 'noticeText'
  | 'analysis'
  | 'analysedAt'
>
export type TaskDraft = Omit<Task, 'id' | 'done' | 'completedOn' | 'createdOn'>
// The file fields are omitted: they are set by uploading, not by editing the
// form, and `consultantFields` never writes them. Leaving them on the draft
// would invite someone to assign a path and wonder why nothing happened.
export type ConsultantDraft = Omit<
  Consultant,
  'id' | 'photoPath' | 'cvPath' | 'cvFileName' | 'cvSize'
>
export type WeeklyReportDraft = Omit<WeeklyReport, 'id'>

/**
 * Unwraps a PostgREST result, turning its error into a thrown `Error`.
 * Typed against `PostgrestSingleResponse` because the response is a
 * discriminated union — `data` and `error` are never both meaningful.
 * List queries return `PostgrestResponse<T>`, which is the same shape with
 * `T[]` as the payload.
 */
function unwrap<T>(result: PostgrestSingleResponse<T>): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('Supabase returned no data')
  return result.data
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw new Error(error.message)
  if (!data.user) throw new Error('Not signed in')
  return data.user.id
}

// ------------------------------------------------------------- mappers -----

function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    org: row.org,
    segment: isSegment(row.segment) ? row.segment : 'Government',
    country: row.country ?? '',
    contactName: row.contact_name ?? '',
    contactRole: row.contact_role ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    status: isLeadStatus(row.status) ? row.status : 'New',
    nextActionDate: row.next_action_date ?? '',
    source: row.source ?? '',
    notes: row.notes ?? '',
    priority: isLeadPriority(row.priority) ? row.priority : 'Medium',
    needs: row.needs ?? '',
    budgetBand: row.budget_band ?? '',
    decisionTimeline: row.decision_timeline ?? '',
    decisionProcess: row.decision_process ?? '',
    location: row.location ?? '',
    natureOfBusiness: row.nature_of_business ?? '',
    createdOn: row.created_on,
    statusUpdatedOn: row.status_updated_on ?? '',
  }
}

function toProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    rfpId: row.rfp_id,
    kind: isProposalKind(row.kind) ? row.kind : 'draft',
    title: row.title ?? '',
    content: row.content ?? '',
    filePath: row.file_path ?? '',
    fileName: row.file_name ?? '',
    fileSize: row.file_size,
    notes: row.notes ?? '',
    isExemplar: row.is_exemplar ?? false,
    createdAt: row.created_at,
  }
}

function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    userId: row.user_id,
    leadId: row.lead_id,
    rfpId: row.rfp_id,
    type: isActivityType(row.type) ? row.type : 'Note',
    occurredOn: row.occurred_on,
    summary: row.summary,
    outcome: row.outcome ?? '',
    visitingOfficers: row.visiting_officers ?? '',
    officialsMet: row.officials_met ?? '',
    reportDate: row.report_date ?? '',
    meetingPurpose: row.meeting_purpose ?? '',
    businessBackground: row.business_background ?? '',
    keyNeeds: row.key_needs ?? '',
    wayForward: row.way_forward ?? '',
    otherComments: row.other_comments ?? '',
  }
}

function toRfp(row: RfpRow): Rfp {
  return {
    id: row.id,
    ownerId: row.user_id,
    title: row.title,
    org: row.org ?? '',
    segment: isSegment(row.segment) ? row.segment : 'Government',
    deadline: row.deadline ?? '',
    value: row.value === null ? null : Number(row.value),
    status: isRfpStatus(row.status) ? row.status : 'Watching',
    link: row.link ?? '',
    notes: row.notes ?? '',
    source: row.source || 'Manual',
    sourced: row.sourced,
    inPipeline: row.in_pipeline,
    opportunityType: row.opportunity_type ?? '',
    kenya: row.kenya ?? false,
    serviceAreas: row.service_areas ?? '',
    fitScore: row.fit_score ?? 0,
    tenderText: row.tender_text ?? '',
    tenderFileName: row.tender_file_name ?? '',
    noticeText: row.notice_text ?? '',
    analysis: row.analysis ?? '',
    analysedAt: row.analysed_at ?? '',
    externalId: row.external_id,
    createdOn: row.created_on,
    createdAt: row.created_at,
    statusUpdatedOn: row.status_updated_on ?? '',
  }
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    text: row.text,
    due: row.due ?? '',
    priority: (row.priority === 'High' ? 'High' : 'Normal') satisfies TaskPriority,
    linkedLead: row.linked_lead,
    done: row.done,
    completedOn: row.completed_on ?? '',
    createdOn: row.created_on,
  }
}

function toWeeklyReport(row: WeeklyReportRow): WeeklyReport {
  return {
    id: row.id,
    weekStart: row.week_start,
    period: isReportPeriod(row.period) ? row.period : 'week',
    revenue: row.revenue === null ? null : Number(row.revenue),
    notes: row.notes ?? '',
    submitted: row.submitted,
  }
}

/** Date columns are nullable in Postgres; the domain uses `''` for "unset". */
function dateOrNull(iso: string): string | null {
  return iso ? iso : null
}

function leadFields(draft: LeadDraft) {
  return {
    org: draft.org,
    segment: draft.segment,
    country: draft.country,
    contact_name: draft.contactName,
    contact_role: draft.contactRole,
    email: draft.email,
    phone: draft.phone,
    status: draft.status,
    next_action_date: dateOrNull(draft.nextActionDate),
    source: draft.source,
    notes: draft.notes,
    priority: draft.priority,
    needs: draft.needs,
    budget_band: draft.budgetBand,
    decision_timeline: draft.decisionTimeline,
    decision_process: draft.decisionProcess,
    location: draft.location,
    nature_of_business: draft.natureOfBusiness,
  }
}

function rfpFields(draft: RfpDraft) {
  return {
    title: draft.title,
    org: draft.org,
    segment: draft.segment,
    deadline: dateOrNull(draft.deadline),
    value: draft.value,
    status: draft.status,
    link: draft.link,
    notes: draft.notes,
    source: draft.source,
    opportunity_type: draft.opportunityType,
    kenya: draft.kenya,
    service_areas: draft.serviceAreas,
    fit_score: draft.fitScore,
    tender_text: draft.tenderText,
    tender_file_name: draft.tenderFileName,
  }
}

// -------------------------------------------------------------- loading ----

export interface PipelineSnapshot {
  leads: Lead[]
  rfps: Rfp[]
  tasks: Task[]
  reports: WeeklyReport[]
  activities: Activity[]
  proposals: Proposal[]
  consultants: Consultant[]
  /** Per-table load failures. Empty when everything came back. */
  errors: string[]
}

/**
 * PostgREST's code for "table not in the schema cache" — in practice, a
 * migration that has not been run yet.
 */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01'
}

/**
 * Loads one table, degrading to an empty list rather than throwing.
 *
 * This used to be a single `Promise.all` where any failure threw, which meant
 * one unmigrated table blanked the entire console — indistinguishable from
 * data loss, and alarming for exactly the wrong reason. A table that cannot be
 * read should cost you that table, not the whole dataset.
 */
async function loadTable<Row, T>(
  name: string,
  query: PromiseLike<{ data: Row[] | null; error: { message: string; code?: string } | null }>,
  map: (row: Row) => T,
  hint: string,
): Promise<{ rows: T[]; error: string | null }> {
  try {
    const result = await query
    if (result.error) {
      return {
        rows: [],
        error: isMissingTable(result.error)
          ? `The "${name}" table does not exist yet — run ${hint}. Everything else still loaded.`
          : `Could not load ${name}: ${result.error.message}`,
      }
    }
    return { rows: (result.data ?? []).map(map), error: null }
  } catch (cause) {
    return {
      rows: [],
      error: `Could not load ${name}: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }
}

/** PostgREST stops at 1,000 rows a request, so anything larger is paged. */
const PAGE = 1000

/**
 * Reads a table in full, a page at a time.
 *
 * Only needed on the oversight path: a single member's working set is well
 * under the limit, but every member's copy of every tender is not — and a
 * truncated read is the worst kind, because it looks like a complete one.
 */
async function loadEveryPage<Row>(
  table: 'rfps' | 'leads' | 'activities' | 'proposals' | 'tasks',
  order: string,
): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(order, { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as Row[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

/**
 * Collapses every member's copy of a tender down to one row.
 *
 * Scraped opportunities are stored per member, so an admin reading across the
 * firm gets the same tender once per member — five copies of each with five
 * accounts. The tracker should show an opportunity once.
 *
 * The copy that is in somebody's pipeline wins, so the admin sees the live
 * state rather than an untouched duplicate of a tender already being bid.
 * Hand-added RFPs are keyed by their own id: two members each entering one by
 * hand really are two records, not a duplicate.
 */
function onePerTender(rfps: Rfp[]): Rfp[] {
  const byTender = new Map<string, Rfp>()
  for (const rfp of rfps) {
    const key = rfp.externalId ?? `own:${rfp.id}`
    const held = byTender.get(key)
    if (!held || (rfp.inPipeline && !held.inPipeline)) byTender.set(key, rfp)
  }
  return [...byTender.values()]
}

/**
 * The working set for the signed-in member.
 *
 * Normally scoped to their own rows. An admin or the super user gets the whole
 * firm's instead — that is the point of the role, and without it the console
 * asked only for rows the reader owned, so an admin account that owns nothing
 * opened an empty tracker while row-level security would happily have shown
 * them everything.
 *
 * The breadth costs two things, both handled here: the read has to be paged
 * past PostgREST's 1,000-row limit, and the tenders have to be collapsed to one
 * row each or the tracker shows every member's copy.
 */
export async function fetchAll(seeEveryone = false): Promise<PipelineSnapshot> {
  const mine = await currentUserId()

  if (seeEveryone) {
    // The oversight read. Deliberately a separate path rather than a flag
    // threaded through the one below: it pages, it collapses tenders, and it
    // has different failure characteristics, and interleaving the two made
    // both harder to follow than writing them out.
    const [leads, rfps, tasks, activities, proposals] = await Promise.all([
      loadEveryPage<LeadRow>('leads', 'created_at'),
      loadEveryPage<RfpRow>('rfps', 'created_at'),
      loadEveryPage<TaskRow>('tasks', 'created_at'),
      loadEveryPage<ActivityRow>('activities', 'occurred_on'),
      loadEveryPage<ProposalRow>('proposals', 'created_at'),
    ])
    // Reports and consultants stay the reader's own: a weekly report is a
    // personal submission, and the consultant roster is per-account by design.
    const [reports, consultants] = await Promise.all([
      loadTable(
        'weekly_reports',
        supabase.from('weekly_reports').select('*').eq('user_id', mine).order('week_start', { ascending: false }),
        toWeeklyReport,
        'migration 0001',
      ),
      loadTable(
        'consultants',
        supabase.from('consultants').select('*').eq('user_id', mine).order('name', { ascending: true }),
        toConsultant,
        'migration 0010',
      ),
    ])

    return {
      leads: leads.map(toLead),
      rfps: onePerTender(rfps.map(toRfp)),
      tasks: tasks.map(toTask),
      reports: reports.rows,
      activities: activities.map(toActivity),
      proposals: proposals.map(toProposal),
      consultants: consultants.rows,
      errors: [reports, consultants].flatMap((result) => result.error ?? []),
    }
  }

  const [leads, rfps, tasks, reports, activities, proposals, consultants] = await Promise.all([
    loadTable(
      'leads',
      supabase.from('leads').select('*').eq('user_id', mine).order('created_at', { ascending: false }),
      toLead,
      'migration 0001',
    ),
    loadTable(
      'rfps',
      supabase
        .from('rfps')
        .select('*').eq('user_id', mine)
        // Newest first — the views sort too, but this keeps the raw
        // snapshot in the same order they present.
        .order('created_at', { ascending: false }),
      toRfp,
      'migration 0001',
    ),
    loadTable(
      'tasks',
      supabase
        .from('tasks')
        .select('*').eq('user_id', mine)
        .order('due', { ascending: true, nullsFirst: false }),
      toTask,
      'migration 0001',
    ),
    loadTable(
      'weekly reports',
      supabase
        .from('weekly_reports')
        .select('*').eq('user_id', mine)
        .order('week_start', { ascending: false }),
      toWeeklyReport,
      'migration 0001',
    ),
    loadTable(
      'activities',
      supabase
        .from('activities')
        .select('*').eq('user_id', mine)
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false }),
      toActivity,
      'migration 0003',
    ),
    loadTable(
      'proposals',
      supabase.from('proposals').select('*').eq('user_id', mine).order('created_at', { ascending: false }),
      toProposal,
      'migration 0007',
    ),
    loadTable(
      'consultants',
      supabase.from('consultants').select('*').eq('user_id', mine).order('name', { ascending: true }),
      toConsultant,
      'migration 0010',
    ),
  ])

  return {
    leads: leads.rows,
    rfps: rfps.rows,
    tasks: tasks.rows,
    reports: reports.rows,
    activities: activities.rows,
    proposals: proposals.rows,
    consultants: consultants.rows,
    errors: [leads, rfps, tasks, reports, activities, proposals, consultants]
      .map((result) => result.error)
      .filter((error): error is string => error !== null),
  }
}

// ----------------------------------------------------------- proposals -----

const PROPOSAL_BUCKET = 'proposals'

/** House rules and boilerplate the drafter is given. One row per user. */
export async function fetchSettings(): Promise<UserSettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return EMPTY_SETTINGS
  return {
    proposalGuidance: data.proposal_guidance ?? '',
    conceptGuidance: data.concept_guidance ?? '',
    boilerplate: data.boilerplate ?? '',
  }
}

export async function saveSettings(settings: UserSettings): Promise<UserSettings> {
  const row = unwrap(
    await supabase
      .from('user_settings')
      .upsert(
        {
          user_id: await currentUserId(),
          proposal_guidance: settings.proposalGuidance,
          concept_guidance: settings.conceptGuidance,
          boilerplate: settings.boilerplate,
        },
        { onConflict: 'user_id' },
      )
      .select()
      .single(),
  )
  return {
    proposalGuidance: row.proposal_guidance ?? '',
    conceptGuidance: row.concept_guidance ?? '',
    boilerplate: row.boilerplate ?? '',
  }
}

/** Marks a proposal as a worked example for future drafts. */
export async function setProposalExemplar(
  id: string,
  isExemplar: boolean,
): Promise<Proposal> {
  const row = unwrap(
    await supabase
      .from('proposals')
      .update({ is_exemplar: isExemplar })
      .eq('id', id)
      .select()
      .single(),
  )
  return toProposal(row)
}

/**
 * Who a proposal written against this tender must belong to.
 *
 * The tender's owner, not the writer: oversight may draft on a member's bid,
 * and a row owned by the admin is one the member's own select policy hides from
 * them — help they cannot read. Enforced server-side by proposals_insert; see
 * migration 0029. Falls back to the caller when the tender cannot be read,
 * which is the pre-0029 behaviour and still correct for one's own rows.
 */
async function proposalOwner(rfpId: string): Promise<string> {
  const { data } = await supabase
    .from('rfps')
    .select('user_id')
    .eq('id', rfpId)
    .maybeSingle()
  return data?.user_id ?? (await currentUserId())
}

/** Records a past proposal pasted in as text, so it can be used as an example. */
export async function savePastedProposal(
  rfpId: string,
  title: string,
  content: string,
): Promise<Proposal> {
  const row = unwrap(
    await supabase
      .from('proposals')
      .insert({
        user_id: await proposalOwner(rfpId),
        rfp_id: rfpId,
        kind: 'submitted',
        title,
        content,
        file_path: '',
        file_name: '',
        file_size: null,
        notes: '',
      })
      .select()
      .single(),
  )
  return toProposal(row)
}

/** Saves generated text against an RFP so a draft survives closing the tab. */
export async function saveDraftProposal(
  rfpId: string,
  title: string,
  content: string,
): Promise<Proposal> {
  const row = unwrap(
    await supabase
      .from('proposals')
      .insert({
        user_id: await proposalOwner(rfpId),
        rfp_id: rfpId,
        kind: 'draft',
        title,
        content,
        file_path: '',
        file_name: '',
        file_size: null,
        notes: '',
      })
      .select()
      .single(),
  )
  return toProposal(row)
}

/**
 * Uploads the file that actually went to the buyer.
 *
 * The object path starts with the *tender owner's* uid, not the uploader's.
 * Storage policies compare that first segment to `auth.uid()`, which is what
 * keeps a submitted document private to its owner — and it is also why the
 * folder has to name the member rather than the admin attaching it for them. A
 * file filed under the admin is one the member cannot open. Migration 0029
 * grants admins write access to a member's folder for exactly this.
 */
export async function uploadSubmittedProposal(
  rfpId: string,
  file: File,
  notes: string,
): Promise<Proposal> {
  const userId = await proposalOwner(rfpId)
  const extension = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
  const path = `${userId}/${rfpId}/${crypto.randomUUID()}.${extension}`

  const upload = await supabase.storage
    .from(PROPOSAL_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false })

  if (upload.error) throw new Error(`Upload failed: ${upload.error.message}`)

  try {
    const row = unwrap(
      await supabase
        .from('proposals')
        .insert({
          user_id: userId,
          rfp_id: rfpId,
          kind: 'submitted',
          title: file.name,
          content: '',
          file_path: path,
          file_name: file.name,
          file_size: file.size,
          notes,
        })
        .select()
        .single(),
    )
    return toProposal(row)
  } catch (cause) {
    // Don't strand an orphaned object in the bucket if the row insert fails.
    await supabase.storage.from(PROPOSAL_BUCKET).remove([path])
    throw cause
  }
}

/** Short-lived signed URL — the bucket is private, so there is no public path. */
export async function proposalFileUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PROPOSAL_BUCKET)
    .createSignedUrl(filePath, 60)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

export async function deleteProposal(proposal: Proposal): Promise<void> {
  const { error } = await supabase.from('proposals').delete().eq('id', proposal.id)
  if (error) throw new Error(error.message)
  if (proposal.filePath) {
    await supabase.storage.from(PROPOSAL_BUCKET).remove([proposal.filePath])
  }
}

// ---------------------------------------------------------- activities -----

// `userId` is omitted alongside `id`: both are set by the server from the
// session, and a client that could nominate an owner could log an entry in
// someone else's name.
/**
 * The call report attached to a visit. Written by its own call rather than
 * through `ActivityDraft`: logging an activity is a four-field composer used
 * dozens of times a week, and a report is a long form filled in once. Folding
 * them together would make every logged call carry eight empty strings.
 */
export type CallReportFields = Pick<
  Activity,
  | 'visitingOfficers'
  | 'officialsMet'
  | 'reportDate'
  | 'meetingPurpose'
  | 'businessBackground'
  | 'keyNeeds'
  | 'wayForward'
  | 'otherComments'
>

export type ActivityDraft = Omit<Activity, 'id' | 'userId' | keyof CallReportFields>

export async function saveCallReport(
  id: string,
  fields: CallReportFields,
): Promise<Activity> {
  const { data, error } = await supabase
    .from('activities')
    .update({
      visiting_officers: fields.visitingOfficers,
      officials_met: fields.officialsMet,
      report_date: dateOrNull(fields.reportDate),
      meeting_purpose: fields.meetingPurpose,
      business_background: fields.businessBackground,
      key_needs: fields.keyNeeds,
      way_forward: fields.wayForward,
      other_comments: fields.otherComments,
    })
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) {
    // Row-level security scopes the update to your own rows, so this is an
    // admin reading someone else's log rather than a missing record.
    throw new Error('This visit was logged by another member, so only they can write its report.')
  }
  return toActivity(data)
}

export async function createActivity(draft: ActivityDraft): Promise<Activity> {
  const row = unwrap(
    await supabase
      .from('activities')
      .insert({
        user_id: await currentUserId(),
        lead_id: draft.leadId,
        rfp_id: draft.rfpId,
        type: draft.type,
        occurred_on: draft.occurredOn || today(),
        summary: draft.summary,
        outcome: draft.outcome,
      })
      .select()
      .single(),
  )
  return toActivity(row)
}

export async function deleteActivity(id: string): Promise<void> {
  const { error } = await supabase.from('activities').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// --------------------------------------------------------------- leads -----

export async function createLead(draft: LeadDraft): Promise<Lead> {
  const stamp = today()
  const row = unwrap(
    await supabase
      .from('leads')
      .insert({
        ...leadFields(draft),
        user_id: await currentUserId(),
        created_on: stamp,
        status_updated_on: stamp,
      })
      .select()
      .single(),
  )
  return toLead(row)
}

export async function updateLead(
  id: string,
  draft: LeadDraft,
  { statusChanged }: { statusChanged: boolean },
): Promise<Lead> {
  const row = unwrap(
    await supabase
      .from('leads')
      .update({
        ...leadFields(draft),
        // Weekly "leads qualified" counts key off this, so it only moves when
        // the status actually moves — not on every incidental edit.
        ...(statusChanged ? { status_updated_on: today() } : {}),
      })
      .eq('id', id)
      .select()
      .single(),
  )
  return toLead(row)
}

/**
 * Moves a lead's status without touching anything else — the inline dropdown
 * in the table. Stamps `status_updated_on`, which is what the weekly
 * "leads qualified" figure counts.
 */
export async function updateLeadStatus(
  id: string,
  status: LeadStatus,
): Promise<Lead> {
  const row = unwrap(
    await supabase
      .from('leads')
      .update({ status, status_updated_on: today() })
      .eq('id', id)
      .select()
      .single(),
  )
  return toLead(row)
}

export async function deleteLead(id: string): Promise<void> {
  const { error } = await supabase.from('leads').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------- rfps -----

export async function createRfp(draft: RfpDraft): Promise<Rfp> {
  const stamp = today()
  const row = unwrap(
    await supabase
      .from('rfps')
      .insert({
        ...rfpFields(draft),
        user_id: await currentUserId(),
        sourced: false,
        created_on: stamp,
        status_updated_on: stamp,
      })
      .select()
      .single(),
  )
  return toRfp(row)
}

export async function updateRfp(
  id: string,
  draft: RfpDraft,
  { statusChanged }: { statusChanged: boolean },
): Promise<Rfp> {
  const row = unwrap(
    await supabase
      .from('rfps')
      .update({
        ...rfpFields(draft),
        ...(statusChanged ? { status_updated_on: today() } : {}),
      })
      .eq('id', id)
      .select()
      .single(),
  )
  return toRfp(row)
}

/** Moves an RFP's status without touching anything else. */
export async function updateRfpStatus(
  id: string,
  status: RfpStatus,
): Promise<Rfp> {
  const row = unwrap(
    await supabase
      .from('rfps')
      .update({ status, status_updated_on: today() })
      .eq('id', id)
      .select()
      .single(),
  )
  return toRfp(row)
}

/** Takes an RFP into, or out of, the live proposal pipeline. */
/**
 * Raised when a tender was taken by someone else between the list rendering
 * and the button being pressed. Carries the winner so the message can name
 * them rather than just refusing.
 */
export class RfpAlreadyClaimed extends Error {
  // Assigned in the body rather than declared as a constructor parameter
  // property: the project compiles with `erasableSyntaxOnly`, which rejects
  // any TypeScript that has to emit code rather than just be stripped.
  claimedBy: string | null

  constructor(claimedBy: string | null) {
    super('Another member has already taken this tender.')
    this.name = 'RfpAlreadyClaimed'
    this.claimedBy = claimedBy
  }
}

export async function fetchRfpClaims(): Promise<RfpClaim[]> {
  const { data, error } = await supabase
    .from('rfp_claims')
    .select('external_id, claimed_by, claimed_at, title')
  if (error) throw new Error(`Could not load who has taken what: ${error.message}`)
  return (data ?? []).map((row) => ({
    externalId: row.external_id,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    title: row.title,
  }))
}

/**
 * Takes a tender on, or hands it back.
 *
 * The claim is written before the local flag, and deliberately not in a
 * transaction with it — there is no cross-table transaction available from the
 * client, so the order is chosen to fail safe. Claim first: if someone else has
 * it, the primary key refuses and nothing local has changed. Doing it the other
 * way round would show the tender in your pipeline for the moment before the
 * refusal arrived.
 *
 * Hand-added RFPs have no external id and so no claim — nobody else can see
 * them to take.
 */
/**
 * Hands a tender and everything attached to it to another member.
 *
 * One RPC rather than four writes from here, because the tender, its proposals,
 * its activities and the firm-wide claim have to agree afterwards — see
 * migration 0028. Admin and super user only, enforced in the function.
 */
export async function reassignRfp(id: string, newOwner: string): Promise<void> {
  const { error } = await supabase.rpc('reassign_rfp', {
    target: id,
    new_owner: newOwner,
  })
  if (error) throw new Error(`Could not reassign this tender: ${error.message}`)
}

export async function setRfpPipeline(
  id: string,
  inPipeline: boolean,
  externalId: string | null,
): Promise<Rfp> {
  const userId = await currentUserId()

  if (externalId && inPipeline) {
    const { error } = await supabase
      .from('rfp_claims')
      .insert({ external_id: externalId, claimed_by: userId, title: '' })

    // 23505 is a unique-violation: the tender already has a claim. Anything
    // else is a real failure and should not read as "someone beat you to it".
    if (error) {
      if (error.code !== '23505') {
        throw new Error(`Could not take this tender on: ${error.message}`)
      }
      const { data } = await supabase
        .from('rfp_claims')
        .select('claimed_by')
        .eq('external_id', externalId)
        .maybeSingle()
      throw new RfpAlreadyClaimed(data?.claimed_by ?? null)
    }
  }

  if (externalId && !inPipeline) {
    // Matched on the tender alone, and left to row-level security to decide
    // whose claim may go: a member's delete matches only their own, an admin's
    // matches anyone's. Filtering on `claimed_by` here as well used to look
    // like belt and braces, but it quietly broke oversight — an admin taking a
    // colleague's abandoned bid out of the pipeline cleared the flag and left
    // the claim behind, so the tender was in nobody's pipeline and still
    // unclaimable by anyone.
    const { error } = await supabase
      .from('rfp_claims')
      .delete()
      .eq('external_id', externalId)
    if (error) throw new Error(`Could not hand this tender back: ${error.message}`)
  }

  // `maybeSingle`, not `single`. Row-level security scopes an update to your
  // own rows, so acting on another member's copy matches nothing and updates
  // nothing — and `single` turns that into "Cannot coerce the result to a
  // single JSON object", which tells the reader nothing about what went wrong
  // or what to do. An admin reading the whole firm's pipeline hits this the
  // moment they try to tidy somebody else's row.
  const { data, error } = await supabase
    .from('rfps')
    .update({ in_pipeline: inPipeline })
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) {
    throw new Error(
      inPipeline
        ? 'This tender belongs to another member, so it cannot be added to your pipeline.'
        : 'This proposal belongs to another member. Only they can take it out of the pipeline.',
    )
  }
  return toRfp(data)
}

/**
 * Attaches (or clears) the tender document text on an RFP.
 *
 * Its own call rather than a field on the edit dialog's draft: the text runs to
 * tens of thousands of characters, and pushing that through every unrelated
 * save — a status change, a note — would be wasteful and would risk one stale
 * copy of the form wiping a document someone else had just attached.
 */
export async function setTenderDocument(
  id: string,
  text: string,
  fileName: string,
): Promise<Rfp> {
  const row = unwrap(
    await supabase
      .from('rfps')
      .update({ tender_text: text, tender_file_name: fileName })
      .eq('id', id)
      .select()
      .single(),
  )
  return toRfp(row)
}

export async function deleteRfp(id: string): Promise<void> {
  const { error } = await supabase.from('rfps').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Bulk insert from the JSON importer. Every imported RFP starts as Watching. */
export async function importRfps(drafts: RfpDraft[]): Promise<Rfp[]> {
  if (drafts.length === 0) return []
  const stamp = today()
  const userId = await currentUserId()
  const rows = unwrap(
    await supabase
      .from('rfps')
      .insert(
        drafts.map((draft) => ({
          ...rfpFields(draft),
          user_id: userId,
          sourced: true,
          external_id: null,
          created_on: stamp,
          status_updated_on: stamp,
        })),
      )
      .select(),
  )
  return rows.map(toRfp)
}

/**
 * Re-reads every RFP for the current user.
 *
 * The opportunity sync writes its rows server-side in the Edge Function, so
 * after it runs the client has no idea what arrived — this is how the tracker
 * catches up. Deliberately a full re-read rather than a diff: the sync inserts
 * across several sources at once and a handful of rows is not worth the
 * bookkeeping of working out which.
 */
export async function listRfps(): Promise<Rfp[]> {
  const rows = unwrap(
    await supabase
      .from('rfps')
      .select('*')
      // Matches the order fetchAll returns, so a synced list and a freshly
      // loaded one present identically.
      .order('created_at', { ascending: false }),
  )
  return rows.map(toRfp)
}

// --------------------------------------------------------------- tasks -----

export async function createTask(draft: TaskDraft): Promise<Task> {
  const row = unwrap(
    await supabase
      .from('tasks')
      .insert({
        text: draft.text,
        due: dateOrNull(draft.due),
        priority: draft.priority,
        linked_lead: draft.linkedLead,
        user_id: await currentUserId(),
        done: false,
        completed_on: null,
        created_on: today(),
      })
      .select()
      .single(),
  )
  return toTask(row)
}

export async function setTaskDone(id: string, done: boolean): Promise<Task> {
  const row = unwrap(
    await supabase
      .from('tasks')
      .update({ done, completed_on: done ? today() : null })
      .eq('id', id)
      .select()
      .single(),
  )
  return toTask(row)
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ------------------------------------------------------ weekly reports -----

export async function saveWeeklyReport(
  draft: WeeklyReportDraft,
): Promise<WeeklyReport> {
  const row = unwrap(
    await supabase
      .from('weekly_reports')
      .upsert(
        {
          user_id: await currentUserId(),
          week_start: draft.weekStart,
          period: draft.period,
          revenue: draft.revenue,
          notes: draft.notes,
          submitted: draft.submitted,
        },
        { onConflict: 'user_id,period,week_start' },
      )
      .select()
      .single(),
  )
  return toWeeklyReport(row)
}

// --------------------------------------------------------- consultants -----

function toConsultant(row: ConsultantRow): Consultant {
  return {
    id: row.id,
    name: row.name ?? '',
    title: row.title ?? '',
    coreExpertise: row.core_expertise ?? '',
    yearsExperience: row.years_experience,
    sectors: row.sectors ?? '',
    countries: row.countries ?? '',
    qualifications: row.qualifications ?? '',
    taskFit: row.task_fit ?? '',
    projectExperience: row.project_experience ?? '',
    languages: row.languages ?? '',
    availability: row.availability ?? '',
    shortBio: row.short_bio ?? '',
    longBio: row.long_bio ?? '',
    photoPath: row.photo_path ?? '',
    cvPath: row.cv_path ?? '',
    cvFileName: row.cv_file_name ?? '',
    cvSize: row.cv_size,
  }
}

function consultantFields(draft: ConsultantDraft) {
  return {
    name: draft.name.trim(),
    title: draft.title.trim(),
    core_expertise: draft.coreExpertise.trim(),
    years_experience: draft.yearsExperience,
    sectors: draft.sectors.trim(),
    countries: draft.countries.trim(),
    qualifications: draft.qualifications.trim(),
    task_fit: draft.taskFit.trim(),
    project_experience: draft.projectExperience.trim(),
    languages: draft.languages.trim(),
    availability: draft.availability.trim(),
    short_bio: draft.shortBio.trim(),
    long_bio: draft.longBio.trim(),
  }
}

const CONSULTANT_BUCKET = 'consultants'

/** Photo formats a browser will actually render inline. */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024
export const MAX_CV_BYTES = 15 * 1024 * 1024

/**
 * Attaches a photo or a CV to a consultant.
 *
 * The path leads with the owner's uid because the storage policies compare
 * that first segment to `auth.uid()` — the shape is what keeps the file
 * private, not a convention.
 *
 * `upsert` is on so replacing a photo overwrites in place rather than leaving
 * the old object orphaned in the bucket. The consultant id in the path is what
 * makes that safe: two consultants never share a file.
 */
async function uploadConsultantFile(
  consultantId: string,
  kind: 'photo' | 'cv',
  file: File,
): Promise<string> {
  const userId = await currentUserId()
  const extension = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
  const path = `${userId}/${consultantId}/${kind}.${extension?.toLowerCase()}`

  const { error } = await supabase.storage
    .from(CONSULTANT_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: true })

  if (error) throw new Error(`Could not upload the ${kind}: ${error.message}`)
  return path
}

export async function setConsultantPhoto(id: string, file: File): Promise<Consultant> {
  if (!PHOTO_TYPES.includes(file.type)) {
    throw new Error('Use a JPG, PNG, WebP or GIF.')
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error('That photo is over 4 MB. Use a smaller one.')
  }
  const path = await uploadConsultantFile(id, 'photo', file)
  const row = unwrap(
    await supabase.from('consultants').update({ photo_path: path }).eq('id', id).select().single(),
  )
  return toConsultant(row)
}

export async function setConsultantCv(id: string, file: File): Promise<Consultant> {
  if (file.size > MAX_CV_BYTES) {
    throw new Error('That CV is over 15 MB. Use a smaller file.')
  }
  const path = await uploadConsultantFile(id, 'cv', file)
  const row = unwrap(
    await supabase
      .from('consultants')
      .update({ cv_path: path, cv_file_name: file.name, cv_size: file.size })
      .eq('id', id)
      .select()
      .single(),
  )
  return toConsultant(row)
}

/**
 * Removes an attached file.
 *
 * The row is cleared first. If the storage delete then fails the file is
 * orphaned, which costs a few kilobytes; doing it the other way round would
 * leave the row pointing at an object that no longer exists, which shows the
 * reader a broken image instead.
 */
export async function clearConsultantFile(
  consultant: Consultant,
  kind: 'photo' | 'cv',
): Promise<Consultant> {
  const path = kind === 'photo' ? consultant.photoPath : consultant.cvPath
  const patch =
    kind === 'photo'
      ? { photo_path: '' }
      : { cv_path: '', cv_file_name: '', cv_size: null }

  const row = unwrap(
    await supabase.from('consultants').update(patch).eq('id', consultant.id).select().single(),
  )
  if (path) await supabase.storage.from(CONSULTANT_BUCKET).remove([path])
  return toConsultant(row)
}

/**
 * A time-limited URL for a stored file.
 *
 * The bucket is private, so there is no permanent address to render — every
 * view has to ask for one, and it stops working shortly afterwards. That is
 * the point: a CV is a named person's document and should not sit behind a
 * URL that works forever for anyone who has ever seen it.
 */
export async function consultantFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(CONSULTANT_BUCKET)
    .createSignedUrl(path, 60 * 10)
  if (error || !data?.signedUrl) {
    throw new Error(`Could not open the file: ${error?.message ?? 'no URL returned'}`)
  }
  return data.signedUrl
}

export async function createConsultant(draft: ConsultantDraft): Promise<Consultant> {
  const row = unwrap(
    await supabase
      .from('consultants')
      .insert({ ...consultantFields(draft), user_id: await currentUserId() })
      .select()
      .single(),
  )
  return toConsultant(row)
}

export async function updateConsultant(
  id: string,
  draft: ConsultantDraft,
): Promise<Consultant> {
  const row = unwrap(
    await supabase
      .from('consultants')
      .update(consultantFields(draft))
      .eq('id', id)
      .select()
      .single(),
  )
  return toConsultant(row)
}

export async function deleteConsultant(id: string): Promise<void> {
  const { error } = await supabase.from('consultants').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Stores the drafter's reading of a tender, and the notice it was read from.
 *
 * Kept rather than recomputed so it can be inspected and corrected before a
 * proposal is written against it — an understanding nobody can check is a guess
 * with better manners. `notice_text` is written alongside because the analysis
 * is only as good as its source, and a reader who doubts the reading needs to
 * see what was read.
 */
export async function saveTenderAnalysis(
  id: string,
  analysis: string,
  noticeText: string,
): Promise<Rfp> {
  const { data, error } = await supabase
    .from('rfps')
    .update({
      analysis,
      // Never blanked by a later run that could not reach the page: a stored
      // notice is worth more than an empty one from a portal having a bad day.
      ...(noticeText ? { notice_text: noticeText } : {}),
      analysed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) throw new Error(`Could not save the analysis: ${error.message}`)
  if (!data) {
    throw new Error('This tender belongs to another member, so its analysis cannot be saved.')
  }
  return toRfp(data)
}
