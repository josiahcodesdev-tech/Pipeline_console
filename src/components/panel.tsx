import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The console's one container: a card with an optional heading.
 *
 * The border is a hairline of the softest border token rather than the solid
 * one. On a cream page a full-strength border draws a box around everything and
 * the eye reads the boxes before the content; a hairline plus the shadow is
 * enough to separate a card from the page, and lets the content win.
 */
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
        'mb-5 rounded-2xl border border-border-soft bg-card px-5 py-4.5 shadow-brand-sm',
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
        // A tinted disc rather than a grey one: an empty state is a normal
        // condition — nothing is due, nothing has closed — and grey reads as a
        // fault. The brand tint says "this is fine and this is the place".
        <span className="mb-1 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-soft to-gold-soft text-clay">
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
    // Sticks to the top of the viewport while the page scrolls, so the current
    // view and its primary action stay reachable.
    //
    // The negative margins cancel `main`'s horizontal padding so the bar and
    // its rule span the full column — they must stay in step with the padding
    // set in App.tsx. Translucent with a blur rather than opaque, so content
    // passing underneath reads as *behind* it rather than abruptly clipped;
    // the page's background wash is `fixed`, so it lines up either way.
    <div className="sticky top-0 z-20 -mx-6 mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-border bg-background/85 px-6 pb-4 pt-8 backdrop-blur-md lg:-mx-8 lg:px-8">
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
