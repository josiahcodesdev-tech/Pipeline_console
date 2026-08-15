import type { ReactNode } from 'react'
import {
  ArrowUpRightIcon,
  CircleCheckIcon,
  TriangleAlertIcon,
  OctagonAlertIcon,
} from 'lucide-react'
import { cn } from '@/shared/utils'
import { SubjectIcon, type SubjectName } from '@/features/dashboard/subject-icon'

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
  mark,
  subject,
  onClick,
  linkLabel,
  className,
}: {
  label: string
  value: ReactNode
  /** Optional line under the figure — what it counts, or over what period. */
  hint?: string
  tone?: KpiTone
  /**
   * A sparkline or meter shown at the foot of the card. Full-bleed, so it
   * arrives already sized rather than being wrapped in padding here.
   */
  mark?: ReactNode
  /** Which subject mark to show beside the label. */
  subject?: SubjectName
  /** Makes the whole card the way through to where this figure is worked on. */
  onClick?: () => void
  /** Where the click goes, e.g. "Leads" — used in the accessible name. */
  linkLabel?: string
  className?: string
}) {
  const body = (
    <>
      <span
        aria-hidden
        className={cn('absolute inset-x-0 top-0 h-[3px]', TONE_RULE[tone])}
      />

      <div className="px-4 pt-4.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {/* What the figure is about. The tone icon beside the value says
                how it is doing — two different questions, so two marks. */}
            {subject && <SubjectIcon name={subject} />}
            <div className="eyebrow truncate text-muted-foreground">{label}</div>
          </div>
          {onClick && (
            // Always visible rather than revealed on hover: a control the
            // reader cannot see until they touch it is one they never find,
            // which is how the RFP table's own link went unnoticed for weeks.
            <ArrowUpRightIcon
              aria-hidden
              className="mt-px size-3.5 shrink-0 text-faint transition-colors group-hover:text-primary"
            />
          )}
        </div>

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

      {/* The strip is reserved whether or not a mark is present, so cards in a
          row keep one baseline instead of stepping up and down. */}
      <div className="mt-3 flex h-[26px] items-end px-4 pb-4 [&>*]:w-full">
        {mark}
      </div>
    </>
  )

  const shell =
    'lift group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-brand-sm'

  if (!onClick) {
    return <div className={cn(shell, className)}>{body}</div>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={linkLabel ? `${label} — open ${linkLabel}` : label}
      className={cn(
        shell,
        'cursor-pointer transition-colors hover:border-brand-dim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
    >
      {body}
    </button>
  )
}
