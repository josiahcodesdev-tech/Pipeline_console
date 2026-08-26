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
import { fetchAll } from '@/data/snapshot'
import { supabase } from '@/data/client'
import { fetchSettings, saveSettings as dbSaveSettings } from '@/data/settings'
import {
  deleteProposal,
  saveDraftProposal as dbSaveDraftProposal,
  savePastedProposal,
  setProposalExemplar as dbSetProposalExemplar,
  uploadSubmittedProposal,
} from '@/data/proposals'
import {
  createActivity,
  deleteActivity,
  saveCallReport as dbSaveCallReport,
  type ActivityDraft,
  type CallReportFields,
} from '@/data/activities'
import {
  createLead,
  deleteLead,
  updateLead,
  updateLeadStatus,
  type LeadDraft,
} from '@/data/leads'
import {
  RfpAlreadyClaimed,
  createRfp,
  deleteRfp,
  fetchRfpClaims,
  importRfps as dbImportRfps,
  reassignRfp as dbReassignRfp,
  saveTenderAnalysis as dbSaveTenderAnalysis,
  saveTenderIntelligence as persistTenderIntelligence,
  setRfpPipeline as dbSetRfpPipeline,
  setTenderDocument as dbSetTenderDocument,
  updateRfp,
  updateRfpStatus,
  type RfpDraft,
} from '@/data/rfps'
import { createTask, deleteTask, setTaskDone, type TaskDraft } from '@/data/tasks'
import { saveWeeklyReport, type WeeklyReportDraft } from '@/data/reports'
import {
  clearConsultantFile,
  createConsultant,
  deleteConsultant,
  setConsultantCv,
  setConsultantPhoto,
  updateConsultant,
  type ConsultantDraft,
} from '@/data/consultants'
import { runOpportunitySync } from '@/services/opportunities'
import { OPPORTUNITY_SYNC } from '@/app/features'
import { EMPTY_SETTINGS } from '@/domain/types'
import type {
  Activity,
  Consultant,
  Lead,
  Proposal,
  ProposalDesign,
  UserSettings,
  LeadStatus,
  Rfp,
  RfpClaim,
  RfpShare,
  RfpStatus,
  Task,
  Team,
  WeeklyReport,
} from '@/domain/types'
import {
  addTeamMember as dbAddTeamMember,
  createTeam as dbCreateTeam,
  deleteTeam as dbDeleteTeam,
  fetchShares,
  fetchTeams,
  removeTeamMember as dbRemoveTeamMember,
  renameTeam as dbRenameTeam,
  revokeShare as dbRevokeShare,
  shareRfp as dbShareRfp,
} from '@/data/sharing'
import { useAuth } from './use-auth'

/**
 * How long to leave between automatic syncs. The CareerCraft scraper runs on a
 * daily cron, so anything tighter than this is just traffic — the manual button
 * is always there for an immediate check.
 */
const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000

const LAST_SYNC_KEY = 'pipeline-console:last-sync'
// Bumped when `CachedPipeline` gains a field. A snapshot written before the
// change parses cleanly and is missing the new one, which surfaces as an
// undefined array somewhere far from here rather than as a cache miss.
const SNAPSHOT_CACHE_VERSION = 2
const SNAPSHOT_CACHE_TTL_MS = 15 * 60 * 1000

interface CachedPipeline {
  version: number
  savedAt: number
  leads: Lead[]
  rfps: Rfp[]
  tasks: Task[]
  reports: WeeklyReport[]
  activities: Activity[]
  proposals: Proposal[]
  consultants: Consultant[]
  claims: RfpClaim[]
  teams: Team[]
  shares: RfpShare[]
  settings: UserSettings
  error: string | null
}

function snapshotCacheKey(userId: string, seeEveryone: boolean): string {
  return `pipeline-console:snapshot:${userId}:${seeEveryone ? 'oversight' : 'own'}`
}

function readSnapshotCache(userId: string, seeEveryone: boolean): CachedPipeline | null {
  try {
    const raw = sessionStorage.getItem(snapshotCacheKey(userId, seeEveryone))
    if (!raw) return null
    const cached = JSON.parse(raw) as CachedPipeline
    if (
      cached.version !== SNAPSHOT_CACHE_VERSION ||
      Date.now() - cached.savedAt > SNAPSHOT_CACHE_TTL_MS
    ) {
      sessionStorage.removeItem(snapshotCacheKey(userId, seeEveryone))
      return null
    }
    return cached
  } catch {
    return null
  }
}

function writeSnapshotCache(
  userId: string,
  seeEveryone: boolean,
  cached: Omit<CachedPipeline, 'version' | 'savedAt'>,
): void {
  try {
    sessionStorage.setItem(
      snapshotCacheKey(userId, seeEveryone),
      JSON.stringify({ ...cached, version: SNAPSHOT_CACHE_VERSION, savedAt: Date.now() }),
    )
  } catch {
    // Storage can be disabled or full. Fresh network data still works.
  }
}

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
  /** Standing groups of members, as share subjects. Everyone may read these. */
  teams: Team[]
  /**
   * Read grants on tenders, keyed by RFP id.
   *
   * Both directions live in here — shares the reader granted on their own
   * tenders and shares pointed at them — because the policy in 0039 returns
   * both and separating them client-side would mean two lists that have to be
   * kept in step. `sharedWithMe` below is the one derived answer worth caching.
   */
  shares: Map<string, RfpShare[]>
  /** RFP ids the reader can see only because somebody shared them. */
  sharedWithMe: Set<string>
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
    draft: LeadDraft,
    existing: Lead | null,
  ) => Promise<void>
  removeLead: (id: string) => Promise<void>
  setLeadStatus: (id: string, status: LeadStatus) => Promise<void>

  saveRfp: (draft: RfpDraft, existing: Rfp | null) => Promise<void>
  removeRfp: (id: string) => Promise<void>
  setRfpStatus: (id: string, status: RfpStatus) => Promise<void>
  setRfpPipeline: (id: string, inPipeline: boolean) => Promise<void>
  /** Hands a tender and its attached work to another member. Oversight only. */
  reassignRfp: (id: string, newOwner: string) => Promise<void>
  importRfps: (drafts: RfpDraft[]) => Promise<number>
  setTenderDocument: (id: string, text: string, fileName: string) => Promise<void>
  /** Stores the drafter’s reading of a tender, and the notice it read. */
  saveTenderAnalysis: (id: string, analysis: string, noticeText: string) => Promise<void>
  saveTenderIntelligence: (id: string, fields: Parameters<typeof persistTenderIntelligence>[1]) => Promise<void>
  syncOpportunities: () => Promise<SyncOutcome>
  /** State of the background sync, for status text in the RFPs view. */
  autoSync: AutoSyncStatus
  /** Epoch ms of the last successful sync, or null if never. */
  syncedAt: number | null

  addTask: (draft: TaskDraft) => Promise<void>
  toggleTask: (id: string, done: boolean) => Promise<void>
  removeTask: (id: string) => Promise<void>

  saveReport: (draft: WeeklyReportDraft) => Promise<void>

  saveDraftProposal: (
    rfpId: string,
    title: string,
    content: string,
    design?: ProposalDesign | null,
  ) => Promise<void>
  uploadProposal: (rfpId: string, file: File, notes: string, content?: string) => Promise<void>
  removeProposal: (proposal: Proposal) => Promise<void>
  setProposalExemplar: (id: string, isExemplar: boolean) => Promise<void>
  addPastProposal: (rfpId: string, title: string, content: string) => Promise<void>
  saveConsultant: (draft: ConsultantDraft, existing: Consultant | null) => Promise<void>
  /** Attaches a photo or CV, or clears one when `file` is null. */
  setConsultantFile: (
    consultant: Consultant,
    kind: 'photo' | 'cv',
    file: File | null,
  ) => Promise<void>
  removeConsultant: (id: string) => Promise<void>
  saveSettings: (next: UserSettings) => Promise<void>

  logActivity: (draft: ActivityDraft) => Promise<void>
  removeActivity: (id: string) => Promise<void>
  /** Writes the call report attached to one client visit. */
  saveCallReport: (id: string, fields: CallReportFields) => Promise<void>

  /** Grants read on one tender to a member or a team. Owner or oversight. */
  shareRfpWith: (
    rfpId: string,
    subject: { kind: 'member'; id: string } | { kind: 'team'; id: string },
  ) => Promise<void>
  revokeRfpShare: (shareId: string) => Promise<void>
  createTeam: (name: string) => Promise<void>
  renameTeam: (id: string, name: string) => Promise<void>
  removeTeam: (id: string) => Promise<void>
  setTeamMember: (teamId: string, userId: string, member: boolean) => Promise<void>
}

const PipelineContext = createContext<PipelineValue | null>(null)

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Replaces a row in place, or prepends it when it is new. */
function groupSharesByRfp(shares: RfpShare[]): Map<string, RfpShare[]> {
  const byRfp = new Map<string, RfpShare[]>()
  for (const share of shares) {
    const list = byRfp.get(share.rfpId) ?? []
    list.push(share)
    byRfp.set(share.rfpId, list)
  }
  return byRfp
}

/**
 * The tenders this reader can see only because somebody granted them.
 *
 * A grant reaches them two ways — pointed at them by name, or at a team they
 * are in — and both have to be resolved here because the database answered the
 * same question in SQL (`shared_rfp_ids`) and does not send its working back.
 * Shares the reader *granted* are excluded by construction: those name someone
 * else as the subject.
 */
function sharedWithMeFrom(
  shares: RfpShare[],
  teams: Team[],
  userId: string | undefined,
): Set<string> {
  if (!userId) return new Set()
  const myTeams = new Set(
    teams.filter((team) => team.memberIds.includes(userId)).map((team) => team.id),
  )
  return new Set(
    shares
      .filter(
        (share) =>
          share.memberId === userId || (share.teamId !== null && myTeams.has(share.teamId)),
      )
      .map((share) => share.rfpId),
  )
}

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
  const [teams, setTeams] = useState<Team[]>([])
  const [shares, setShares] = useState<RfpShare[]>([])
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
      // Cleared on sign-out unlike the rest, which the next sign-in overwrites
      // anyway: these two say who may read what, and the wrong answer left
      // sitting in memory is the one that marks a tender editable.
      setTeams([])
      setShares([])
      setSettings(EMPTY_SETTINGS)
      setLoading(false)
      return
    }
    const userId = session.user.id
    const cached = readSnapshotCache(userId, can.seeEveryone)
    if (cached) {
      setLeads(cached.leads)
      setRfps(cached.rfps)
      setTasks(cached.tasks)
      setReports(cached.reports)
      setActivities(cached.activities)
      setProposals(cached.proposals)
      setConsultants(cached.consultants)
      setClaims(cached.claims)
      setTeams(cached.teams)
      setShares(cached.shares)
      setSettings(cached.settings)
      setError(cached.error)
      setLoading(false)
    } else {
      setLoading(true)
    }
    try {
      const snapshot = await fetchAll(can.seeEveryone)
      setLeads(snapshot.leads)
      setRfps(snapshot.rfps)
      setTasks(snapshot.tasks)
      setReports(snapshot.reports)
      setActivities(snapshot.activities)
      setProposals(snapshot.proposals)
      setConsultants(snapshot.consultants)
      // Claims are read separately and allowed to fail on their own. Losing
      // them should cost the tracker its "taken by" labels, not the tracker.
      let nextClaims: RfpClaim[] = []
      try {
        nextClaims = await fetchRfpClaims()
        setClaims(nextClaims)
      } catch {
        setClaims([])
      }
      // Teams and shares, on the same terms as claims: a tender the reader can
      // see stays visible whether or not the sharing tables answered. What is
      // lost on failure is the "shared with" labels and the read-only marking,
      // and the second of those is why they are read together — a snapshot
      // with shares but no teams could not resolve a team grant and would show
      // a tender as nobody's.
      let nextTeams: Team[] = []
      let nextShares: RfpShare[] = []
      try {
        ;[nextTeams, nextShares] = await Promise.all([fetchTeams(), fetchShares()])
        setTeams(nextTeams)
        setShares(nextShares)
      } catch {
        setTeams([])
        setShares([])
      }
      // Settings are small and read on their own; a failure here should not
      // cost the snapshot, so it degrades to the empty defaults.
      let nextSettings = EMPTY_SETTINGS
      try {
        nextSettings = await fetchSettings()
        setSettings(nextSettings)
      } catch {
        setSettings(EMPTY_SETTINGS)
      }
      // Partial failures surface as a banner while the tables that *did* load
      // still render — a missing table must not look like lost data.
      const nextError = snapshot.errors.length ? snapshot.errors.join(' ') : null
      setError(nextError)
      writeSnapshotCache(userId, can.seeEveryone, {
        ...snapshot,
        claims: nextClaims,
        teams: nextTeams,
        shares: nextShares,
        settings: nextSettings,
        error: nextError,
      })
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

  // A manual admin sync writes the same new tender pool to every active member.
  // Debounce the insert burst into one role-aware refresh so an already-open
  // user dashboard receives the same total without multiplying network reads.
  useEffect(() => {
    const userId = session?.user.id
    if (!userId || can.seeEveryone) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const channel = supabase
      .channel(`rfp-counts:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rfps', filter: `user_id=eq.${userId}` },
        () => {
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => void refresh(), 750)
        },
      )
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [session?.user.id, can.seeEveryone, refresh])

  const saveLead = useCallback(
    async (draft: LeadDraft, existing: Lead | null) => {
      const saved = existing
        ? await updateLead(existing.id, draft, {
            statusChanged: existing.status !== draft.status,
          })
        : await createLead(draft)
      setLeads((current) => upsertInto(current, saved))
      toast.success('Lead saved')
    },
    [],
  )

  const removeLead = useCallback(async (id: string) => {
    await deleteLead(id)
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
        const saved = await updateLeadStatus(id, status)
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
        const saved = await updateRfpStatus(id, status)
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
      const saved = await dbSetRfpPipeline(id, inPipeline, current?.externalId ?? null)
      setRfps((list) => list.map((rfp) => (rfp.id === id ? saved : rfp)))
      if (inPipeline && current?.status === 'Watching') {
        const promoted = await updateRfpStatus(id, 'Preparing')
        setRfps((list) => list.map((rfp) => (rfp.id === id ? promoted : rfp)))
      }
      // Refreshed either way: taking one on adds a claim, handing it back
      // removes one, and both change what everyone else may take.
      setClaims(await fetchRfpClaims())
      toast.success(inPipeline ? 'Added to the pipeline' : 'Removed from the pipeline')
    } catch (cause) {
      if (cause instanceof RfpAlreadyClaimed) {
        // Someone took it between the page rendering and the click. Pull the
        // claims so the row updates to show who, rather than leaving a button
        // that will keep failing.
        setClaims(await fetchRfpClaims().catch(() => claims))
      }
      toast.error(message(cause))
    }
  }, [rfps, claims])

  const saveTenderAnalysis = useCallback(
    async (id: string, analysis: string, noticeText: string) => {
      const saved = await dbSaveTenderAnalysis(id, analysis, noticeText)
      setRfps((list) => list.map((rfp) => (rfp.id === id ? saved : rfp)))
    },
    [],
  )
  const saveTenderIntelligence = useCallback(
    async (id: string, fields: Parameters<typeof persistTenderIntelligence>[1]) => {
      const saved = await persistTenderIntelligence(id, fields)
      setRfps((list) => list.map((rfp) => (rfp.id === id ? saved : rfp)))
    },
    [],
  )
  const reassignRfp = useCallback(async (id: string, newOwner: string) => {
    await dbReassignRfp(id, newOwner)
    // A full reload rather than patching state: the move rewrites four tables,
    // can delete the new owner's duplicate copy, and changes what the reader
    // may see at all — an admin who reassigns their own row loses nothing, but
    // a member watching this happen does. Cheaper to re-read than to model it.
    await refresh()
  }, [refresh])

  const saveRfp = useCallback(async (draft: RfpDraft, existing: Rfp | null) => {
    const saved = existing
      ? await updateRfp(existing.id, draft, {
          statusChanged: existing.status !== draft.status,
        })
      : await createRfp(draft)
    setRfps((current) => upsertInto(current, saved))
    toast.success('RFP saved')
  }, [])

  const removeRfp = useCallback(async (id: string) => {
    await deleteRfp(id)
    setRfps((current) => current.filter((rfp) => rfp.id !== id))
    toast.success('RFP deleted')
  }, [])

  const importRfps = useCallback(async (drafts: RfpDraft[]) => {
    const created = await dbImportRfps(drafts)
    setRfps((current) => [...created, ...current])
    return created.length
  }, [])

  const setTenderDocument = useCallback(
    async (id: string, text: string, fileName: string) => {
      const saved = await dbSetTenderDocument(id, text, fileName)
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

    // Refresh through the same role-aware path as initial page load. Calling
    // listRfps directly here made an admin receive every member's physical copy
    // after a sync, undoing fetchAll's deduplication and inflating every RFP
    // figure until the next full reload.
    if (report.added > 0) await refresh()

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
  }, [refresh])

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

  const addTask = useCallback(async (draft: TaskDraft) => {
    const saved = await createTask(draft)
    setTasks((current) => [saved, ...current])
    toast.success('Task added')
  }, [])

  const toggleTask = useCallback(async (id: string, done: boolean) => {
    // Optimistic: a checkbox that lags behind the click feels broken.
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, done } : task)),
    )
    try {
      const saved = await setTaskDone(id, done)
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
    await deleteTask(id)
    setTasks((current) => current.filter((task) => task.id !== id))
  }, [])

  const saveDraftProposal = useCallback(
    async (
      rfpId: string,
      title: string,
      content: string,
      design: ProposalDesign | null = null,
    ) => {
      const saved = await dbSaveDraftProposal(rfpId, title, content, design)
      setProposals((current) => [saved, ...current])
      toast.success('Draft saved to this RFP')
    },
    [],
  )

  const uploadProposal = useCallback(
    async (rfpId: string, file: File, notes: string, content = '') => {
      const saved = await uploadSubmittedProposal(rfpId, file, notes, content)
      setProposals((current) => [saved, ...current])
      toast.success(`${saved.fileName} uploaded`)
    },
    [],
  )

  const saveConsultant = useCallback(
    async (draft: ConsultantDraft, existing: Consultant | null) => {
      const saved = existing
        ? await updateConsultant(existing.id, draft)
        : await createConsultant(draft)
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
            ? await setConsultantPhoto(consultant.id, file)
            : await setConsultantCv(consultant.id, file)
          : await clearConsultantFile(consultant, kind)
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
    await deleteConsultant(id)
    setConsultants((current) => current.filter((person) => person.id !== id))
    toast.success('Consultant removed')
  }, [])

  const setProposalExemplar = useCallback(async (id: string, isExemplar: boolean) => {
    const saved = await dbSetProposalExemplar(id, isExemplar)
    setProposals((current) => current.map((item) => (item.id === id ? saved : item)))
    toast.success(isExemplar ? 'Marked as a model answer' : 'No longer an example')
  }, [])

  const addPastProposal = useCallback(
    async (rfpId: string, title: string, content: string) => {
      const saved = await savePastedProposal(rfpId, title, content)
      setProposals((current) => [saved, ...current])
      toast.success('Past proposal recorded')
    },
    [],
  )

  const saveSettings = useCallback(async (next: UserSettings) => {
    setSettings(await dbSaveSettings(next))
    toast.success('Guidance saved — it applies to the next draft')
  }, [])

  const removeProposal = useCallback(async (proposal: Proposal) => {
    await deleteProposal(proposal)
    setProposals((current) => current.filter((item) => item.id !== proposal.id))
    toast.success('Removed')
  }, [])

  const logActivity = useCallback(async (draft: ActivityDraft) => {
    const saved = await createActivity(draft)
    // Newest first, matching the order fetchAll returns.
    setActivities((current) => [saved, ...current])
    toast.success(`${saved.type} logged`)
  }, [])

  const removeActivity = useCallback(async (id: string) => {
    await deleteActivity(id)
    setActivities((current) => current.filter((activity) => activity.id !== id))
  }, [])

  const saveCallReport = useCallback(
    async (id: string, fields: CallReportFields) => {
      const saved = await dbSaveCallReport(id, fields)
      setActivities((current) =>
        current.map((activity) => (activity.id === id ? saved : activity)),
      )
    },
    [],
  )

  const saveReport = useCallback(async (draft: WeeklyReportDraft) => {
    const saved = await saveWeeklyReport(draft)
    setReports((current) => upsertInto(current, saved))
  }, [])

  const shareRfpWith = useCallback(
    async (
      rfpId: string,
      subject: { kind: 'member'; id: string } | { kind: 'team'; id: string },
    ) => {
      const saved = await dbShareRfp(rfpId, subject)
      setShares((current) => [...current, saved])
    },
    [],
  )

  const revokeRfpShare = useCallback(async (shareId: string) => {
    await dbRevokeShare(shareId)
    setShares((current) => current.filter((share) => share.id !== shareId))
  }, [])

  const createTeam = useCallback(async (name: string) => {
    const saved = await dbCreateTeam(name)
    setTeams((current) => [...current, saved].sort((a, b) => a.name.localeCompare(b.name)))
  }, [])

  const renameTeam = useCallback(async (id: string, name: string) => {
    await dbRenameTeam(id, name)
    setTeams((current) =>
      current
        .map((team) => (team.id === id ? { ...team, name: name.trim() } : team))
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
  }, [])

  const removeTeam = useCallback(async (id: string) => {
    await dbDeleteTeam(id)
    setTeams((current) => current.filter((team) => team.id !== id))
    // The database cascades these; dropping them here keeps the console from
    // showing a grant to a team that no longer exists until the next refresh.
    setShares((current) => current.filter((share) => share.teamId !== id))
  }, [])

  const setTeamMember = useCallback(
    async (teamId: string, userId: string, member: boolean) => {
      if (member) await dbAddTeamMember(teamId, userId)
      else await dbRemoveTeamMember(teamId, userId)
      setTeams((current) =>
        current.map((team) =>
          team.id !== teamId
            ? team
            : {
                ...team,
                memberIds: member
                  ? Array.from(new Set([...team.memberIds, userId]))
                  : team.memberIds.filter((id) => id !== userId),
              },
        ),
      )
    },
    [],
  )

  const value = useMemo<PipelineValue>(
    () => ({
      leads,
      rfps,
      // A map because every row in the tracker asks "is this one taken?" — a
      // linear scan per row turns the render quadratic on a few hundred rows.
      claims: new Map(claims.map((claim) => [claim.externalId, claim])),
      teams,
      // Grouped by tender for the same reason claims are mapped: the register
      // asks "is this one shared?" once per row.
      shares: groupSharesByRfp(shares),
      // Read off the grants themselves rather than inferred from "not mine".
      // For a standard user the two agree — a row they do not own can only
      // have arrived by a share — but for oversight they do not: an admin sees
      // every member's tenders by role, and calling those shared would both
      // mislabel them and, since this drives the read-only marking, take away
      // the editing 0028 deliberately granted.
      sharedWithMe: sharedWithMeFrom(shares, teams, session?.user.id),
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
      saveTenderIntelligence,
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
      shareRfpWith,
      revokeRfpShare,
      createTeam,
      renameTeam,
      removeTeam,
      setTeamMember,
    }),
    [
      leads,
      claims,
      teams,
      shares,
      session,
      shareRfpWith,
      revokeRfpShare,
      createTeam,
      renameTeam,
      removeTeam,
      setTeamMember,
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
      saveTenderIntelligence,
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
