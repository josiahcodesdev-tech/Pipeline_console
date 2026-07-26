import { cn } from '@/lib/utils'
import type { LeadStatus, RfpStatus } from '@/lib/types'

/**
 * Status colour is semantic, not decorative: gold-brown for "in motion",
 * primary brown for "qualified/committed", green for won, red for lost.
 * Warm neutral means nothing has happened yet.
 *
 * Every text/background pair here clears 4.5:1, the WCAG floor for text this
 * small — the site defines no status palette, so these were derived to sit in
 * its brown/gold world and then measured rather than eyeballed.
 */
const LEAD_STATUS_CLASS: Record<LeadStatus, string> = {
  New: 'bg-surface-2 text-neutral',
  Contacted: 'bg-warning-soft text-warning',
  Qualified: 'bg-brand-soft text-primary',
  'Handed Over': 'bg-info-soft text-info',
  Won: 'bg-success-soft text-success',
  Lost: 'bg-danger-soft text-danger',
}

const RFP_STATUS_CLASS: Record<RfpStatus, string> = {
  Watching: 'bg-surface-2 text-neutral',
  Preparing: 'bg-warning-soft text-warning',
  Submitted: 'bg-brand-soft text-primary',
  Won: 'bg-success-soft text-success',
  Lost: 'bg-danger-soft text-danger',
}

const BASE =
  'inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-tight'

export function LeadStatusBadge({
  status,
  className,
}: {
  status: LeadStatus
  className?: string
}) {
  return (
    <span className={cn(BASE, LEAD_STATUS_CLASS[status], className)}>{status}</span>
  )
}

export function RfpStatusBadge({
  status,
  className,
}: {
  status: RfpStatus
  className?: string
}) {
  return (
    <span className={cn(BASE, RFP_STATUS_CLASS[status], className)}>{status}</span>
  )
}
