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
  'digital-solutions': 'rfps',
  pipeline: 'pipeline',
  activity: 'activity',
  tasks: 'tasks',
  progress: 'progress',
  report: 'report',
  records: 'records',
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
  const items = navItemsFor(can.manageMembers, can.seeEveryone)

  return (
    // Sticky rather than fixed: it stays put while the page scrolls without
    // taking the sidebar out of the flex flow, so `main` still sizes itself.
    // `h-screen` pins it to the viewport, and it scrolls internally if the nav
    // ever outgrows a short window.
    <aside className="sticky top-0 flex h-screen w-[252px] shrink-0 flex-col overflow-y-auto bg-sidebar text-sidebar-foreground">
      {/* The masthead sits in its own band, ruled off from the nav, so the
          sidebar and the top bar read as one piece of chrome wrapping the
          page rather than two dark panels that happen to touch. */}
      <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-4">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-md bg-primary font-display text-[13px] font-semibold text-white"
        >
          VA
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[15px] font-semibold leading-tight text-white">
            Vantage Africa
          </h1>
          <p className="text-[10.5px] leading-tight text-sidebar-foreground/70">
            School of Leadership
          </p>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Hide navigation"
          title="Hide navigation"
          className="-mr-1 shrink-0 cursor-pointer rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-white"
        >
          <PanelLeftCloseIcon className="size-4" />
        </button>
      </div>

      <nav className="flex flex-col py-2">
        {items.map((item) => {
          const active = item.id === current
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                // A full-bleed row with a left accent bar, not a pill. On a
                // dark rail a pill floats; the bar anchors the row to the edge
                // and is what the reference modules use.
                'group flex cursor-pointer items-center gap-3 border-l-[3px] px-5 py-2.5 text-left text-[13px] transition-colors duration-150',
                active
                  ? 'border-primary bg-sidebar-accent font-semibold text-white'
                  : 'border-transparent text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-white',
              )}
            >
              <img
                src={`/icons/mono/${NAV_ICON[item.id]}.png`}
                alt=""
                aria-hidden
                // Inverted: the icon set is dark monochrome, drawn for a light
                // rail. On slate it would be a smudge.
                className="size-4 shrink-0 object-contain brightness-0 invert"
              />
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="mt-auto px-3 pb-4">
        {/* The signed-in member, pinned to the foot of the rail. The values
            card that used to sit above this is gone: it was brand voice for a
            warm cream palette, and on slate it read as an orphaned yellow box. */}
        <div className="flex items-center gap-2 rounded-md bg-sidebar-accent/70 px-2.5 py-2.5">
          {session?.user.email && (
            <>
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[12px] font-semibold text-white"
              >
                {/* Initials from the display name, falling back to the email —
                    an avatar with a letter in it beats an empty grey circle. */}
                {(profile?.fullName || session.user.email).trim().charAt(0).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className="min-w-0 truncate text-[11px] font-medium text-white"
                  title={session.user.email}
                >
                  {profile?.fullName || toDisplayName(session.user.email)}
                </span>
                {/* Stated rather than left to be discovered by finding a button
                    missing. A member who knows they are a user does not file a
                    bug when Delete is not there. */}
                <span className="text-[10px] uppercase tracking-wide text-sidebar-foreground/70">
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
            className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-white"
          >
            <LogOutIcon className="size-3.5" />
          </button>
        </div>
      </div>
    </aside>
  )
}
