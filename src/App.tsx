import { lazy, Suspense, useState } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { AppSidebar } from '@/components/app-sidebar'
import { AuthProvider, useAuth } from '@/hooks/use-auth'
import { PipelineProvider, usePipeline } from '@/hooks/use-pipeline'
import { isSupabaseConfigured } from '@/lib/supabase'
import type { ViewId } from '@/lib/nav'
import { SetupNotice } from '@/views/setup-notice'
import { SignInView } from '@/views/sign-in'
import { DashboardView } from '@/views/dashboard/dashboard-view'
import { LeadsView } from '@/views/leads/leads-view'
import { RfpsView } from '@/views/rfps/rfps-view'
import { TasksView } from '@/views/tasks/tasks-view'
import { ReportView } from '@/views/report/report-view'

// Recharts is a large dependency used by this view alone — keep it out of the
// bundle everyone downloads on first load.
const ProgressView = lazy(() =>
  import('@/views/progress/progress-view').then((module) => ({
    default: module.ProgressView,
  })),
)

function Console() {
  const [view, setView] = useState<ViewId>('dashboard')
  const { loading, error } = usePipeline()

  return (
    <div className="flex min-h-screen">
      <AppSidebar current={view} onNavigate={setView} />
      <main className="w-full max-w-[1240px] flex-1 px-6 py-8 lg:px-10">
        {error && (
          <div className="mb-5 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-xs text-danger">
            {error}
          </div>
        )}
        {/* Hold the frame while refetching rather than flashing a skeleton. */}
        <div className={loading ? 'opacity-60 transition-opacity' : undefined}>
          {view === 'dashboard' && <DashboardView />}
          {view === 'leads' && <LeadsView />}
          {view === 'rfps' && <RfpsView />}
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
          {view === 'tasks' && <TasksView />}
          {view === 'report' && <ReportView />}
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
