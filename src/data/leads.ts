import { supabase } from './client'
import { today } from '@/domain/dates'
import type { Lead, LeadStatus } from '@/domain/types'
import { unwrap, currentUserId, dateOrNull, type LeadDraft } from './internal'
import { toLead, leadFields } from './mappers'

export type { LeadDraft }

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
