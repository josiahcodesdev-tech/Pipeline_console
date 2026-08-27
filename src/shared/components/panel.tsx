import type { ReactNode } from 'react'
import { cn } from '@/shared/utils'

/**
 * The console's one container: a card with an optional heading.
 *
 * A white card on a cool grey ground, which is what separates it -- the border
 * is a hairline and the shadow is barely there. The warm palette needed a soft
 * shadow because a cream card on a cream page has nothing else to sit on; grey
 * does that work on its own, and keeping the old shadow made every card look
 * like it was peeling off the page.
 *
 * `bare` drops the padding, for a card whose content supplies its own bands --
 * a `PanelHeader` over a table.
 */
export function Panel({
  title,
  description,
  action,
  className,
  bodyClassName,
  bare = false,
  children,
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  bodyClassName?: string
  /** Drop the padding, for a card that supplies its own bands. */
  bare?: boolean
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        'mb-5 overflow-hidden rounded-lg border border-border bg-card shadow-brand-sm',
        bare ? '' : 'px-5 py-4.5',
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
              <h3 className="font-display text-[14.5px] font-semibold leading-tight text-foreground">
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
        // fault. The blue tint says "this is fine and this is the place".
        <span className="mb-1 grid size-12 place-items-center rounded-lg bg-brand-soft text-primary">
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
  icon,
  title,
  description,
  meta,
  action,
}: {
  eyebrow?: string
  /** A mark beside the title, as the reference modules head every page. */
  icon?: ReactNode
  title: string
  description?: string
  meta?: ReactNode
  action?: ReactNode
}) {
  return (
    // Not sticky any more, and no rule under it.
    //
    // The reference heads a page and lets it scroll away, which is right for a
    // page that opens with a stat row: pinning a translucent bar over a grid of
    // white cards produced a smear as they passed beneath it.
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 pt-7">
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span aria-hidden className="mt-1 shrink-0 text-clay [&>svg]:size-7">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && <div className="eyebrow mb-1.5 text-clay">{eyebrow}</div>}
          <h2 className="font-display text-[26px] font-semibold leading-tight text-clay">
            {title}
          </h2>
          {description && (
            <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {meta}
        {action}
      </div>
    </div>
  )
}


/**
 * The dark band that heads a list card, with its record count.
 *
 * Distinct from `Panel`'s own heading, which sits on white and names a section.
 * This one heads a *table* and says how many rows are under it -- the reference
 * uses it wherever a card is mostly a list, and the count is the part people
 * actually read.
 */
export function PanelHeader({
  icon,
  title,
  count,
  action,
}: {
  icon?: ReactNode
  title: ReactNode
  count?: number
  action?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5 bg-neutral px-4 py-3 text-white">
      {icon && (
        <span aria-hidden className="shrink-0 [&>svg]:size-4">
          {icon}
        </span>
      )}
      <h3 className="min-w-0 flex-1 truncate font-display text-[14px] font-semibold">
        {title}
      </h3>
      {count !== undefined && (
        <span className="shrink-0 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium">
          {count} record{count === 1 ? '' : 's'}
        </span>
      )}
      {action}
    </div>
  )
}

/**
 * One statistic: a large figure over its label, on a white card.
 *
 * `tone` colours the figure and nothing else. Colouring the card would make a
 * row of six read as six alerts; colouring the number keeps the row scannable
 * and leaves the cards a quiet grid.
 *
 * Clickable when given `onClick`, because every figure here stands for a set of
 * records somebody will want to see -- a stat nobody can open is a poster.
 */
export function StatCard({
  value,
  label,
  tone = 'default',
  onClick,
  title,
}: {
  value: ReactNode
  label: ReactNode
  tone?: 'default' | 'primary' | 'warning' | 'info' | 'success' | 'danger'
  onClick?: () => void
  title?: string
}) {
  const colour = {
    default: 'text-foreground',
    primary: 'text-primary',
    warning: 'text-gold',
    info: 'text-info',
    success: 'text-success',
    danger: 'text-danger',
  }[tone]

  const body = (
    <>
      <div className={cn('font-display text-[30px] font-semibold leading-none', colour)}>
        {value}
      </div>
      <div className="mt-2 text-[12px] leading-snug text-muted-foreground">{label}</div>
    </>
  )

  if (!onClick) {
    return (
      <div
        title={title}
        className="rounded-lg border border-border bg-card px-4 py-5 text-center shadow-brand-sm"
      >
        {body}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="cursor-pointer rounded-lg border border-border bg-card px-4 py-5 text-center shadow-brand-sm transition-colors hover:border-primary/40 hover:bg-brand-soft/40"
    >
      {body}
    </button>
  )
}
