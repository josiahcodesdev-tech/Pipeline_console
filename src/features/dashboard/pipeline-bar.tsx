import { pipelineCounts } from '@/domain/metrics'
import { cn } from '@/shared/utils'
import { QUALIFIED_STATUSES, type Lead } from '@/domain/types'

/**
 * Where every lead currently sits, as a funnel.
 *
 * The previous version showed five counts on tinted panels, which answered
 * "how many are at each stage" and nothing else. Two things were missing and
 * both matter more than the raw counts:
 *
 * Proportion. Five equal panels say a stage holding one lead and a stage
 * holding forty are the same size. The share bar under each count is what
 * shows where the pipeline is actually banked up.
 *
 * Conversion. The single figure a business development person is judged on is
 * how much of the top of the funnel reaches Qualified, and it was nowhere on
 * the page. It is now the headline.
 *
 * An empty stage also has to look deliberate. Five grey zeros read as a broken
 * component rather than an honest "nothing has got that far yet", so an empty
 * stage keeps a visible track and a muted zero instead of disappearing.
 */

/**
 * Each stage deepens toward Won, so progression reads left to right.
 *
 * The run deepens through the action blue rather than the old gold-to-brown
 * ramp. The rule that shaped it still holds: the lightest step has to be
 * distinct from the track it sits on (#eef1f7), or a bar at 100% looks like an
 * empty one.
 */
const STAGE_FILL = [
  'bg-primary/25',
  'bg-primary/45',
  'bg-primary/65',
  'bg-primary/85',
  'bg-primary',
] as const

export function PipelineBar({
  leads,
  onSelectStage,
}: {
  leads: Lead[]
  /** Opens the leads register filtered to one stage. */
  onSelectStage?: (stage: Lead['status']) => void
}) {
  const stages = pipelineCounts(leads)
  const total = stages.reduce((sum, stage) => sum + stage.count, 0)

  const qualified = leads.filter((lead) =>
    (QUALIFIED_STATUSES as readonly string[]).includes(lead.status),
  ).length
  // Guarded rather than shown as 0% on an empty pipeline: nothing has failed to
  // convert when nothing has been added, and 0% would read as a bad result.
  const conversion = total > 0 ? Math.round((qualified / total) * 100) : null

  return (
    <div className="gold-edge mb-6 rounded-2xl border border-border-soft bg-card shadow-brand-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-soft px-4 py-2.5">
        <span className="eyebrow text-muted-foreground">Pipeline</span>
        <span className="flex items-center gap-3 text-[11px]">
          <span className="text-faint">
            {total} {total === 1 ? 'lead' : 'leads'} tracked
          </span>
          {conversion !== null && (
            <span
              className="font-medium text-clay"
              title={`${qualified} of ${total} leads have reached Qualified or beyond`}
            >
              {conversion}% qualified
            </span>
          )}
        </span>
      </div>

      {/* Scrolls rather than crushing on a narrow screen: five stages with
          readable labels have a floor below which they stop being legible. */}
      <div className="flex overflow-x-auto">
        {stages.map(({ stage, count }, index) => {
          const share = total > 0 ? Math.round((count / total) * 100) : 0
          const empty = count === 0

          return (
            <button
              key={stage}
              type="button"
              disabled={!onSelectStage}
              onClick={() => onSelectStage?.(stage)}
              aria-label={`${count} ${stage}${total > 0 ? `, ${share}% of the pipeline` : ''} — open in Leads`}
              className={cn(
                'group relative min-w-[116px] flex-1 border-r border-border-soft px-4 pb-3.5 pt-3 text-left last:border-r-0',
                onSelectStage &&
                  'cursor-pointer transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              )}
            >
              <div
                className={cn(
                  'eyebrow',
                  empty ? 'text-faint' : 'text-clay',
                )}
              >
                {stage}
              </div>

              <div className="mt-1 flex items-baseline gap-1.5">
                <span
                  className={cn(
                    'font-display text-[26px] leading-none',
                    empty ? 'text-faint/70' : 'text-primary',
                  )}
                >
                  {count}
                </span>
                {!empty && total > 0 && (
                  <span className="text-[10.5px] text-faint">{share}%</span>
                )}
              </div>

              {/* The share of the whole pipeline. The track stays visible when
                  the stage is empty so the row keeps its shape and an empty
                  stage reads as empty rather than as a rendering failure. */}
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={cn('h-full rounded-full transition-[width] duration-500', STAGE_FILL[index])}
                  style={{ width: `${share}%` }}
                />
              </div>

              {/* The notch that makes five panels read as one flow. Sits above
                  the divider it straddles, and is hidden on the last stage
                  because there is nothing after Won. */}
              {index < stages.length - 1 && (
                <span
                  aria-hidden
                  className="absolute -right-[5px] top-1/2 z-10 size-[9px] -translate-y-1/2 rotate-45 border-r border-t border-border-soft bg-card"
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
