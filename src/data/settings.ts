import { supabase } from './client'
import { EMPTY_SETTINGS, type UserSettings } from '@/domain/types'
import { unwrap, currentUserId } from './internal'

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
