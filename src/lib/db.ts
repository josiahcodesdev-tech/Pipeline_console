import type { PostgrestSingleResponse } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { today } from './dates'
import {
  isLeadStatus,
  isRfpStatus,
  isSegment,
  type Lead,
  type LeadStatus,
  type Rfp,
  type RfpStatus,
  type Task,
  type TaskPriority,
  type WeeklyReport,
} from './types'
import type {
  LeadRow,
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
export type RfpDraft = Omit<
  Rfp,
  'id' | 'createdOn' | 'statusUpdatedOn' | 'sourced' | 'externalId'
>
/** An RFP arriving from the CareerCraft feed, keyed for idempotent re-sync. */
export type SyncedRfpDraft = RfpDraft & { externalId: string }
export type TaskDraft = Omit<Task, 'id' | 'done' | 'completedOn' | 'createdOn'>
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
    createdOn: row.created_on,
    statusUpdatedOn: row.status_updated_on ?? '',
  }
}

function toRfp(row: RfpRow): Rfp {
  return {
    id: row.id,
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
    externalId: row.external_id,
    createdOn: row.created_on,
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
  }
}

// -------------------------------------------------------------- loading ----

export interface PipelineSnapshot {
  leads: Lead[]
  rfps: Rfp[]
  tasks: Task[]
  reports: WeeklyReport[]
}

export async function fetchAll(): Promise<PipelineSnapshot> {
  const [leads, rfps, tasks, reports] = await Promise.all([
    supabase.from('leads').select('*').order('created_at', { ascending: false }),
    supabase
      .from('rfps')
      .select('*')
      .order('deadline', { ascending: true, nullsFirst: false }),
    supabase.from('tasks').select('*').order('due', { ascending: true, nullsFirst: false }),
    supabase.from('weekly_reports').select('*').order('week_start', { ascending: false }),
  ])

  return {
    leads: unwrap(leads).map(toLead),
    rfps: unwrap(rfps).map(toRfp),
    tasks: unwrap(tasks).map(toTask),
    reports: unwrap(reports).map(toWeeklyReport),
  }
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
 * Inserts RFPs synced from the CareerCraft feed, skipping any whose
 * `external_id` this user already holds.
 *
 * `ignoreDuplicates` makes the call idempotent at the database level via the
 * `rfps_user_external_id_key` index, so a second sync — or two devices syncing
 * at once — cannot create duplicates even though the caller also filters
 * client-side. Rows already present are left untouched rather than overwritten,
 * so local edits (status moved to Preparing, notes added) survive re-syncing.
 */
export async function syncRfps(drafts: SyncedRfpDraft[]): Promise<Rfp[]> {
  if (drafts.length === 0) return []
  const stamp = today()
  const userId = await currentUserId()
  const rows = unwrap(
    await supabase
      .from('rfps')
      .upsert(
        drafts.map((draft) => ({
          ...rfpFields(draft),
          user_id: userId,
          sourced: true,
          external_id: draft.externalId,
          created_on: stamp,
          status_updated_on: stamp,
        })),
        { onConflict: 'user_id,external_id', ignoreDuplicates: true },
      )
      .select(),
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
          revenue: draft.revenue,
          notes: draft.notes,
          submitted: draft.submitted,
        },
        { onConflict: 'user_id,week_start' },
      )
      .select()
      .single(),
  )
  return toWeeklyReport(row)
}
