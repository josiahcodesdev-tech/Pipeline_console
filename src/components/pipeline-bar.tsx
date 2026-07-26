import { pipelineCounts } from '@/lib/metrics'
import type { Lead } from '@/lib/types'

/**
 * The console's signature element: pipeline head-count as one continuous run,
 * with a chevron notch between stages to read as flow rather than as five
 * separate tiles.
 */
export function PipelineBar({ leads }: { leads: Lead[] }) {
  const stages = pipelineCounts(leads)

  return (
    <div className="mb-5 flex overflow-hidden rounded-lg border border-border bg-card">
      {stages.map(({ stage, count }, index) => (
        <div
          key={stage}
          className="relative flex-1 border-r border-border px-4 py-3.5 last:border-r-0"
        >
          <div className="text-[10px] uppercase tracking-wider text-faint">
            {stage}
          </div>
          <div className="mt-1 font-display text-[26px] font-semibold leading-none">
            {count}
          </div>
          {index < stages.length - 1 && (
            <span
              aria-hidden
              className="absolute -right-1 top-1/2 z-10 size-[7px] -translate-y-1/2 rotate-45 border-r border-t border-border bg-card"
            />
          )}
        </div>
      ))}
    </div>
  )
}
