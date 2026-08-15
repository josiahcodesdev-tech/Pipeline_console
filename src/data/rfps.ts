import { supabase } from './client'
import { today } from '@/domain/dates'
import type { Rfp, RfpClaim, RfpStatus } from '@/domain/types'
import { unwrap, currentUserId, type RfpDraft } from './internal'
import { toRfp, rfpFields } from './mappers'

export type { RfpDraft }

// ---------------------------------------------------------------- rfps -----

export async function createRfp(draft: RfpDraft): Promise<Rfp> {
  const stamp = today()
  const row = unwrap(
    await supabase
      .from('rfps')
      .insert({
        ...rfpFields(draft),
        user_id: await currentUserId(),
        sourced: false,
        created_on: stamp,
        status_updated_on: stamp,
      })
      .select()
      .single(),
  )
  return toRfp(row)
}

export async function updateRfp(
  id: string,
  draft: RfpDraft,
  { statusChanged }: { statusChanged: boolean },
): Promise<Rfp> {
  const row = unwrap(
    await supabase
      .from('rfps')
      .update({
        ...rfpFields(draft),
        ...(statusChanged ? { status_updated_on: today() } : {}),
      })
      .eq('id', id)
      .select()
      .single(),
  )
  return toRfp(row)
}

/** Moves an RFP's status without touching anything else. */
export async function updateRfpStatus(
  id: string,
  status: RfpStatus,
): Promise<Rfp> {
  const row = unwrap(
    await supabase
      .from('rfps')
      .update({ status, status_updated_on: today() })
      .eq('id', id)
      .select()
      .single(),
  )
  return toRfp(row)
}

/** Takes an RFP into, or out of, the live proposal pipeline. */
/**
 * Raised when a tender was taken by someone else between the list rendering
 * and the button being pressed. Carries the winner so the message can name
 * them rather than just refusing.
 */
export class RfpAlreadyClaimed extends Error {
  // Assigned in the body rather than declared as a constructor parameter
  // property: the project compiles with `erasableSyntaxOnly`, which rejects
  // any TypeScript that has to emit code rather than just be stripped.
  claimedBy: string | null

  constructor(claimedBy: string | null) {
    super('Another member has already taken this tender.')
    this.name = 'RfpAlreadyClaimed'
    this.claimedBy = claimedBy
  }
}

export async function fetchRfpClaims(): Promise<RfpClaim[]> {
  const { data, error } = await supabase
    .from('rfp_claims')
    .select('external_id, claimed_by, claimed_at, title')
  if (error) throw new Error(`Could not load who has taken what: ${error.message}`)
  return (data ?? []).map((row) => ({
    externalId: row.external_id,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    title: row.title,
  }))
}

/**
 * Takes a tender on, or hands it back.
 *
 * The claim is written before the local flag, and deliberately not in a
 * transaction with it — there is no cross-table transaction available from the
 * client, so the order is chosen to fail safe. Claim first: if someone else has
 * it, the primary key refuses and nothing local has changed. Doing it the other
 * way round would show the tender in your pipeline for the moment before the
 * refusal arrived.
 *
 * Hand-added RFPs have no external id and so no claim — nobody else can see
 * them to take.
 */
/**
 * Hands a tender and everything attached to it to another member.
 *
 * One RPC rather than four writes from here, because the tender, its proposals,
 * its activities and the firm-wide claim have to agree afterwards — see
 * migration 0028. Admin and super user only, enforced in the function.
 */
export async function reassignRfp(id: string, newOwner: string): Promise<void> {
  const { error } = await supabase.rpc('reassign_rfp', {
    target: id,
    new_owner: newOwner,
  })
  if (error) throw new Error(`Could not reassign this tender: ${error.message}`)
}

export async function setRfpPipeline(
  id: string,
  inPipeline: boolean,
  externalId: string | null,
): Promise<Rfp> {
  const userId = await currentUserId()

  if (externalId && inPipeline) {
    const { error } = await supabase
      .from('rfp_claims')
      .insert({ external_id: externalId, claimed_by: userId, title: '' })

    // 23505 is a unique-violation: the tender already has a claim. Anything
    // else is a real failure and should not read as "someone beat you to it".
    if (error) {
      if (error.code !== '23505') {
        throw new Error(`Could not take this tender on: ${error.message}`)
      }
      const { data } = await supabase
        .from('rfp_claims')
        .select('claimed_by')
        .eq('external_id', externalId)
        .maybeSingle()
      throw new RfpAlreadyClaimed(data?.claimed_by ?? null)
    }
  }

  if (externalId && !inPipeline) {
    // Matched on the tender alone, and left to row-level security to decide
    // whose claim may go: a member's delete matches only their own, an admin's
    // matches anyone's. Filtering on `claimed_by` here as well used to look
    // like belt and braces, but it quietly broke oversight — an admin taking a
    // colleague's abandoned bid out of the pipeline cleared the flag and left
    // the claim behind, so the tender was in nobody's pipeline and still
    // unclaimable by anyone.
    const { error } = await supabase
      .from('rfp_claims')
      .delete()
      .eq('external_id', externalId)
    if (error) throw new Error(`Could not hand this tender back: ${error.message}`)
  }

  // `maybeSingle`, not `single`. Row-level security scopes an update to your
  // own rows, so acting on another member's copy matches nothing and updates
  // nothing — and `single` turns that into "Cannot coerce the result to a
  // single JSON object", which tells the reader nothing about what went wrong
  // or what to do. An admin reading the whole firm's pipeline hits this the
  // moment they try to tidy somebody else's row.
  const { data, error } = await supabase
    .from('rfps')
    .update({ in_pipeline: inPipeline })
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) {
    throw new Error(
      inPipeline
        ? 'This tender belongs to another member, so it cannot be added to your pipeline.'
        : 'This proposal belongs to another member. Only they can take it out of the pipeline.',
    )
  }
  return toRfp(data)
}

/**
 * Attaches (or clears) the tender document text on an RFP.
 *
 * Its own call rather than a field on the edit dialog's draft: the text runs to
 * tens of thousands of characters, and pushing that through every unrelated
 * save — a status change, a note — would be wasteful and would risk one stale
 * copy of the form wiping a document someone else had just attached.
 */
export async function setTenderDocument(
  id: string,
  text: string,
  fileName: string,
): Promise<Rfp> {
  const row = unwrap(
    await supabase
      .from('rfps')
      .update({ tender_text: text, tender_file_name: fileName })
      .eq('id', id)
      .select()
      .single(),
  )
  return toRfp(row)
}

export async function deleteRfp(id: string): Promise<void> {
  const { error } = await supabase.from('rfps').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Bulk insert from the JSON importer. Every imported RFP starts as Watching. */
export async function importRfps(drafts: RfpDraft[]): Promise<Rfp[]> {
  if (drafts.length === 0) return []
  const stamp = today()
  const userId = await currentUserId()
  const rows = unwrap(
    await supabase
      .from('rfps')
      .insert(
        drafts.map((draft) => ({
          ...rfpFields(draft),
          user_id: userId,
          sourced: true,
          external_id: null,
          created_on: stamp,
          status_updated_on: stamp,
        })),
      )
      .select(),
  )
  return rows.map(toRfp)
}

/**
 * Re-reads every RFP for the current user.
 *
 * The opportunity sync writes its rows server-side in the Edge Function, so
 * after it runs the client has no idea what arrived — this is how the tracker
 * catches up. Deliberately a full re-read rather than a diff: the sync inserts
 * across several sources at once and a handful of rows is not worth the
 * bookkeeping of working out which.
 */
export async function listRfps(): Promise<Rfp[]> {
  const rows = unwrap(
    await supabase
      .from('rfps')
      .select('*')
      // Matches the order fetchAll returns, so a synced list and a freshly
      // loaded one present identically.
      .order('created_at', { ascending: false }),
  )
  return rows.map(toRfp)
}

/**
 * Stores the drafter's reading of a tender, and the notice it was read from.
 *
 * Kept rather than recomputed so it can be inspected and corrected before a
 * proposal is written against it — an understanding nobody can check is a guess
 * with better manners. `notice_text` is written alongside because the analysis
 * is only as good as its source, and a reader who doubts the reading needs to
 * see what was read.
 */
export async function saveTenderAnalysis(
  id: string,
  analysis: string,
  noticeText: string,
): Promise<Rfp> {
  const { data, error } = await supabase
    .from('rfps')
    .update({
      analysis,
      // Never blanked by a later run that could not reach the page: a stored
      // notice is worth more than an empty one from a portal having a bad day.
      ...(noticeText ? { notice_text: noticeText } : {}),
      analysed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) throw new Error(`Could not save the analysis: ${error.message}`)
  if (!data) {
    throw new Error('This tender belongs to another member, so its analysis cannot be saved.')
  }
  return toRfp(data)
}

/** Persists auditable machine-readable tender intelligence beside its review. */
export async function saveTenderIntelligence(
  id: string,
  fields: {
    tenderText?: string
    tenderFileName?: string
    ingestion?: Record<string, unknown>
    analysis?: string
    analysisJson?: Record<string, unknown>
    enrichment?: Record<string, unknown>
    noticeText?: string
  },
): Promise<Rfp> {
  const { data, error } = await supabase.from('rfps').update({
    ...(fields.tenderText !== undefined ? { tender_text: fields.tenderText } : {}),
    ...(fields.tenderFileName !== undefined ? { tender_file_name: fields.tenderFileName } : {}),
    ...(fields.ingestion !== undefined ? { ingestion: fields.ingestion } : {}),
    ...(fields.analysis !== undefined ? { analysis: fields.analysis, analysed_at: new Date().toISOString() } : {}),
    ...(fields.analysisJson !== undefined ? { analysis_json: fields.analysisJson } : {}),
    ...(fields.enrichment !== undefined ? { enrichment: fields.enrichment } : {}),
    ...(fields.noticeText ? { notice_text: fields.noticeText } : {}),
    intelligence_updated_at: new Date().toISOString(),
  }).eq('id', id).select().maybeSingle()
  if (error) throw new Error(`Could not save tender intelligence: ${error.message}`)
  if (!data) throw new Error('This tender belongs to another member and cannot be updated.')
  return toRfp(data)
}
