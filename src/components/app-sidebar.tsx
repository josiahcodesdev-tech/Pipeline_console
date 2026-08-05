import { LogOutIcon, PanelLeftCloseIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import type { ViewId } from '@/lib/nav'
import { ROLE_LABEL } from '@/lib/types'
import { navItemsFor } from '@/lib/nav'

export function AppSidebar({
  current,
  onNavigate,
  onCollapse,
}: {
  current: ViewId
  onNavigate: (id: ViewId) => void
  /** Hides the sidebar, leaving a hamburger in the corner to bring it back. */
  onCollapse: () => void
}) {
  const { session, signOut, can, role } = useAuth()
  const items = navItemsFor(can.manageMembers)

  return (
    // Sticky rather than fixed: it stays put while the page scrolls without
    // taking the sidebar out of the flex flow, so `main` still sizes itself.
    // `h-screen` pins it to the viewport, and it scrolls internally if the nav
    // ever outgrows a short window.
    <aside className="sticky top-0 flex h-screen w-[228px] shrink-0 flex-col gap-7 overflow-y-auto border-r border-border bg-card px-4 py-6">
      <div className="flex items-start gap-3 px-1">
        {/* A mark, so the sidebar has something to anchor on besides text. */}
        <span
          aria-hidden
          className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-clay to-primary font-display text-[13px] text-white shadow-brand-sm"
        >
          JM
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[17px] leading-tight text-foreground">
            Pipeline Console
          </h1>
          <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {/* Josiah Mwangi
            <br />
            Corporate Dept · BDE */}
          </div>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Hide navigation"
          title="Hide navigation"
          className="-mr-1 mt-0.5 shrink-0 cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PanelLeftCloseIcon className="size-4" />
        </button>
      </div>

      <nav className="flex flex-col gap-0.5">
        <div className="eyebrow mb-1.5 px-2.5 text-faint">Workspace</div>
        {items.map((item) => {
          const active = item.id === current
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group relative flex cursor-pointer items-center gap-2.5 rounded-lg py-2 pl-3 pr-2.5 text-left text-[13px] transition-all duration-150',
                active
                  ? 'bg-brand-soft font-semibold text-primary'
                  : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
              )}
            >
              {/* A left rule marks the current page — steadier than a dot, and
                  it reads at a glance from the edge of the screen. */}
              <span
                aria-hidden
                className={cn(
                  'absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-all duration-200',
                  active ? 'h-5 opacity-100' : 'h-0 opacity-0',
                )}
              />
              <Icon
                className={cn(
                  'size-4 shrink-0 transition-colors',
                  active ? 'text-primary' : 'text-faint group-hover:text-clay',
                )}
              />
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-4">
        {/* The institution's values — the one piece of pure brand voice in the
            console, so it gets the gold treatment rather than grey small print. */}
        <div className="rounded-xl border border-border bg-gold-soft/60 px-3 py-2.5">
          <p className="font-display text-[11px] leading-relaxed text-clay">
            Tenacity · Innovation
            <br />
            Excellence · Speed
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          {session?.user.email && (
            <span className="flex min-w-0 flex-col gap-0.5">
              <span
                className="min-w-0 truncate text-[10.5px] text-faint"
                title={session.user.email}
              >
                {session.user.email}
              </span>
              {/* Stated rather than left to be discovered by finding a button
                  missing. A member who knows they are a user does not file a
                  bug when Delete is not there. */}
              <span className="text-[10px] uppercase tracking-wide text-faint/80">
                {ROLE_LABEL[role]}
              </span>
            </span>
          )}
          <button
            type="button"
            onClick={() => void signOut()}
            title="Sign out"
            aria-label="Sign out"
            className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-faint transition-colors hover:bg-surface-2 hover:text-danger"
          >
            <LogOutIcon className="size-3.5" />
          </button>
        </div>
      </div>
    </aside>
  )
}
