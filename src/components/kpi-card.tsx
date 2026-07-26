import type { ReactNode } from 'react'
import { CircleCheckIcon, TriangleAlertIcon, OctagonAlertIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type KpiTone = 'neutral' | 'good' | 'warn' | 'bad'

const TONE_VALUE: Record<KpiTone, string> = {
  neutral: 'text-foreground',
  good: 'text-success',
  warn: 'text-warning',
  bad: 'text-danger',
}

/** A hairline of tone along the card's top edge — legible at a glance across a row. */
const TONE_RULE: Record<KpiTone, string> = {
  neutral: 'bg-border',
  good: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-danger',
}

/**
 * Tone is reinforcement, never the sole carrier — the number and its label
 * already say what is going on, and non-neutral tones add an icon so the state
 * survives colour-blindness and greyscale printing.
 */
const TONE_ICON: Record<KpiTone, ReactNode> = {
  neutral: null,
  good: <CircleCheckIcon className="size-4" aria-hidden />,
  warn: <TriangleAlertIcon className="size-4" aria-hidden />,
  bad: <OctagonAlertIcon className="size-4" aria-hidden />,
}

const TONE_LABEL: Record<KpiTone, string> = {
  neutral: '',
  good: 'on track',
  warn: 'needs attention',
  bad: 'off track',
}

export function KpiCard({
  label,
  value,
  hint,
  tone = 'neutral',
  className,
}: {
  label: string
  value: ReactNode
  /** Optional line under the figure — what it counts, or over what period. */
  hint?: string
  tone?: KpiTone
  className?: string
}) {
  return (
    <div
      className={cn(
        'lift relative overflow-hidden rounded-xl border border-border bg-card px-4 pb-4 pt-4.5 shadow-brand-sm',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn('absolute inset-x-0 top-0 h-[3px]', TONE_RULE[tone])}
      />

      <div className="eyebrow text-muted-foreground">{label}</div>

      <div className="mt-2 flex items-baseline gap-2">
        {/* Proportional figures: tabular-nums makes display sizes look loose. */}
        <span
          className={cn(
            'font-display text-[30px] leading-none',
            TONE_VALUE[tone],
          )}
        >
          {value}
        </span>
        {tone !== 'neutral' && (
          <span className={cn('shrink-0', TONE_VALUE[tone])}>
            {TONE_ICON[tone]}
            <span className="sr-only">{TONE_LABEL[tone]}</span>
          </span>
        )}
      </div>

      {hint && <p className="mt-1.5 text-[11px] text-faint">{hint}</p>}
    </div>
  )
}
