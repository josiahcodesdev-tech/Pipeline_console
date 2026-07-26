import type { ReactNode } from 'react'
import { CircleCheckIcon, TriangleAlertIcon, OctagonAlertIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type KpiTone = 'neutral' | 'good' | 'warn' | 'bad'

const TONE_TEXT: Record<KpiTone, string> = {
  neutral: 'text-foreground',
  good: 'text-success',
  warn: 'text-warning',
  bad: 'text-danger',
}

/**
 * Tone is reinforcement, never the sole carrier — the number and its label
 * already say what is going on, and non-neutral tones add an icon so the state
 * survives colour-blindness and greyscale printing.
 */
const TONE_ICON: Record<KpiTone, ReactNode> = {
  neutral: null,
  good: <CircleCheckIcon className="size-3.5" aria-hidden />,
  warn: <TriangleAlertIcon className="size-3.5" aria-hidden />,
  bad: <OctagonAlertIcon className="size-3.5" aria-hidden />,
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
  tone = 'neutral',
  className,
}: {
  label: string
  value: ReactNode
  tone?: KpiTone
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card px-4 py-3.5 shadow-brand-sm',
        className,
      )}
    >
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-1.5 flex items-center gap-1.5 font-display text-[26px]',
          TONE_TEXT[tone],
        )}
      >
        {/* Proportional figures: tabular-nums makes display sizes look loose. */}
        <span>{value}</span>
        {TONE_ICON[tone]}
        {tone !== 'neutral' && <span className="sr-only">{TONE_LABEL[tone]}</span>}
      </div>
    </div>
  )
}
