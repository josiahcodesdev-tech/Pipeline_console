import { supabase } from '@/data/client'

/**
 * Client for the opportunity sync.
 *
 * There is no feed-fetching here any more. The console used to call the
 * CareerCraft endpoint straight from the browser, which only worked because
 * that one service sent `Access-Control-Allow-Origin: *`. The sources it reads
 * now — World Bank, UNDP, UNGM, IUCN, AfDB, NGO Jobs in Africa, ReliefWeb —
 * send no such header and could not be reached from a page even if we wanted
 * to, and the 5am scheduled run has no browser in it at all.
 *
 * So all of it lives in the `sync-opportunities` Edge Function, and this just
 * asks it to run. The function writes the rows itself; the caller reloads the
 * tracker afterwards to see them.
 *
 * See supabase/functions/sync-opportunities/ for the connectors.
 */

/** What one run of the sync did. Mirrors the function's JSON response. */
export interface SyncReport {
  /** Relevant notices the sources returned, after filtering and dedup. */
  fetched: number
  /** Distinct opportunities newly visible to the admin who ran the sync. */
  added: number
  /** Rows already held, left untouched so local edits survive. */
  alreadyHave: number
  /** Sources that failed or are unconfigured, as readable one-liners. */
  skipped: string[]
  /** Per-source detail, for the status panel. */
  sources: SourceStatus[]
}

export interface SourceStatus {
  name: string
  status: 'ok' | 'failed' | 'skipped'
  count: number
  detail?: string
}

/**
 * Runs a firm-wide sync for every active member.
 *
 * `functions.invoke` attaches the user's access token, which proves the caller
 * is an admin. Both this path and the scheduled service-role path update every
 * active member, keeping their tender totals aligned.
 */
export async function runOpportunitySync(): Promise<SyncReport> {
  const { data, error } = await supabase.functions.invoke<
    Partial<SyncReport> & { error?: string }
  >('sync-opportunities', { body: {} })

  if (error) {
    // FunctionsHttpError carries the response, and the function puts a readable
    // reason in it — worth digging out, since "non-2xx status code" alone tells
    // the user nothing about which source broke.
    const detail = await readFunctionError(error)
    throw new Error(detail ?? 'Could not reach the opportunity sync. Please try again.')
  }
  if (!data) throw new Error('The opportunity sync returned nothing.')
  if (data.error) throw new Error(data.error)

  return {
    fetched: data.fetched ?? 0,
    added: data.added ?? 0,
    alreadyHave: data.alreadyHave ?? 0,
    skipped: data.skipped ?? [],
    sources: data.sources ?? [],
  }
}

/** Pulls the function's own error message out of a failed invoke. */
async function readFunctionError(error: unknown): Promise<string | null> {
  const response = (error as { context?: unknown })?.context
  if (!(response instanceof Response)) {
    return error instanceof Error ? error.message : null
  }
  try {
    const body: unknown = await response.json()
    const message = (body as { error?: unknown })?.error
    if (typeof message === 'string' && message.trim()) return message
  } catch {
    // Body was not JSON — fall through to the generic message.
  }
  return null
}
