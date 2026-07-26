import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import * as db from '@/lib/db'
import type { Lead, Rfp, Task, WeeklyReport } from '@/lib/types'
import { useAuth } from './use-auth'

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
  loading: boolean
  error: string | null
  refresh: () => Promise<void>

  saveLead: (
    draft: db.LeadDraft,
    existing: Lead | null,
  ) => Promise<void>
  removeLead: (id: string) => Promise<void>

  saveRfp: (draft: db.RfpDraft, existing: Rfp | null) => Promise<void>
  removeRfp: (id: string) => Promise<void>
  importRfps: (drafts: db.RfpDraft[]) => Promise<number>

  addTask: (draft: db.TaskDraft) => Promise<void>
  toggleTask: (id: string, done: boolean) => Promise<void>
  removeTask: (id: string) => Promise<void>

  saveReport: (draft: db.WeeklyReportDraft) => Promise<void>
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!session) {
      setLeads([])
      setRfps([])
      setTasks([])
      setReports([])
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
      loading,
      error,
      refresh,
      saveLead,
      removeLead,
      saveRfp,
      removeRfp,
      importRfps,
      addTask,
      toggleTask,
      removeTask,
      saveReport,
    }),
    [
      leads,
      rfps,
      tasks,
      reports,
      loading,
      error,
      refresh,
      saveLead,
      removeLead,
      saveRfp,
      removeRfp,
      importRfps,
      addTask,
      toggleTask,
      removeTask,
      saveReport,
    ],
  )

  return <PipelineContext value={value}>{children}</PipelineContext>
}

export function usePipeline(): PipelineValue {
  const value = use(PipelineContext)
  if (!value) throw new Error('usePipeline must be used inside <PipelineProvider>')
  return value
}
