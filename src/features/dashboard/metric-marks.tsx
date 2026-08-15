import { cn } from '@/shared/utils'

/**
 * Small marks that sit inside a KPI card.
 *
 * They exist so a row of figures stops being a row of identical boxes: a count
 * with history gets a sparkline, a ratio against a ceiling gets a meter, and a
 * bare count gets neither. Form follows what the number actually is, which is
 * also what makes the row readable at a glance rather than uniform.
 */

/**
 * Twelve periods of a count, drawn edge to edge along the foot of a card.
 *
 * Full-bleed rather than boxed: this is texture that says "and here is the
 * shape of it", not a chart to be read off. There are no axes and no labels
 * for that reason — the figure above is the value, and this is its recent
 * shape. The final period is marked because "where it stands now" is the only
 * point on the line the reader needs to locate.
 */
export function Sparkline({
  values,
  className,
  label,
}: {
  values: number[]
  className?: string
  /** Described for screen readers; the drawing itself is decorative. */
  label: string
}) {
  if (values.length < 2) return null

  const width = 100
  const height = 26
  const max = Math.max(...values, 1)
  // A flat run sits on the floor rather than halfway up, so "nothing happened"
  // looks like nothing rather than like a steady middling figure.
  const x = (index: number) => (index / (values.length - 1)) * width
  const y = (value: number) => height - (value / max) * (height - 4) - 2

  const points = values.map((value, index) => `${x(index)},${y(value)}`)
  const line = points.join(' ')
  const area = `0,${height} ${line} ${width},${height}`

  // The end marker lives in HTML, not SVG. The viewBox is stretched to the
  // card's width — roughly eight times — and under `preserveAspectRatio="none"`
  // a circle comes out as a flat ellipse. `vectorEffect` rescues the stroke
  // width but not the geometry, so the dot is positioned as a percentage
  // instead and stays round at any card width.
  const lastTop = (y(values[values.length - 1]) / height) * 100

  return (
    <div className={cn('relative h-[26px] w-full', className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block size-full"
        role="img"
        aria-label={label}
      >
        <polygon points={area} className="fill-brand-soft/40" />
        <polyline
          points={line}
          fill="none"
          className="stroke-brand-dim"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          // Without this the non-uniform scaling stretches the stroke into a
          // wedge — thick horizontally, hairline vertically.
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        aria-hidden
        className="absolute size-[5px] -translate-x-full -translate-y-1/2 rounded-full bg-primary ring-2 ring-card"
        style={{ left: '100%', top: `${lastTop}%` }}
      />
    </div>
  )
}

/** Severity of a meter's fill. Track is always a lighter step of the same ramp. */
export type MeterTone = 'good' | 'warn' | 'bad'

const METER_FILL: Record<MeterTone, string> = {
  good: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-danger',
}

const METER_TRACK: Record<MeterTone, string> = {
  good: 'bg-success-soft',
  warn: 'bg-warning-soft',
  bad: 'bg-danger-soft',
}

/**
 * A ratio against a ceiling — the honest form for a percentage.
 *
 * The track takes a lighter step of the fill's own ramp rather than a neutral
 * grey, so the state reads across the whole bar instead of only the filled
 * part: a bar that is 20% red still looks wrong at a glance.
 */
export function Meter({
  value,
  tone,
  label,
  className,
}: {
  /** 0-100. */
  value: number
  tone: MeterTone
  label: string
  className?: string
}) {
  const pct = Math.max(0, Math.min(100, value))

  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full', METER_TRACK[tone], className)}
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', METER_FILL[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
