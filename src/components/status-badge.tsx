import { cn } from '@/lib/utils'
import type { LeadStatus, RfpStatus } from '@/lib/types'

/**
 * Status colour is semantic, not decorative: warm amber for "in motion",
 * gold for "qualified/committed", green for won, clay-red for lost. Neutral
 * grey means nothing has happened yet.
 */
const LEAD_STATUS_CLASS: Record<LeadStatus, string> = {
  New: 'bg-surface-2 text-muted-foreground',
  Contacted: 'bg-warning-soft text-warning',
  Qualified: 'bg-brand-soft text-primary',
  'Handed Over': 'bg-info-soft text-info',
  Won: 'bg-success-soft text-success',
  Lost: 'bg-danger-soft text-danger',
}

const RFP_STATUS_CLASS: Record<RfpStatus, string> = {
  Watching: 'bg-surface-2 text-muted-foreground',
  Preparing: 'bg-warning-soft text-warning',
  Submitted: 'bg-brand-soft text-primary',
  Won: 'bg-success-soft text-success',
  Lost: 'bg-danger-soft text-danger',
}

const BASE =
  'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium leading-tight'

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
