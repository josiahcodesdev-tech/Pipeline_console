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
 * PostgREST's code for "table not in the schema cache" — in practice, a
 * migration that has not been run yet.
 */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01'
}

/**
 * Loads one table, degrading to an empty list rather than throwing.
 *
 * This used to be a single `Promise.all` where any failure threw, which meant
 * one unmigrated table blanked the entire console — indistinguishable from
 * data loss, and alarming for exactly the wrong reason. A table that cannot be
 * read should cost you that table, not the whole dataset.
 */
async function loadTable<Row, T>(
  name: string,
  query: PromiseLike<{ data: Row[] | null; error: { message: string; code?: string } | null }>,
  map: (row: Row) => T,
  hint: string,
): Promise<{ rows: T[]; error: string | null }> {
  try {
    const result = await query
    if (result.error) {
      return {
        rows: [],
        error: isMissingTable(result.error)
          ? `The "${name}" table does not exist yet — run ${hint}. Everything else still loaded.`
          : `Could not load ${name}: ${result.error.message}`,
      }
    }
    return { rows: (result.data ?? []).map(map), error: null }
  } catch (cause) {
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
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(order, { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as Row[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

/**
 * Collapses every member's copy of a tender down to one row.
 *
 * Scraped opportunities are stored per member, so an admin reading across the
 * firm gets the same tender once per member — five copies of each with five
 * accounts. The tracker should show an opportunity once.
 *
 * The copy that is in somebody's pipeline wins, so the admin sees the live
 * state rather than an untouched duplicate of a tender already being bid.
 * Hand-added RFPs are keyed by their own id: two members each entering one by
 * hand really are two records, not a duplicate.
 */
function onePerTender(rfps: Rfp[]): Rfp[] {
  const byTender = new Map<string, Rfp>()
  for (const rfp of rfps) {
    const key = rfp.externalId ?? `own:${rfp.id}`
    const held = byTender.get(key)
    if (!held || (rfp.inPipeline && !held.inPipeline)) byTender.set(key, rfp)
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
    // Reports and consultants stay the reader's own: a weekly report is a
    // personal submission, and the consultant roster is per-account by design.
    const [reports, consultants] = await Promise.all([
      loadTable(
        'weekly_reports',
        supabase.from('weekly_reports').select('*').eq('user_id', mine).order('week_start', { ascending: false }),
        toWeeklyReport,
        'migration 0001',
      ),
      loadTable(
        'consultants',
        supabase.from('consultants').select('*').eq('user_id', mine).order('name', { ascending: true }),
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
      supabase
        .from('rfps')
        .select('*').eq('user_id', mine)
        // Newest first — the views sort too, but this keeps the raw
        // snapshot in the same order they present.
        .order('created_at', { ascending: false }),
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
      supabase.from('proposals').select('*').eq('user_id', mine).order('created_at', { ascending: false }),
      toProposal,
      'migration 0007',
    ),
    loadTable(
      'consultants',
      supabase.from('consultants').select('*').eq('user_id', mine).order('name', { ascending: true }),
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
