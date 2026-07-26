import { LogOutIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import type { ViewId } from '@/lib/nav'
import { NAV_ITEMS } from '@/lib/nav'

export function AppSidebar({
  current,
  onNavigate,
}: {
  current: ViewId
  onNavigate: (id: ViewId) => void
}) {
  const { session, signOut } = useAuth()

  return (
    <aside className="flex w-[220px] shrink-0 flex-col gap-7 border-r border-border bg-card px-4 py-6">
      <div className="px-1">
        <div className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-faint">
          Corporate Dept · BDE
        </div>
        <h1 className="font-display text-[19px] font-semibold leading-tight tracking-tight">
          Pipeline
          <br />
          Console
        </h1>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Lead generation &amp; RFP tracking
        </div>
      </div>

      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const active = item.id === current
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left text-[12.5px] transition-colors',
                active
                  ? 'border-primary/25 bg-brand-soft text-primary'
                  : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
              )}
            >
              <span className="size-[5px] shrink-0 rounded-full bg-current" />
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3 px-1">
        {session?.user.email && (
          <div className="truncate text-[10.5px] text-faint" title={session.user.email}>
            {session.user.email}
          </div>
        )}
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOutIcon className="size-3" />
          Sign out
        </button>
        <div className="text-[10.5px] leading-relaxed text-faint">
          Tenacity · Innovation
          <br />
          Excellence · Speed
        </div>
      </div>
    </aside>
  )
}
