import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/shared/ui/select'
import { cn } from '@/shared/utils'
import {
  LEAD_STATUSES,
  RFP_STATUSES,
  type LeadStatus,
  type RfpStatus,
} from '@/domain/types'

/**
 * Status colour is semantic, not decorative: gold-brown for "in motion",
 * primary brown for "qualified/committed", green for won, red for lost.
 * Warm neutral means nothing has happened yet.
 *
 * Every text/background pair clears 4.5:1, the WCAG floor for text this small.
 * The Vantage site defines no status palette, so these were derived to sit in
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

/**
 * Status pill that is also a dropdown — changing it saves immediately, so a
 * routine move to "Preparing" doesn't require opening the edit dialog.
 *
 * It lives inside a clickable table row, so pointer events are stopped from
 * bubbling: opening the menu must not also open the row's dialog. The menu
 * itself renders in a portal, so its own clicks never reach the row.
 */
function StatusSelect<T extends string>({
  value,
  options,
  classes,
  onChange,
  label,
}: {
  value: T
  options: readonly T[]
  classes: Record<T, string>
  onChange: (next: T) => Promise<void> | void
  label: string
}) {
  const [busy, setBusy] = useState(false)

  async function handleChange(next: T) {
    if (next === value) return
    setBusy(true)
    try {
      await onChange(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span
      onClick={(event) => event.stopPropagation()}
      // Base UI opens the menu on pointerdown, which would reach the row first.
      onPointerDown={(event) => event.stopPropagation()}
      className="inline-flex"
    >
      <Select<string>
        value={value}
        onValueChange={(next) => void handleChange(next as T)}
      >
        <SelectTrigger
          aria-label={label}
          disabled={busy}
          className={cn(
            'h-auto gap-1 rounded-full border-transparent px-2.5 py-0.5 text-[11px] font-semibold shadow-none transition-opacity',
            'hover:opacity-80 focus-visible:ring-2 data-[size=default]:h-auto',
            classes[value],
            busy && 'opacity-50',
          )}
        >
          <span>{value}</span>
          <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} className="min-w-[150px]">
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  classes[option],
                )}
              >
                {option}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  )
}

export function LeadStatusSelect({
  value,
  onChange,
}: {
  value: LeadStatus
  onChange: (next: LeadStatus) => Promise<void> | void
}) {
  return (
    <StatusSelect
      value={value}
      options={LEAD_STATUSES}
      classes={LEAD_STATUS_CLASS}
      onChange={onChange}
      label="Change lead status"
    />
  )
}

export function RfpStatusSelect({
  value,
  onChange,
}: {
  value: RfpStatus
  onChange: (next: RfpStatus) => Promise<void> | void
}) {
  return (
    <StatusSelect
      value={value}
      options={RFP_STATUSES}
      classes={RFP_STATUS_CLASS}
      onChange={onChange}
      label="Change RFP status"
    />
  )
}
