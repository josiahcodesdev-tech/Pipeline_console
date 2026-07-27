import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import * as db from '@/lib/db'
import { fetchOpportunities } from '@/lib/opportunities'
import type {
  Activity,
  Lead,
  LeadStatus,
  Rfp,
  RfpStatus,
  Task,
  WeeklyReport,
} from '@/lib/types'
import { useAuth } from './use-auth'

/**
 * How long to leave between automatic syncs. The CareerCraft scraper runs on a
 * daily cron, so anything tighter than this is just traffic — the manual button
 * is always there for an immediate check.
 */
const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000

const LAST_SYNC_KEY = 'pipeline-console:last-sync'

/** Persisted across reloads so opening a second tab doesn't re-sync. */
function lastSyncedAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY)
    const value = raw ? Number(raw) : NaN
    return Number.isFinite(value) ? value : null
  } catch {
    return null // private mode / storage disabled — just sync every time
  }
}

function markSynced() {
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
  } catch {
    /* non-fatal */
  }
}

export type AutoSyncStatus = 'idle' | 'syncing' | 'done' | 'failed'

/** Result of a CareerCraft sync, for reporting back to the user. */
export interface SyncOutcome {
  /** Rows the feed returned. */
  fetched: number
  /** Rows actually added to the tracker this run. */
  added: number
  /** Rows already held, left untouched so local edits survive. */
  alreadyHave: number
  /** Rows the feed returned that could not be mapped. */
  skipped: string[]
}

/**
 * Holds the whole dataset in memory. The console is single-user and the volumes
 * are small (hundreds of rows), so every view filters and aggregates from this
 * one snapshot rather than issuing its own queries — the same shape the
 * original prototype had, minus the global mutable arrays.
 */
interface PipelineValue {
  leads: Lead[]
  rfps: Rfp[]
  tasks: Task[]
  reports: WeeklyReport[]
  activities: Activity[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>

  saveLead: (
    draft: db.LeadDraft,
    existing: Lead | null,
  ) => Promise<void>
  removeLead: (id: string) => Promise<void>
  setLeadStatus: (id: string, status: LeadStatus) => Promise<void>

  saveRfp: (draft: db.RfpDraft, existing: Rfp | null) => Promise<void>
  removeRfp: (id: string) => Promise<void>
  setRfpStatus: (id: string, status: RfpStatus) => Promise<void>
  setRfpPipeline: (id: string, inPipeline: boolean) => Promise<void>
  importRfps: (drafts: db.RfpDraft[]) => Promise<number>
  syncOpportunities: () => Promise<SyncOutcome>
  /** State of the background sync, for status text in the RFPs view. */
  autoSync: AutoSyncStatus
  /** Epoch ms of the last successful sync, or null if never. */
  syncedAt: number | null

  addTask: (draft: db.TaskDraft) => Promise<void>
  toggleTask: (id: string, done: boolean) => Promise<void>
  removeTask: (id: string) => Promise<void>

  saveReport: (draft: db.WeeklyReportDraft) => Promise<void>

  logActivity: (draft: db.ActivityDraft) => Promise<void>
  removeActivity: (id: string) => Promise<void>
}

const PipelineContext = createContext<PipelineValue | null>(null)

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Replaces a row in place, or prepends it when it is new. */
function upsertInto<T extends { id: string }>(list: T[], row: T): T[] {
  const index = list.findIndex((item) => item.id === row.id)
  if (index === -1) return [row, ...list]
  const next = list.slice()
  next[index] = row
  return next
}

export function PipelineProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [leads, setLeads] = useState<Lead[]>([])
  const [rfps, setRfps] = useState<Rfp[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [reports, setReports] = useState<WeeklyReport[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoSync, setAutoSync] = useState<AutoSyncStatus>('idle')
  const [syncedAt, setSyncedAt] = useState<number | null>(() => lastSyncedAt())
  // Guards against StrictMode's double-invoke and against re-running when the
  // provider re-renders — one automatic attempt per mount is the intent.
  const autoSyncStarted = useRef(false)

  const refresh = useCallback(async () => {
    if (!session) {
      setLeads([])
      setRfps([])
      setTasks([])
      setReports([])
      setActivities([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const snapshot = await db.fetchAll()
      setLeads(snapshot.leads)
      setRfps(snapshot.rfps)
      setTasks(snapshot.tasks)
      setReports(snapshot.reports)
      setActivities(snapshot.activities)
      setError(null)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const saveLead = useCallback(
    async (draft: db.LeadDraft, existing: Lead | null) => {
      const saved = existing
        ? await db.updateLead(existing.id, draft, {
            statusChanged: existing.status !== draft.status,
          })
        : await db.createLead(draft)
      setLeads((current) => upsertInto(current, saved))
      toast.success('Lead saved')
    },
    [],
  )

  const removeLead = useCallback(async (id: string) => {
    await db.deleteLead(id)
    setLeads((current) => current.filter((lead) => lead.id !== id))
    // A deleted lead cascades to `linked_lead = null` in Postgres; mirror that
    // locally so task rows stop showing a dangling organisation name.
    setTasks((current) =>
      current.map((task) =>
        task.linkedLead === id ? { ...task, linkedLead: null } : task,
      ),
    )
    toast.success('Lead deleted')
  }, [])

  /**
   * Inline status change from the table dropdown.
   *
   * Optimistic, because the pill is the feedback — a dropdown that snaps back
   * for half a second before settling reads as broken. On failure the previous
   * value is restored and the error surfaces, since this one the user did
   * initiate. No success toast: the pill visibly changing is confirmation
   * enough, and these get changed in runs.
   */
  const setLeadStatus = useCallback(
    async (id: string, status: LeadStatus) => {
      const previous = leads.find((lead) => lead.id === id)
      setLeads((current) =>
        current.map((lead) => (lead.id === id ? { ...lead, status } : lead)),
      )
      try {
        const saved = await db.updateLeadStatus(id, status)
        setLeads((current) =>
          current.map((lead) => (lead.id === id ? saved : lead)),
        )
      } catch (cause) {
        if (previous) {
          setLeads((current) =>
            current.map((lead) => (lead.id === id ? previous : lead)),
          )
        }
        toast.error(message(cause))
      }
    },
    [leads],
  )

  const setRfpStatus = useCallback(
    async (id: string, status: RfpStatus) => {
      const previous = rfps.find((rfp) => rfp.id === id)
      setRfps((current) =>
        current.map((rfp) => (rfp.id === id ? { ...rfp, status } : rfp)),
      )
      try {
        const saved = await db.updateRfpStatus(id, status)
        setRfps((current) => current.map((rfp) => (rfp.id === id ? saved : rfp)))
      } catch (cause) {
        if (previous) {
          setRfps((current) =>
            current.map((rfp) => (rfp.id === id ? previous : rfp)),
          )
        }
        toast.error(message(cause))
      }
    },
    [rfps],
  )

  /**
   * Takes an RFP into or out of the live proposal pipeline.
   *
   * Adding one that is still at Watching also moves it to Preparing: taking a
   * tender on and leaving it marked watching is a contradiction, and it
   * saves a second click on the action you were always going to take.
   */
  const setRfpPipeline = useCallback(async (id: string, inPipeline: boolean) => {
    const current = rfps.find((rfp) => rfp.id === id)
    try {
      const saved = await db.setRfpPipeline(id, inPipeline)
      setRfps((list) => list.map((rfp) => (rfp.id === id ? saved : rfp)))
      if (inPipeline && current?.status === 'Watching') {
        const promoted = await db.updateRfpStatus(id, 'Preparing')
        setRfps((list) => list.map((rfp) => (rfp.id === id ? promoted : rfp)))
      }
      toast.success(inPipeline ? 'Added to the pipeline' : 'Removed from the pipeline')
    } catch (cause) {
      toast.error(message(cause))
    }
  }, [rfps])

  const saveRfp = useCallback(async (draft: db.RfpDraft, existing: Rfp | null) => {
    const saved = existing
      ? await db.updateRfp(existing.id, draft, {
          statusChanged: existing.status !== draft.status,
        })
      : await db.createRfp(draft)
    setRfps((current) => upsertInto(current, saved))
    toast.success('RFP saved')
  }, [])

  const removeRfp = useCallback(async (id: string) => {
    await db.deleteRfp(id)
    setRfps((current) => current.filter((rfp) => rfp.id !== id))
    toast.success('RFP deleted')
  }, [])

  const importRfps = useCallback(async (drafts: db.RfpDraft[]) => {
    const created = await db.importRfps(drafts)
    setRfps((current) => [...created, ...current])
    return created.length
  }, [])

  const syncOpportunities = useCallback(async (): Promise<SyncOutcome> => {
    const { drafts, skipped } = await fetchOpportunities()

    // `ON CONFLICT DO NOTHING ... RETURNING *` returns only the rows actually
    // inserted, so the database itself tells us what was new — no need to diff
    // against local state first. That keeps this callback free of a `rfps`
    // dependency, which is what makes it safe to fire from an effect.
    const created = drafts.length ? await db.syncRfps(drafts) : []
    if (created.length) setRfps((current) => [...created, ...current])

    // Stamped here rather than in the caller so the manual "Check now" button
    // and the automatic run both refresh the "Updated …" status.
    markSynced()
    setSyncedAt(Date.now())

    return {
      fetched: drafts.length,
      added: created.length,
      alreadyHave: drafts.length - created.length,
      skipped,
    }
  }, [])

  /**
   * Pull new RFPs from CareerCraft on load, without the user asking.
   *
   * Runs once the initial fetch has settled (so the tracker is populated
   * first), at most once per mount, and only if the throttle window has
   * elapsed. Failures are deliberately quiet: this is background work the user
   * did not initiate, and a feed outage should not greet them with an error
   * toast. A new arrival IS worth interrupting for, so that still toasts.
   */
  useEffect(() => {
    if (!session || loading || autoSyncStarted.current) return

    const previous = lastSyncedAt()
    if (previous && Date.now() - previous < AUTO_SYNC_INTERVAL_MS) {
      setSyncedAt(previous)
      return
    }

    autoSyncStarted.current = true
    let active = true

    setAutoSync('syncing')
    syncOpportunities()
      .then((outcome) => {
        if (!active) return
        setAutoSync('done')
        if (outcome.added > 0) {
          toast.success(
            `${outcome.added} new RFP${outcome.added === 1 ? '' : 's'} from CareerCraft`,
          )
        }
      })
      .catch(() => {
        if (!active) return
        // Silent by design — surfaced as status text in the RFPs view instead.
        setAutoSync('failed')
      })

    return () => {
      active = false
    }
  }, [session, loading, syncOpportunities])

  const addTask = useCallback(async (draft: db.TaskDraft) => {
    const saved = await db.createTask(draft)
    setTasks((current) => [saved, ...current])
    toast.success('Task added')
  }, [])

  const toggleTask = useCallback(async (id: string, done: boolean) => {
    // Optimistic: a checkbox that lags behind the click feels broken.
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, done } : task)),
    )
    try {
      const saved = await db.setTaskDone(id, done)
      setTasks((current) =>
        current.map((task) => (task.id === id ? saved : task)),
      )
    } catch (cause) {
      setTasks((current) =>
        current.map((task) =>
          task.id === id ? { ...task, done: !done } : task,
        ),
      )
      toast.error(message(cause))
    }
  }, [])

  const removeTask = useCallback(async (id: string) => {
    await db.deleteTask(id)
    setTasks((current) => current.filter((task) => task.id !== id))
  }, [])

  const logActivity = useCallback(async (draft: db.ActivityDraft) => {
    const saved = await db.createActivity(draft)
    // Newest first, matching the order fetchAll returns.
    setActivities((current) => [saved, ...current])
    toast.success(`${saved.type} logged`)
  }, [])

  const removeActivity = useCallback(async (id: string) => {
    await db.deleteActivity(id)
    setActivities((current) => current.filter((activity) => activity.id !== id))
  }, [])

  const saveReport = useCallback(async (draft: db.WeeklyReportDraft) => {
    const saved = await db.saveWeeklyReport(draft)
    setReports((current) => upsertInto(current, saved))
  }, [])

  const value = useMemo<PipelineValue>(
    () => ({
      leads,
      rfps,
      tasks,
      reports,
      activities,
      loading,
      error,
      refresh,
      saveLead,
      removeLead,
      setLeadStatus,
      saveRfp,
      removeRfp,
      setRfpStatus,
      setRfpPipeline,
      importRfps,
      syncOpportunities,
      autoSync,
      syncedAt,
      addTask,
      toggleTask,
      removeTask,
      saveReport,
      logActivity,
      removeActivity,
    }),
    [
      leads,
      rfps,
      tasks,
      reports,
      activities,
      loading,
      error,
      refresh,
      saveLead,
      removeLead,
      setLeadStatus,
      saveRfp,
      removeRfp,
      setRfpStatus,
      setRfpPipeline,
      importRfps,
      syncOpportunities,
      autoSync,
      syncedAt,
      addTask,
      toggleTask,
      removeTask,
      saveReport,
      logActivity,
      removeActivity,
    ],
  )

  return <PipelineContext value={value}>{children}</PipelineContext>
}

export function usePipeline(): PipelineValue {
  const value = use(PipelineContext)
  if (!value) throw new Error('usePipeline must be used inside <PipelineProvider>')
  return value
}
