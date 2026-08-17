import type { ReactNode } from 'react'
import { cn } from '@/shared/utils'
import { SubjectIcon, type SubjectName } from '@/features/dashboard/subject-icon'

/**
 * The pieces the dashboard is built from.
 *
 * Kept apart from the view so the view reads as a layout — what sits where —
 * rather than three hundred lines of markup with the arrangement buried in it.
 */

/* -------------------------------------------------------------- hero strip */

/**
 * The three figures the day starts with, on filled cards.
 *
 * Filled rather than outlined because they are the first thing read and should
 * win the page; the cards below are white and recede behind them.
 *
 * One fill for all three, not a colour run across the strip. The run was tried
 * and measured: white text needs 4.5:1, and the brand gold gives 2.24:1, so the
 * third card was unreadable. Only clay and darker clear the bar, which leaves
 * too little range to be worth stepping through — and three matching cards read
 * as one object anyway, which is what the strip is.
 *
 * Gold still appears, as the icon well, where nothing has to be read through it.
 */
const HERO_FILL = 'from-[#6b3410] to-clay'

export function HeroStat({
  label,
  value,
  hint,
  subject,
  onClick,
  featured = false,
}: {
  label: string
  value: ReactNode
  hint?: string
  subject: SubjectName
  onClick?: () => void
  featured?: boolean
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={cn('text-[10.5px] font-semibold tracking-wide', featured ? 'text-white/75' : 'text-muted-foreground')}>
            {label}
          </div>
          <div className={cn('mt-1.5 font-display text-[30px] leading-none', featured ? 'text-white' : 'text-foreground')}>
            {value}
          </div>
          {hint && <p className={cn('mt-1.5 text-[11px]', featured ? 'text-white/70' : 'text-faint')}>{hint}</p>}
        </div>
        {/* Sunk into a translucent well so the mark sits on the gradient
            rather than floating on it. */}
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', featured ? 'bg-white/15 ring-1 ring-white/20' : 'bg-brand-soft')}>
          <SubjectIcon name={subject} className="size-5" />
        </span>
      </div>
    </>
  )

  const shell = cn(
    'rounded-xl border px-4 py-3.5 text-left shadow-brand-sm',
    featured
      ? `border-transparent bg-gradient-to-br ${HERO_FILL}`
      : 'border-border-soft bg-card',
  )

  if (!onClick) return <div className={shell}>{body}</div>

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        shell,
        'lift cursor-pointer transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
      )}
    >
      {body}
    </button>
  )
}

/* ---------------------------------------------------------------- ring */

/**
 * A percentage as a ring.
 *
 * Same job as the meter — a share of a whole — in the shape the layout wants
 * here. The track is a lighter step of the fill's own ramp so the state reads
 * across the whole circle rather than only the filled arc.
 */
export function Ring({
  value,
  label,
  tone = 'brand',
}: {
  value: number
  label: string
  tone?: 'brand' | 'good' | 'warn' | 'bad'
}) {
  const pct = Math.max(0, Math.min(100, value))
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const stroke: Record<string, [string, string]> = {
    brand: ['stroke-brand-soft', 'stroke-primary'],
    good: ['stroke-success-soft', 'stroke-success'],
    warn: ['stroke-warning-soft', 'stroke-warning'],
    bad: ['stroke-danger-soft', 'stroke-danger'],
  }
  const [track, fill] = stroke[tone]

  return (
    <div className="relative grid size-[86px] shrink-0 place-items-center">
      <svg viewBox="0 0 80 80" className="size-full -rotate-90">
        <circle cx="40" cy="40" r={radius} fill="none" strokeWidth={8} className={track} />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          strokeWidth={8}
          strokeLinecap="round"
          className={cn(fill, 'transition-[stroke-dashoffset] duration-700')}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct / 100)}
        />
      </svg>
      <span
        className="absolute font-display text-[17px] leading-none text-foreground"
        aria-label={label}
      >
        {pct}%
      </span>
    </div>
  )
}

/* ---------------------------------------------------------------- bars */

/**
 * A short run of counts as bars.
 *
 * Bars rather than a line because each column is a discrete day that either
 * happened or did not — a line between them implies a continuous quantity that
 * was never measured. The last column is the accent so "today" is findable.
 */
export function Bars({
  values,
  label,
  className,
}: {
  values: number[]
  label: string
  className?: string
}) {
  const max = Math.max(...values, 1)

  return (
    <div
      className={cn('flex h-[72px] items-end gap-[3px]', className)}
      role="img"
      aria-label={label}
    >
      {values.map((value, index) => (
        <div
          key={index}
          // A floor of 3px so an empty day is still a visible tick rather than
          // a gap that reads as missing data.
          style={{ height: `${Math.max(3, (value / max) * 100)}%` }}
          className={cn(
            'flex-1 rounded-t-[3px] transition-[height] duration-500',
            index === values.length - 1 ? 'bg-primary' : 'bg-brand-soft',
          )}
          title={`${value}`}
        />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------- rail bits */

/** A section heading in the right rail, with an optional link. */
export function RailHeading({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <h3 className="font-display text-[13.5px] text-foreground">{children}</h3>
      {action}
    </div>
  )
}
