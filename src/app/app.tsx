import { lazy, Suspense, useState } from 'react'
import { MenuIcon } from 'lucide-react'
import { Toaster } from '@/shared/ui/sonner'
import { AppSidebar } from '@/app/app-sidebar'
import { AuthProvider, useAuth } from '@/shared/hooks/use-auth'
import { PipelineProvider, usePipeline } from '@/shared/hooks/use-pipeline'
import { isSupabaseConfigured } from '@/data/client'
import { PROPOSAL_DRAFTING } from '@/app/features'
import { canOpenView, type ViewId } from '@/app/nav'
import type { LeadStatus } from '@/domain/types'
import { SetupNotice } from '@/features/setup-notice'
import { SignInView } from '@/features/sign-in'
import { DashboardView } from '@/features/dashboard/dashboard-view'
import { LeadsView } from '@/features/leads/leads-view'
import { LeadProfile } from '@/features/leads/lead-profile'
import { RfpsView } from '@/features/rfps/rfps-view'
import { TasksView } from '@/features/tasks/tasks-view'
import { DigitalSolutionsView } from '@/features/digital-solutions/digital-solutions-view'
import { ActivityView } from '@/features/activity/activity-view'
import { PipelineView } from '@/features/pipeline/pipeline-view'
import { RfpProfile } from '@/features/rfps/rfp-profile'
import { ReportView } from '@/features/report/report-view'
import { SettingsView } from '@/features/settings/settings-view'
import { ConsultantsView } from '@/features/consultants/consultants-view'
import { MembersView } from '@/features/members/members-view'
import { RecordsView } from '@/features/records/records-view'
import { DeadlineAlerts } from '@/shared/components/deadline-alerts'

// Recharts is a large dependency used by this view alone — keep it out of the
// bundle everyone downloads on first load.
const ProgressView = lazy(() =>
  import('@/features/progress/progress-view').then((module) => ({
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
  const [requestedView, setView] = useState<ViewId>('dashboard')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  // Which RFP's profile is open, if any. Kept here rather than inside a view
  // so the tracker and the Proposals page can both open one, and switching
  // section closes it.
  const [profileId, setProfileId] = useState<string | null>(null)
  /** Which client's page is open, if any. Same idea, for leads. */
  const [leadId, setLeadId] = useState<string | null>(null)
  // Which pipeline stage the leads register should open filtered to, when it
  // was reached by clicking one on the dashboard. Cleared by any other
  // navigation so the filter never outlives the click that asked for it.
  const [leadStage, setLeadStage] = useState<LeadStatus | undefined>(undefined)
  const { rfps, leads, loading, error } = usePipeline()
  const { can } = useAuth()

  // Derived rather than corrected in an effect: a role can change under a
  // signed-in session, and a view the member may no longer open should fall
  // back to the dashboard rather than render an empty column.
  const view = canOpenView(requestedView, can.manageMembers, can.seeEveryone)
    ? requestedView
    : 'dashboard'

  const profileRfp = profileId
    ? (rfps.find((rfp) => rfp.id === profileId) ?? null)
    : null
  const profileLead = leadId ? (leads.find((lead) => lead.id === leadId) ?? null) : null

  function go(next: ViewId) {
    setProfileId(null)
    setLeadId(null)
    setLeadStage(undefined)
    setView(next)
  }

  /** Dashboard pipeline stage → the leads register, filtered to that stage. */
  function goToLeadStage(stage: LeadStatus) {
    setProfileId(null)
    setLeadId(null)
    setLeadStage(stage)
    setView('leads')
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
      <DeadlineAlerts onOpen={setProfileId} />
      {sidebarCollapsed ? (
        <button
          type="button"
          onClick={() => toggleSidebar(false)}
          aria-label="Show navigation"
          title="Show navigation"
          // Fixed rather than in the flow: with the sidebar gone there is no
          // column left to sit in, and `main` reserves the space via pl-12.
          // Back to a light chip now the slate bar it used to sit in is gone —
          // on a grey page a dark square floating over the first column of a
          // table reads as a rendering fault.
          className="fixed left-2 top-4 z-40 cursor-pointer rounded-md border border-border bg-card p-2 text-muted-foreground shadow-brand-sm transition-colors hover:text-foreground"
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
      {/* The column beside the rail.

          There was a slate top bar here, copied from the modules this console
          was restyled to match. In those it carries a Modules switcher, because
          they are several systems a person moves between; here there is nowhere
          to switch to, so it held the word "Modules" and a menu button wired to
          nothing — fifty-six pixels of chrome the width of the screen, saying
          so.

          `min-w-0` lets the flex child shrink below its content width, which is
          what stops a wide table pushing the *page* sideways — the table then
          scrolls inside its own container instead. */}
      <div className="flex w-full min-w-0 flex-1 flex-col">
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
          ) : profileLead ? (
            <LeadProfile lead={profileLead} onBack={() => setLeadId(null)} />
          ) : (
            <>
          {view === 'dashboard' && (
            <DashboardView
              onNavigate={go}
              onOpenProfile={setProfileId}
              onOpenLeadStage={goToLeadStage}
            />
          )}
          {/* Keyed on the stage so arriving from a different pipeline segment
              remounts the register rather than keeping the previous filter —
              `initialStatus` is genuinely initial. */}
          {view === 'leads' && (
            <LeadsView
              key={leadStage ?? 'all'}
              initialStatus={leadStage}
              onOpenProfile={setLeadId}
            />
          )}
          {view === 'rfps' && <RfpsView onOpenProfile={setProfileId} />}
          {view === 'digital-solutions' && (
            <DigitalSolutionsView onOpenProfile={setProfileId} />
          )}
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
          {view === 'records' && <RecordsView />}
          {view === 'consultants' && PROPOSAL_DRAFTING && <ConsultantsView />}
          {view === 'members' && <MembersView />}
          {view === 'settings' && PROPOSAL_DRAFTING && <SettingsView />}
            </>
          )}
        </div>
      </main>
      </div>
    </div>
  )
}

function Gate() {
  const { session, loading, suspended, signOut } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-xs text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!session) return <SignInView />

  // Valid credentials, withdrawn access. Worth its own screen rather than an
  // empty console: everything below would load and show nothing, which reads
  // as the app being broken rather than as a decision someone made.
  if (suspended) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-[380px] rounded-xl border border-border bg-card p-6 text-center shadow-brand-md">
          <h1 className="font-display text-[19px] text-foreground">
            Your access has been switched off
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Your sign-in still works, but this account cannot open the console.
            Ask your administrator to restore it.
          </p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-4 cursor-pointer text-[11px] text-primary transition-colors hover:text-clay"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

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
