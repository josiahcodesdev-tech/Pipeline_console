import { pipelineCounts } from '@/lib/metrics'
import { cn } from '@/lib/utils'
import type { Lead } from '@/lib/types'

/**
 * The console's signature element: pipeline head-count as one continuous run,
 * with a chevron notch between stages so it reads as flow rather than as five
 * separate tiles.
 *
 * Stages deepen in colour left to right, which encodes progression — the same
 * information the arrow gives, in a second channel. Empty stages recede so the
 * eye lands on where the work actually is.
 */
const STAGE_TINT = [
  'bg-card',
  'bg-gold-soft/35',
  'bg-gold-soft/60',
  'bg-brand-soft/60',
  'bg-brand-soft',
]

export function PipelineBar({ leads }: { leads: Lead[] }) {
  const stages = pipelineCounts(leads)
  const total = stages.reduce((sum, stage) => sum + stage.count, 0)

  return (
    <div className="gold-edge mb-6 rounded-xl border border-border bg-card shadow-brand-sm">
      <div className="flex items-center justify-between border-b border-border-soft px-4 py-2.5">
        <span className="eyebrow text-muted-foreground">Pipeline</span>
        <span className="text-[11px] text-faint">
          {total} {total === 1 ? 'lead' : 'leads'} tracked
        </span>
      </div>

      <div className="flex overflow-hidden rounded-b-xl">
        {stages.map(({ stage, count }, index) => (
          <div
            key={stage}
            className={cn(
              'relative flex-1 border-r border-border px-4 pb-4 pt-3.5 last:border-r-0',
              STAGE_TINT[index],
            )}
          >
            <div
              className={cn(
                'eyebrow',
                count > 0 ? 'text-clay' : 'text-faint',
              )}
            >
              {stage}
            </div>
            <div
              className={cn(
                'mt-1.5 font-display text-[30px] leading-none',
                count > 0 ? 'text-primary' : 'text-faint/60',
              )}
            >
              {count}
            </div>

            {index < stages.length - 1 && (
              <span
                aria-hidden
                className="absolute -right-[5px] top-1/2 z-10 size-[9px] -translate-y-1/2 rotate-45 border-r border-t border-border bg-inherit"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
