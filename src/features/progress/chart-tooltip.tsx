import type { TooltipContentProps } from 'recharts/types/component/Tooltip'
import { MARK } from '@/shared/charts'

/**
 * Shared tooltip body. Per the house style the value leads (high contrast) and
 * the label follows, keyed by a short stroke of the mark colour rather than a
 * filled swatch — at tooltip density a box is data-weight ink doing a label's
 * job.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  valueSuffix = '',
}: // Recharts injects these at render time, so they are optional at the call site.
Partial<TooltipContentProps<number, string>> & { valueSuffix?: string }) {
  if (!active || !payload?.length) return null
  const point = payload[0]

  return (
    <div className="rounded-lg border border-border bg-popover px-2.5 py-2 shadow-md">
      <div className="font-display text-sm font-semibold text-foreground">
        {point.value}
        {valueSuffix}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span
          aria-hidden
          className="inline-block h-0.5 w-3 rounded-full"
          style={{ background: MARK }}
        />
        {/* Category names are user data — React escapes them by construction. */}
        {label}
      </div>
    </div>
  )
}
