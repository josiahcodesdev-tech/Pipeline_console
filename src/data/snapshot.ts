import { supabase } from './client'
import type {
  Activity,
  Consultant,
  Lead,
  Proposal,
  Rfp,
  Task,
  WeeklyReport,
} from '@/domain/types'
import { isActiveRfp } from '@/domain/metrics'
import type {
  ActivityRow,
  LeadRow,
  ProposalRow,
  RfpRow,
  TaskRow,
} from './database.types'
import { currentUserId } from './internal'
import {
  toActivity,
  toConsultant,
  toLead,
  toProposal,
  toRfp,
  toTask,
  toWeeklyReport,
} from './mappers'

// -------------------------------------------------------------- loading ----

export interface PipelineSnapshot {
  leads: Lead[]
  rfps: Rfp[]
  tasks: Task[]
  reports: WeeklyReport[]
  activities: Activity[]
  proposals: Proposal[]
  consultants: Consultant[]
  /** Per-table load failures. Empty when everything came back. */
  errors: string[]
}

/**
 * Thrown when the server refuses the session token.
 *
 * A class rather than a flag on the result, because this has to travel out past
 * `loadTable`'s own catch and past every caller that treats a failure as "lose
 * that table, keep the rest". This one is not survivable that way: there is no
 * partial dataset to keep.
 */
export class SessionRejected extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionRejected'
  }
}

/**
 * PostgREST's code for "table not in the schema cache" — in practice, a
 * migration that has not been run yet.
 */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01'
}

/**
 * The server has refused the session token itself.
 *
 * Distinct from an expired one, which `autoRefreshToken` handles without anyone
 * noticing. This is a token the server will not accept at all — the commonest
 * cause being clock skew, where the machine that minted it and the machine
 * validating it disagree about the time and the token reads as issued in the
 * future.
 *
 * It matters because it is unrecoverable from inside the app and looks like a
 * data problem from outside it. Every table fails at once, each reporting
 * "Could not load X: JWT issued at future", and no amount of reloading helps:
 * the same rejected token is in local storage and goes back out with the next
 * request. Only a fresh sign-in clears it.
 *
 * Matched on the message as well as the code, because PostgREST is not
 * consistent about which it uses for JWT faults across versions, and getting
 * this wrong leaves somebody stuck at a dead end.
 */
function isSessionRejected(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  // PGRST301 is PostgREST's own "JWT invalid". 42501 is NOT here on purpose:
  // that is `insufficient privilege`, an ordinary row-level-security refusal,
  // and signing somebody out because a policy declined them one table would be
  // a worse failure than the one this function exists to fix.
  if (error.code === 'PGRST301') return true

  const message = (error.message ?? '').toLowerCase()
  // `jws` as well as `jwt`: a rotated signing key comes back as
  // "JWSError JWSInvalidSignature", which mentions neither the word JWT nor a
  // code, and is exactly the case where a fresh sign-in is the only fix.
  if (!message.includes('jwt') && !message.includes('jws')) return false
  return (
    message.includes('future') ||
    message.includes('invalid') ||
    message.includes('expired') ||
    message.includes('malformed') ||
    message.includes('signature')
  )
}

/**
 * What to tell somebody whose session has been refused.
 *
 * One sentence on what happened and one on what to do. The server's own wording
 * is kept at the end because it is the only part that distinguishes a clock
 * problem from a rotated signing key, and whoever ends up debugging this will
 * want it.
 */
function sessionRejectedMessage(detail: string): string {
  return (
    'Your sign-in is no longer valid, so nothing could be loaded. ' +
    'Sign out and sign in again to fix it. ' +
    `(The server said: ${detail}.)`
  )
}

/**
 * Loads one table, degrading to an empty list rather than throwing.
 *
 * This used to be a single `Promise.all` where any failure threw, which meant
 * one unmigrated table blanked the entire console — indistinguishable from
 * data loss, and alarming for exactly the wrong reason. A table that cannot be
 * read should cost you that table, not the whole dataset.
 */
/** What every PostgREST call resolves to: rows or a reason, never both. */
type QueryResult<Row> = {
  data: Row[] | null
  error: { message: string; code?: string } | null
}

async function loadTable<Row, T>(
  name: string,
  query: PromiseLike<QueryResult<Row>>,
  map: (row: Row) => T,
  hint: string,
): Promise<{ rows: T[]; error: string | null }> {
  try {
    const result = await query
    if (result.error) {
      if (isSessionRejected(result.error)) {
        // Not per-table: every table is about to fail the same way, and the
        // reader needs the one instruction that fixes all of them rather than
        // nine copies of the same sentence.
        throw new SessionRejected(sessionRejectedMessage(result.error.message))
      }
      return {
        rows: [],
        error: isMissingTable(result.error)
          ? `The "${name}" table does not exist yet — run ${hint}. Everything else still loaded.`
          : `Could not load ${name}: ${result.error.message}`,
      }
    }
    return { rows: (result.data ?? []).map(map), error: null }
  } catch (cause) {
    if (cause instanceof SessionRejected) throw cause
    return {
      rows: [],
      error: `Could not load ${name}: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }
}

/** PostgREST stops at 1,000 rows a request, so anything larger is paged. */
const PAGE = 1000

/**
 * Reads a table in full, a page at a time.
 *
 * Only needed on the oversight path: a single member's working set is well
 * under the limit, but every member's copy of every tender is not — and a
 * truncated read is the worst kind, because it looks like a complete one.
 */
async function loadEveryPage<Row>(
  table: 'rfps' | 'leads' | 'activities' | 'proposals' | 'tasks',
  order: string,
): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from(table)
      .select('*')
      .order(order, { ascending: false })
      .range(from, from + PAGE - 1)
    if (table === 'proposals') query = query.is('archived_at', null)
    const { data, error } = await query
    if (error) throw new Error(error.message)
    const page = (data ?? []) as Row[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

/**
 * The same paging, shaped like a single query so `loadTable` can degrade it.
 *
 * A builder factory rather than a builder: a Supabase query is a thenable that
 * runs once, so each page needs its own. Errors are handed back rather than
 * thrown, which is what keeps a failure here costing one table instead of the
 * console.
 */
async function pagedQuery<Row>(
  build: (from: number, to: number) => PromiseLike<QueryResult<Row>>,
): Promise<QueryResult<Row>> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) return { data: null, error }
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE) return { data: rows, error: null }
  }
}

/**
 * Collapses every member's copy of a tender down to one row.
 *
 * Scraped opportunities are stored per member, so an admin reading across the
 * firm gets the same tender once per member — five copies of each with five
 * accounts. The tracker should show an opportunity once.
 *
 * The copy that is in somebody's pipeline wins, followed by an active copy.
 * Members can update their own copy's status independently; keeping whichever
 * row happened to arrive first made an active tender look Won/Lost on the
 * oversight dashboard and made its RFP total disagree with member dashboards.
 * Hand-added RFPs are keyed by their own id: two members each entering one by
 * hand really are two records, not a duplicate.
 */
function onePerTender(rfps: Rfp[]): Rfp[] {
  const byTender = new Map<string, Rfp>()
  for (const rfp of rfps) {
    const key = rfp.externalId ?? `own:${rfp.id}`
    const held = byTender.get(key)
    const priority = Number(rfp.inPipeline) * 2 + Number(isActiveRfp(rfp.status))
    const heldPriority = held
      ? Number(held.inPipeline) * 2 + Number(isActiveRfp(held.status))
      : -1
    if (!held || priority > heldPriority) byTender.set(key, rfp)
  }
  return [...byTender.values()]
}

/**
 * The working set for the signed-in member.
 *
 * Normally scoped to their own rows. An admin or the super user gets the whole
 * firm's instead — that is the point of the role, and without it the console
 * asked only for rows the reader owned, so an admin account that owns nothing
 * opened an empty tracker while row-level security would happily have shown
 * them everything.
 *
 * The breadth costs two things, both handled here: the read has to be paged
 * past PostgREST's 1,000-row limit, and the tenders have to be collapsed to one
 * row each or the tracker shows every member's copy.
 */
export async function fetchAll(seeEveryone = false): Promise<PipelineSnapshot> {
  const mine = await currentUserId()

  if (seeEveryone) {
    // The oversight read. Deliberately a separate path rather than a flag
    // threaded through the one below: it pages, it collapses tenders, and it
    // has different failure characteristics, and interleaving the two made
    // both harder to follow than writing them out.
    const [leads, rfps, tasks, activities, proposals] = await Promise.all([
      loadEveryPage<LeadRow>('leads', 'created_at'),
      loadEveryPage<RfpRow>('rfps', 'created_at'),
      loadEveryPage<TaskRow>('tasks', 'created_at'),
      loadEveryPage<ActivityRow>('activities', 'occurred_on'),
      loadEveryPage<ProposalRow>('proposals', 'created_at'),
    ])
    // A weekly report stays the reader's own — it is a personal submission.
    // The consultant roster does not: see the note on the query below.
    const [reports, consultants] = await Promise.all([
      loadTable(
        'weekly_reports',
        supabase.from('weekly_reports').select('*').eq('user_id', mine).order('week_start', { ascending: false }),
        toWeeklyReport,
        'migration 0001',
      ),
      loadTable(
        'consultants',
        // Every consultant, not the reader's own.
        //
        // The roster is one list for the firm: Dr. Benson Kiarie and the rest
        // are the people this business puts forward, named in proposals already
        // sent. Filtered to the reader, three of six members had none at all —
        // and the drafter is handed this list to staff a bid with, so those
        // three were drafting proposals that could name no team, with nothing
        // to say why.
        //
        // Migration 0044 opened the policy; this is the half that makes it
        // visible. Both were needed, and the policy alone changed nothing.
        supabase.from('consultants').select('*').order('name', { ascending: true }),
        toConsultant,
        'migration 0010',
      ),
    ])

    return {
      leads: leads.map(toLead),
      rfps: onePerTender(rfps.map(toRfp)),
      tasks: tasks.map(toTask),
      reports: reports.rows,
      activities: activities.map(toActivity),
      proposals: proposals.map(toProposal),
      consultants: consultants.rows,
      errors: [reports, consultants].flatMap((result) => result.error ?? []),
    }
  }

  const [leads, rfps, tasks, reports, activities, proposals, consultants] = await Promise.all([
    loadTable(
      'leads',
      supabase.from('leads').select('*').eq('user_id', mine).order('created_at', { ascending: false }),
      toLead,
      'migration 0001',
    ),
    loadTable(
      'rfps',
      // Paged, because this is the one table on the member path that can
      // outgrow a single request. The sync writes a copy of every scraped
      // tender to every member, so a member's own row count tracks the whole
      // pool and rises with it; unpaged, the day it passes a thousand the
      // console would quietly start showing a page of it as the total.
      pagedQuery<RfpRow>((from, to) =>
        supabase
          .from('rfps')
          // The one table here read without `.eq('user_id', mine)`, and the
          // omission is deliberate. Since migration 0039 a member can be
          // shared a colleague's tender, and the policy is what decides which
          // rows come back — own plus shared. Filtering to `mine` as well would
          // take the shared ones away again on the way out, which is a filter
          // the reader never asked for and cannot see.
          //
          // The reader may therefore hold two rows for one notice: their own
          // untouched copy from the sync, and the colleague's worked copy. Both
          // are labelled by owner in the register rather than collapsed,
          // because the shared one is the point — it carries the notes, the
          // reading and the draft that made it worth sharing.
          .select('*')
          // Newest first — the views sort too, but this keeps the raw
          // snapshot in the same order they present.
          .order('created_at', { ascending: false })
          .range(from, to),
      ),
      toRfp,
      'migration 0001',
    ),
    loadTable(
      'tasks',
      supabase
        .from('tasks')
        .select('*').eq('user_id', mine)
        .order('due', { ascending: true, nullsFirst: false }),
      toTask,
      'migration 0001',
    ),
    loadTable(
      'weekly reports',
      supabase
        .from('weekly_reports')
        .select('*').eq('user_id', mine)
        .order('week_start', { ascending: false }),
      toWeeklyReport,
      'migration 0001',
    ),
    loadTable(
      'activities',
      supabase
        .from('activities')
        .select('*').eq('user_id', mine)
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false }),
      toActivity,
      'migration 0003',
    ),
    loadTable(
      'proposals',
      supabase.from('proposals').select('*').eq('user_id', mine).is('archived_at', null).order('created_at', { ascending: false }),
      toProposal,
      'migration 0007',
    ),
    loadTable(
      'consultants',
      // Every consultant — the roster is firm-wide. See the oversight path above.
      supabase.from('consultants').select('*').order('name', { ascending: true }),
      toConsultant,
      'migration 0010',
    ),
  ])

  return {
    leads: leads.rows,
    rfps: rfps.rows,
    tasks: tasks.rows,
    reports: reports.rows,
    activities: activities.rows,
    proposals: proposals.rows,
    consultants: consultants.rows,
    errors: [leads, rfps, tasks, reports, activities, proposals, consultants]
      .map((result) => result.error)
      .filter((error): error is string => error !== null),
  }
}
