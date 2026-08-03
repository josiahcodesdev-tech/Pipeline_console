import { lazy, Suspense, useState } from 'react'
import { MenuIcon } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { AppSidebar } from '@/components/app-sidebar'
import { AuthProvider, useAuth } from '@/hooks/use-auth'
import { PipelineProvider, usePipeline } from '@/hooks/use-pipeline'
import { isSupabaseConfigured } from '@/lib/supabase'
import { PROPOSAL_DRAFTING } from '@/lib/features'
import type { ViewId } from '@/lib/nav'
import { SetupNotice } from '@/views/setup-notice'
import { SignInView } from '@/views/sign-in'
import { DashboardView } from '@/views/dashboard/dashboard-view'
import { LeadsView } from '@/views/leads/leads-view'
import { RfpsView } from '@/views/rfps/rfps-view'
import { TasksView } from '@/views/tasks/tasks-view'
import { ActivityView } from '@/views/activity/activity-view'
import { PipelineView } from '@/views/pipeline/pipeline-view'
import { RfpProfile } from '@/views/rfps/rfp-profile'
import { ReportView } from '@/views/report/report-view'
import { SettingsView } from '@/views/settings/settings-view'
import { ConsultantsView } from '@/views/consultants/consultants-view'

// Recharts is a large dependency used by this view alone — keep it out of the
// bundle everyone downloads on first load.
const ProgressView = lazy(() =>
  import('@/views/progress/progress-view').then((module) => ({
    default: module.ProgressView,
  })),
)

/**
 * Whether the sidebar was left collapsed.
 *
 * Persisted because the reason to collapse it is to make room for a wide table
 * or a draft preview, and having it spring back on every reload would defeat
 * that. Failures are swallowed — a browser refusing storage should cost the
 * console a preference, not a render.
 */
const SIDEBAR_KEY = 'pipeline-console:sidebar-collapsed'

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true'
  } catch {
    return false
  }
}

function Console() {
  const [view, setView] = useState<ViewId>('dashboard')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  // Which RFP's profile is open, if any. Kept here rather than inside a view
  // so the tracker and the Proposals page can both open one, and switching
  // section closes it.
  const [profileId, setProfileId] = useState<string | null>(null)
  const { rfps, loading, error } = usePipeline()

  const profileRfp = profileId
    ? (rfps.find((rfp) => rfp.id === profileId) ?? null)
    : null

  function go(next: ViewId) {
    setProfileId(null)
    setView(next)
  }

  function toggleSidebar(collapsed: boolean) {
    setSidebarCollapsed(collapsed)
    try {
      localStorage.setItem(SIDEBAR_KEY, String(collapsed))
    } catch {
      // Preference lost, console unaffected.
    }
  }

  return (
    <div className="flex min-h-screen">
      {sidebarCollapsed ? (
        <button
          type="button"
          onClick={() => toggleSidebar(false)}
          aria-label="Show navigation"
          title="Show navigation"
          // Fixed rather than in the flow: with the sidebar gone there is no
          // column left to sit in, and `main` reserves the space via pl-12.
          className="fixed left-2 top-4 z-30 cursor-pointer rounded-lg border border-border bg-card p-2 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          <MenuIcon className="size-4" />
        </button>
      ) : (
        <AppSidebar
          current={view}
          onNavigate={go}
          onCollapse={() => toggleSidebar(true)}
        />
      )}
      {/* Full width by design — this is a data console, and the tables want
          every pixel. `min-w-0` lets the flex child shrink below its content
          width, which is what stops a wide table pushing the *page* sideways;
          the table then scrolls inside its own container instead.
          No top padding: the sticky ViewHeader supplies its own, so it can sit
          flush against the viewport top once the page scrolls. */}
      <main
        className={`w-full min-w-0 flex-1 pb-10 ${
          // Room for the floating hamburger, which would otherwise sit on top
          // of the first column of whatever table is open.
          sidebarCollapsed ? "pl-12 pr-6 lg:pl-14 lg:pr-8" : "px-6 lg:px-8"
        }`}
      >
        {/* Sits above the sticky header, so it needs the top spacing the header
            would otherwise have provided. */}
        {error && (
          <div className="mt-8 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-xs text-danger">
            {error}
          </div>
        )}
        {/* Hold the frame while refetching rather than flashing a skeleton. */}
        <div className={loading ? 'opacity-60 transition-opacity' : undefined}>
          {/* An open profile takes over the column — it is a record view, not a
              panel, and nesting it under a list would mean two scroll contexts
              and two headers. */}
          {profileRfp ? (
            <RfpProfile rfp={profileRfp} onBack={() => setProfileId(null)} />
          ) : (
            <>
          {view === 'dashboard' && <DashboardView />}
          {view === 'leads' && <LeadsView />}
          {view === 'rfps' && <RfpsView onOpenProfile={setProfileId} />}
          {view === 'progress' && (
            <Suspense
              fallback={
                <div className="py-10 text-center text-xs text-muted-foreground">
                  Loading charts…
                </div>
              }
            >
              <ProgressView />
            </Suspense>
          )}
          {view === 'pipeline' && <PipelineView onOpenProfile={setProfileId} />}
          {view === 'activity' && <ActivityView />}
          {view === 'tasks' && <TasksView />}
          {view === 'report' && <ReportView />}
          {view === 'consultants' && PROPOSAL_DRAFTING && <ConsultantsView />}
          {view === 'settings' && PROPOSAL_DRAFTING && <SettingsView />}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

function Gate() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-xs text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!session) return <SignInView />

  return (
    <PipelineProvider>
      <Console />
    </PipelineProvider>
  )
}

export default function App() {
  return (
    <>
      {isSupabaseConfigured ? (
        <AuthProvider>
          <Gate />
        </AuthProvider>
      ) : (
        <SetupNotice />
      )}
      <Toaster position="bottom-right" />
    </>
  )
}
