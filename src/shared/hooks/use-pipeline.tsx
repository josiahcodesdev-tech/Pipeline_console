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
import * as db from '@/data/db'
import { runOpportunitySync } from '@/services/opportunities'
import { OPPORTUNITY_SYNC } from '@/app/features'
import { EMPTY_SETTINGS } from '@/domain/types'
import type {
  Activity,
  Consultant,
  Lead,
  Proposal,
  UserSettings,
  LeadStatus,
  Rfp,
  RfpClaim,
  RfpStatus,
  Task,
  WeeklyReport,
} from '@/domain/types'
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
  /** Who has taken which tender, firm-wide. Keyed by external id. */
  claims: Map<string, RfpClaim>
  tasks: Task[]
  reports: WeeklyReport[]
  activities: Activity[]
  proposals: Proposal[]
  consultants: Consultant[]
  settings: UserSettings
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
  /** Hands a tender and its attached work to another member. Oversight only. */
  reassignRfp: (id: string, newOwner: string) => Promise<void>
  importRfps: (drafts: db.RfpDraft[]) => Promise<number>
  setTenderDocument: (id: string, text: string, fileName: string) => Promise<void>
  /** Stores the drafter’s reading of a tender, and the notice it read. */
  saveTenderAnalysis: (id: string, analysis: string, noticeText: string) => Promise<void>
  syncOpportunities: () => Promise<SyncOutcome>
  /** State of the background sync, for status text in the RFPs view. */
  autoSync: AutoSyncStatus
  /** Epoch ms of the last successful sync, or null if never. */
  syncedAt: number | null

  addTask: (draft: db.TaskDraft) => Promise<void>
  toggleTask: (id: string, done: boolean) => Promise<void>
  removeTask: (id: string) => Promise<void>

  saveReport: (draft: db.WeeklyReportDraft) => Promise<void>

  saveDraftProposal: (rfpId: string, title: string, content: string) => Promise<void>
  uploadProposal: (rfpId: string, file: File, notes: string) => Promise<void>
  removeProposal: (proposal: Proposal) => Promise<void>
  setProposalExemplar: (id: string, isExemplar: boolean) => Promise<void>
  addPastProposal: (rfpId: string, title: string, content: string) => Promise<void>
  saveConsultant: (draft: db.ConsultantDraft, existing: Consultant | null) => Promise<void>
  /** Attaches a photo or CV, or clears one when `file` is null. */
  setConsultantFile: (
    consultant: Consultant,
    kind: 'photo' | 'cv',
    file: File | null,
  ) => Promise<void>
  removeConsultant: (id: string) => Promise<void>
  saveSettings: (next: UserSettings) => Promise<void>

  logActivity: (draft: db.ActivityDraft) => Promise<void>
  removeActivity: (id: string) => Promise<void>
  /** Writes the call report attached to one client visit. */
  saveCallReport: (id: string, fields: db.CallReportFields) => Promise<void>
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
  const { session, can } = useAuth()
  const [leads, setLeads] = useState<Lead[]>([])
  const [rfps, setRfps] = useState<Rfp[]>([])
  const [claims, setClaims] = useState<RfpClaim[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [reports, setReports] = useState<WeeklyReport[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [consultants, setConsultants] = useState<Consultant[]>([])
  const [settings, setSettings] = useState<UserSettings>(EMPTY_SETTINGS)
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
      setProposals([])
      setConsultants([])
      setSettings(EMPTY_SETTINGS)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const snapshot = await db.fetchAll(can.seeEveryone)
      setLeads(snapshot.leads)
      setRfps(snapshot.rfps)
      setTasks(snapshot.tasks)
      setReports(snapshot.reports)
      setActivities(snapshot.activities)
      setProposals(snapshot.proposals)
      setConsultants(snapshot.consultants)
      // Claims are read separately and allowed to fail on their own. Losing
      // them should cost the tracker its "taken by" labels, not the tracker.
      try {
        setClaims(await db.fetchRfpClaims())
      } catch {
        setClaims([])
      }
      // Settings are small and read on their own; a failure here should not
      // cost the snapshot, so it degrades to the empty defaults.
      try {
        setSettings(await db.fetchSettings())
      } catch {
        setSettings(EMPTY_SETTINGS)
      }
      // Partial failures surface as a banner while the tables that *did* load
      // still render — a missing table must not look like lost data.
      setError(snapshot.errors.length ? snapshot.errors.join(' ') : null)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setLoading(false)
    }
    // `can.seeEveryone` belongs here as much as `session` does. The profile
    // that carries the role arrives a moment after the session, so the first
    // load always runs as a plain user; without this the snapshot would stay
    // that way and an admin would sit looking at an empty tracker until they
    // reloaded the page.
  }, [session, can.seeEveryone])

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
      const saved = await db.setRfpPipeline(id, inPipeline, current?.externalId ?? null)
      setRfps((list) => list.map((rfp) => (rfp.id === id ? saved : rfp)))
      if (inPipeline && current?.status === 'Watching') {
        const promoted = await db.updateRfpStatus(id, 'Preparing')
        setRfps((list) => list.map((rfp) => (rfp.id === id ? promoted : rfp)))
      }
      // Refreshed either way: taking one on adds a claim, handing it back
      // removes one, and both change what everyone else may take.
      setClaims(await db.fetchRfpClaims())
      toast.success(inPipeline ? 'Added to the pipeline' : 'Removed from the pipeline')
    } catch (cause) {
      if (cause instanceof db.RfpAlreadyClaimed) {
        // Someone took it between the page rendering and the click. Pull the
        // claims so the row updates to show who, rather than leaving a button
        // that will keep failing.
        setClaims(await db.fetchRfpClaims().catch(() => claims))
      }
      toast.error(message(cause))
    }
  }, [rfps, claims])

  const saveTenderAnalysis = useCallback(
    async (id: string, analysis: string, noticeText: string) => {
      const saved = await db.saveTenderAnalysis(id, analysis, noticeText)
      setRfps((list) => list.map((rfp) => (rfp.id === id ? saved : rfp)))
    },
    [],
  )
  const reassignRfp = useCallback(async (id: string, newOwner: string) => {
    await db.reassignRfp(id, newOwner)
    // A full reload rather than patching state: the move rewrites four tables,
    // can delete the new owner's duplicate copy, and changes what the reader
    // may see at all — an admin who reassigns their own row loses nothing, but
    // a member watching this happen does. Cheaper to re-read than to model it.
    await refresh()
  }, [refresh])

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

  const setTenderDocument = useCallback(
    async (id: string, text: string, fileName: string) => {
      const saved = await db.setTenderDocument(id, text, fileName)
      setRfps((current) => current.map((rfp) => (rfp.id === id ? saved : rfp)))
      toast.success(text ? 'Tender document attached' : 'Tender document removed')
    },
    [],
  )

  const syncOpportunities = useCallback(async (): Promise<SyncOutcome> => {
    // Belt and braces alongside the hidden button: nothing should reach the
    // sources while the flag is off, including a stale tab or a keyboard path.
    if (!OPPORTUNITY_SYNC) {
      return { fetched: 0, added: 0, alreadyHave: 0, skipped: [] }
    }

    // The Edge Function fetches every source and writes the rows itself, so
    // there is nothing to insert here — only to catch up with what it did.
    const report = await runOpportunitySync()

    // Re-read rather than diff: the function inserts across several sources at
    // once and reports counts, not rows. Skipped when nothing arrived, so the
    // common "already up to date" case costs no extra round trip.
    if (report.added > 0) setRfps(await db.listRfps())

    // Stamped here rather than in the caller so the manual "Check now" button
    // and the automatic run both refresh the "Updated …" status.
    markSynced()
    setSyncedAt(Date.now())

    return {
      fetched: report.fetched,
      added: report.added,
      alreadyHave: report.alreadyHave,
      skipped: report.skipped,
    }
  }, [])

  /**
   * Pull new opportunities on load, without the user asking.
   *
   * Runs once the initial fetch has settled (so the tracker is populated
   * first), at most once per mount, and only if the throttle window has
   * elapsed. Failures are deliberately quiet: this is background work the user
   * did not initiate, and a source outage should not greet them with an error
   * toast. A new arrival IS worth interrupting for, so that still toasts.
   *
   * This is a convenience on top of the 05:00 scheduled run, not the mechanism:
   * the tracker is filled overnight whether or not anyone opens the console.
   */
  useEffect(() => {
    if (!OPPORTUNITY_SYNC) return
    if (!session || loading || autoSyncStarted.current) return
    // Standard users cannot pull the sources, and the function refuses them.
    // Firing it anyway would greet every one of them with a failed sync on
    // sign-in, for something they never asked for. The 05:00 scheduled run
    // fills the tracker regardless of who is signed in.
    if (!can.sync) return

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
            `${outcome.added} new opportunit${outcome.added === 1 ? 'y' : 'ies'}`,
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
  }, [session, loading, can.sync, syncOpportunities])

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

  const saveDraftProposal = useCallback(
    async (rfpId: string, title: string, content: string) => {
      const saved = await db.saveDraftProposal(rfpId, title, content)
      setProposals((current) => [saved, ...current])
      toast.success('Draft saved to this RFP')
    },
    [],
  )

  const uploadProposal = useCallback(
    async (rfpId: string, file: File, notes: string) => {
      const saved = await db.uploadSubmittedProposal(rfpId, file, notes)
      setProposals((current) => [saved, ...current])
      toast.success(`${saved.fileName} uploaded`)
    },
    [],
  )

  const saveConsultant = useCallback(
    async (draft: db.ConsultantDraft, existing: Consultant | null) => {
      const saved = existing
        ? await db.updateConsultant(existing.id, draft)
        : await db.createConsultant(draft)
      // Sorted by name, matching the order fetchAll returns, so a newly added
      // consultant lands where it will be after the next reload rather than
      // jumping to the top and moving later.
      setConsultants((current) =>
        upsertInto(current, saved).sort((a, b) => a.name.localeCompare(b.name)),
      )
      toast.success('Consultant saved')
    },
    [],
  )

  /**
   * Attaches a photo or CV, or clears one.
   *
   * Separate from `saveConsultant` because uploading is not editing: it needs
   * a row that already exists to hang the file off, and it should not be
   * undone by someone cancelling out of the form afterwards.
   */
  const setConsultantFile = useCallback(
    async (consultant: Consultant, kind: 'photo' | 'cv', file: File | null) => {
      try {
        const saved = file
          ? kind === 'photo'
            ? await db.setConsultantPhoto(consultant.id, file)
            : await db.setConsultantCv(consultant.id, file)
          : await db.clearConsultantFile(consultant, kind)
        setConsultants((current) =>
          upsertInto(current, saved).sort((a, b) => a.name.localeCompare(b.name)),
        )
        toast.success(
          file
            ? kind === 'photo' ? 'Photo updated' : 'CV attached'
            : kind === 'photo' ? 'Photo removed' : 'CV removed',
        )
      } catch (cause) {
        toast.error(message(cause))
      }
    },
    [],
  )

  const removeConsultant = useCallback(async (id: string) => {
    await db.deleteConsultant(id)
    setConsultants((current) => current.filter((person) => person.id !== id))
    toast.success('Consultant removed')
  }, [])

  const setProposalExemplar = useCallback(async (id: string, isExemplar: boolean) => {
    const saved = await db.setProposalExemplar(id, isExemplar)
    setProposals((current) => current.map((item) => (item.id === id ? saved : item)))
    toast.success(isExemplar ? 'Marked as a model answer' : 'No longer an example')
  }, [])

  const addPastProposal = useCallback(
    async (rfpId: string, title: string, content: string) => {
      const saved = await db.savePastedProposal(rfpId, title, content)
      setProposals((current) => [saved, ...current])
      toast.success('Past proposal recorded')
    },
    [],
  )

  const saveSettings = useCallback(async (next: UserSettings) => {
    setSettings(await db.saveSettings(next))
    toast.success('Guidance saved — it applies to the next draft')
  }, [])

  const removeProposal = useCallback(async (proposal: Proposal) => {
    await db.deleteProposal(proposal)
    setProposals((current) => current.filter((item) => item.id !== proposal.id))
    toast.success('Removed')
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

  const saveCallReport = useCallback(
    async (id: string, fields: db.CallReportFields) => {
      const saved = await db.saveCallReport(id, fields)
      setActivities((current) =>
        current.map((activity) => (activity.id === id ? saved : activity)),
      )
    },
    [],
  )

  const saveReport = useCallback(async (draft: db.WeeklyReportDraft) => {
    const saved = await db.saveWeeklyReport(draft)
    setReports((current) => upsertInto(current, saved))
  }, [])

  const value = useMemo<PipelineValue>(
    () => ({
      leads,
      rfps,
      // A map because every row in the tracker asks "is this one taken?" — a
      // linear scan per row turns the render quadratic on a few hundred rows.
      claims: new Map(claims.map((claim) => [claim.externalId, claim])),
      tasks,
      reports,
      activities,
      proposals,
      consultants,
      settings,
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

      reassignRfp,
      importRfps,
      setTenderDocument,

      saveTenderAnalysis,
      syncOpportunities,
      autoSync,
      syncedAt,
      addTask,
      toggleTask,
      removeTask,
      saveReport,
      saveDraftProposal,
      uploadProposal,
      removeProposal,
      setProposalExemplar,
      addPastProposal,
      saveConsultant,
      setConsultantFile,
      removeConsultant,
      saveSettings,
      logActivity,
      removeActivity,
      saveCallReport,
    }),
    [
      leads,
      claims,
      rfps,
      tasks,
      reports,
      activities,
      proposals,
      consultants,
      settings,
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

      reassignRfp,
      importRfps,
      setTenderDocument,

      saveTenderAnalysis,
      syncOpportunities,
      autoSync,
      syncedAt,
      addTask,
      toggleTask,
      removeTask,
      saveReport,
      saveDraftProposal,
      uploadProposal,
      removeProposal,
      setProposalExemplar,
      addPastProposal,
      saveConsultant,
      removeConsultant,
      saveSettings,
      logActivity,
      removeActivity,
      saveCallReport,
    ],
  )

  return <PipelineContext value={value}>{children}</PipelineContext>
}

export function usePipeline(): PipelineValue {
  const value = use(PipelineContext)
  if (!value) throw new Error('usePipeline must be used inside <PipelineProvider>')
  return value
}
