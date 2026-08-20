import { useEffect } from 'react'
import { toast } from 'sonner'
import { daysUntil, today } from '@/domain/dates'
import { usePipeline } from '@/shared/hooks/use-pipeline'

/** In-console reminders shown once per tender/day at the requested 3/2/1-day marks. */
export function DeadlineAlerts({ onOpen }: { onOpen: (id: string) => void }) {
  const { rfps, loading } = usePipeline()

  useEffect(() => {
    if (loading) return
    for (const rfp of rfps) {
      const days = daysUntil(rfp.deadline)
      if (!rfp.inPipeline || ![1, 2, 3].includes(days ?? -1)) continue
      const key = `pipeline-console:deadline-alert:${rfp.id}:${today()}`
      try {
        if (localStorage.getItem(key)) continue
        localStorage.setItem(key, 'shown')
      } catch {
        // Storage is only de-duplication; a privacy setting must not hide alerts.
      }
      toast.warning(`Proposal due in ${days} day${days === 1 ? '' : 's'}`, {
        description: `${rfp.title} — ${rfp.org}`,
        duration: 15_000,
        action: { label: 'Open', onClick: () => onOpen(rfp.id) },
      })
    }
  }, [loading, onOpen, rfps])

  return null
}
