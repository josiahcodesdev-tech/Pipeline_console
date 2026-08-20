import { BellIcon, CalendarClockIcon } from 'lucide-react'
import { daysUntil, formatDateWithYear } from '@/domain/dates'
import type { Rfp } from '@/domain/types'

export function NotificationMenu({
  rfps,
  onOpen,
}: {
  rfps: Rfp[]
  onOpen: (id: string) => void
}) {
  const notifications = rfps
    .map((rfp) => ({ rfp, days: daysUntil(rfp.deadline) }))
    .filter(({ rfp, days }) => rfp.inPipeline && [1, 2, 3].includes(days ?? -1))
    .sort((a, b) => (a.days ?? 99) - (b.days ?? 99))

  return (
    <details className="group relative">
      <summary
        className="relative grid size-9 cursor-pointer list-none place-items-center rounded-lg border border-border bg-card text-muted-foreground shadow-brand-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
        aria-label={`Notifications${notifications.length ? `, ${notifications.length} unread` : ''}`}
      >
        <BellIcon className="size-4" aria-hidden />
        {notifications.length > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-semibold leading-4 text-white">
            {notifications.length > 9 ? '9+' : notifications.length}
          </span>
        )}
      </summary>

      <div className="absolute right-0 top-11 z-40 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover shadow-brand-md">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-display text-sm text-foreground">Notifications</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Proposal deadlines requiring attention</p>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {notifications.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              You have no deadline notifications.
            </div>
          ) : notifications.map(({ rfp, days }) => (
            <button
              key={rfp.id}
              type="button"
              onClick={(event) => {
                onOpen(rfp.id)
                event.currentTarget.closest('details')?.removeAttribute('open')
              }}
              className="flex w-full cursor-pointer gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-accent"
            >
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-warning-soft text-warning">
                <CalendarClockIcon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-danger">
                  Due in {days} day{days === 1 ? '' : 's'}
                </span>
                <span className="mt-0.5 block truncate text-xs font-medium text-foreground">{rfp.title}</span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {rfp.org} · {formatDateWithYear(rfp.deadline)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </details>
  )
}
