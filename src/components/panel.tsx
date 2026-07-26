import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** The console's one container: a bordered card with an optional heading. */
export function Panel({
  title,
  action,
  className,
  bodyClassName,
  children,
}: {
  title?: ReactNode
  action?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        'mb-5 rounded-lg border border-border bg-card px-5 py-4',
        className,
      )}
    >
      {(title || action) && (
        <header className="mb-3.5 flex items-center justify-between gap-3">
          {title ? (
            <h3 className="font-display text-sm font-semibold">{title}</h3>
          ) : (
            <span />
          )}
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="py-5 text-center text-xs text-faint">{children}</div>
}

export function ViewHeader({
  title,
  meta,
  action,
}: {
  title: string
  meta?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <h2 className="font-display text-[22px] font-semibold tracking-tight">
        {title}
      </h2>
      {meta}
      {action}
    </div>
  )
}
