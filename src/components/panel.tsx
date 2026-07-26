import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** The console's one container: a bordered card with an optional heading. */
export function Panel({
  title,
  description,
  action,
  className,
  bodyClassName,
  children,
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        'mb-5 rounded-xl border border-border bg-card px-5 py-4 shadow-brand-sm',
        className,
      )}
    >
      {(title || action) && (
        <header
          className={cn(
            'flex items-start justify-between gap-3',
            description ? 'mb-4' : 'mb-3.5',
          )}
        >
          <div className="min-w-0">
            {title && (
              <h3 className="font-display text-[15px] leading-tight text-foreground">
                {title}
              </h3>
            )}
            {description && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

/**
 * Empty states carry an icon and a second line of guidance. A bare sentence in
 * grey reads like a failure; saying what to do next reads like an interface.
 */
export function EmptyState({
  icon,
  children,
  hint,
}: {
  icon?: ReactNode
  children: ReactNode
  hint?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      {icon && (
        <span className="mb-1 grid size-10 place-items-center rounded-full bg-surface-2 text-faint">
          {icon}
        </span>
      )}
      <p className="text-[13px] font-medium text-foreground">{children}</p>
      {hint && <p className="max-w-[42ch] text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/**
 * Page header. The eyebrow gives each view a line of context — without it the
 * console is six near-identical pages distinguished only by a heading.
 */
export function ViewHeader({
  eyebrow,
  title,
  description,
  meta,
  action,
}: {
  eyebrow?: string
  title: string
  description?: string
  meta?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-border pb-4">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5 text-clay">{eyebrow}</div>}
        <h2 className="font-display text-[26px] leading-none text-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-2 max-w-[60ch] text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {meta}
        {action}
      </div>
    </div>
  )
}
