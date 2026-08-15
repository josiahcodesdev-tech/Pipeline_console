import type { PostgrestSingleResponse } from '@supabase/supabase-js'
import { supabase } from './client'
import type {
  Consultant,
  Lead,
  Rfp,
  Task,
  WeeklyReport,
} from '@/domain/types'

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
export function unwrap<T>(result: PostgrestSingleResponse<T>): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('Supabase returned no data')
  return result.data
}

export async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw new Error(error.message)
  if (!data.user) throw new Error('Not signed in')
  return data.user.id
}

/** Date columns are nullable in Postgres; the domain uses '' for "unset". */
export function dateOrNull(iso: string): string | null {
  return iso ? iso : null
}
