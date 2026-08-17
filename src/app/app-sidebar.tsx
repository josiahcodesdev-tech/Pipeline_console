import { LogOutIcon, PanelLeftCloseIcon } from 'lucide-react'
import { cn } from '@/shared/utils'
import { useAuth } from '@/shared/hooks/use-auth'
import type { ViewId } from '@/app/nav'
import { ROLE_LABEL } from '@/domain/types'
import { navItemsFor } from '@/app/nav'
import { toDisplayName } from '@/domain/usernames'

const NAV_ICON: Record<ViewId, string> = {
  dashboard: 'dashboard',
  leads: 'leads',
  rfps: 'rfps',
  pipeline: 'pipeline',
  activity: 'activity',
  tasks: 'tasks',
  progress: 'progress',
  report: 'report',
  consultants: 'consultants',
  members: 'members',
  settings: 'settings',
}

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
  const { session, signOut, can, role, profile } = useAuth()
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
          VA
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
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                // A filled pill for the current page rather than a tinted
                // block with a rule beside it: the pill is the shape the rest
                // of the console now uses, and it reads at a glance without
                // needing a second mark to carry it.
                'group flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition-all duration-150',
                active
                  ? 'bg-gradient-to-r from-primary to-clay font-semibold text-white shadow-brand-sm'
                  : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
              )}
            >
              <img
                src={`/icons/mono/${NAV_ICON[item.id]}.png`}
                alt=""
                aria-hidden
                className="size-4 shrink-0 object-contain"
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

        {/* The signed-in member as a card, the way the reference pins one to
            the foot of the rail. It carries what the console actually needs to
            tell them apart — who they are and what they may do — rather than a
            photograph it has no source for. */}
        <div className="flex items-center gap-2 rounded-2xl border border-border-soft bg-surface-2/60 px-2.5 py-2.5">
          {session?.user.email && (
            <>
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-clay text-[12px] font-semibold text-white"
              >
                {/* Initials from the display name, falling back to the email —
                    an avatar with a letter in it beats an empty grey circle. */}
                {(profile?.fullName || session.user.email).trim().charAt(0).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className="min-w-0 truncate text-[11px] font-medium text-foreground"
                  title={session.user.email}
                >
                  {profile?.fullName || toDisplayName(session.user.email)}
                </span>
                {/* Stated rather than left to be discovered by finding a button
                    missing. A member who knows they are a user does not file a
                    bug when Delete is not there. */}
                <span className="text-[10px] uppercase tracking-wide text-faint">
                  {ROLE_LABEL[role]}
                </span>
              </span>
            </>
          )}
          <button
            type="button"
            onClick={() => void signOut()}
            title="Sign out"
            aria-label="Sign out"
            className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-faint transition-colors hover:bg-card hover:text-danger"
          >
            <LogOutIcon className="size-3.5" />
          </button>
        </div>
      </div>
    </aside>
  )
}
