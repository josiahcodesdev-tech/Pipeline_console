import { supabase } from './client'
import type { WeeklyReport } from '@/domain/types'
import { unwrap, currentUserId, type WeeklyReportDraft } from './internal'
import { toWeeklyReport } from './mappers'

export type { WeeklyReportDraft }

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
