import { supabase } from './client'
import { today } from '@/domain/dates'
import type { Activity } from '@/domain/types'
import { unwrap, currentUserId, dateOrNull } from './internal'
import { toActivity } from './mappers'

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
