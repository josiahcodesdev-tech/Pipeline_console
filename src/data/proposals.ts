import { supabase } from './client'
import type { Proposal, ProposalDesign } from '@/domain/types'
import { unwrap, currentUserId } from './internal'
import { toProposal } from './mappers'

const PROPOSAL_BUCKET = 'proposals'
const MAX_PROPOSAL_BYTES = 25 * 1024 * 1024
const PROPOSAL_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'text/rtf',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
])

/** Marks a proposal as a worked example for future drafts. */
export async function setProposalExemplar(
  id: string,
  isExemplar: boolean,
): Promise<Proposal> {
  const row = unwrap(
    await supabase
      .from('proposals')
      .update({ is_exemplar: isExemplar })
      .eq('id', id)
      .select()
      .single(),
  )
  return toProposal(row)
}

/**
 * Who a proposal written against this tender must belong to.
 *
 * The tender's owner, not the writer: oversight may draft on a member's bid,
 * and a row owned by the admin is one the member's own select policy hides from
 * them — help they cannot read. Enforced server-side by proposals_insert; see
 * migration 0029. Falls back to the caller when the tender cannot be read,
 * which is the pre-0029 behaviour and still correct for one's own rows.
 */
async function proposalOwner(rfpId: string): Promise<string> {
  const { data } = await supabase
    .from('rfps')
    .select('user_id')
    .eq('id', rfpId)
    .maybeSingle()
  return data?.user_id ?? (await currentUserId())
}

/** Records a past proposal pasted in as text, so it can be used as an example. */
export async function savePastedProposal(
  rfpId: string,
  title: string,
  content: string,
): Promise<Proposal> {
  const row = unwrap(
    await supabase
      .from('proposals')
      .insert({
        user_id: await proposalOwner(rfpId),
        rfp_id: rfpId,
        kind: 'submitted',
        title,
        content,
        file_path: '',
        file_name: '',
        file_size: null,
        notes: '',
      })
      .select()
      .single(),
  )
  return toProposal(row)
}

/**
 * Saves a generated draft against an RFP so it survives closing the tab.
 *
 * `content` is the readable text either way — it is what the preview shows and
 * what a starred model answer teaches the drafter. `design` is present only for
 * a proposal written into the designed template, and holds the answers rather
 * than the document: see ProposalDesign and migration 0040.
 */
export async function saveDraftProposal(
  rfpId: string,
  title: string,
  content: string,
  design: ProposalDesign | null = null,
): Promise<Proposal> {
  const row = unwrap(
    await supabase
      .from('proposals')
      .insert({
        user_id: await proposalOwner(rfpId),
        rfp_id: rfpId,
        kind: 'draft',
        title,
        content,
        design: design ? (design as unknown as Record<string, unknown>) : {},
        file_path: '',
        file_name: '',
        file_size: null,
        notes: '',
      })
      .select()
      .single(),
  )
  return toProposal(row)
}

/**
 * Uploads the file that actually went to the buyer.
 *
 * The object path starts with the *tender owner's* uid, not the uploader's.
 * Storage policies compare that first segment to `auth.uid()`, which is what
 * keeps a submitted document private to its owner — and it is also why the
 * folder has to name the member rather than the admin attaching it for them. A
 * file filed under the admin is one the member cannot open. Migration 0029
 * grants admins write access to a member's folder for exactly this.
 */
export async function uploadSubmittedProposal(
  rfpId: string,
  file: File,
  notes: string,
  content = '',
): Promise<Proposal> {
  if (file.size > MAX_PROPOSAL_BYTES) throw new Error('That proposal is over 25 MB.')
  if (!PROPOSAL_TYPES.has(file.type)) {
    throw new Error('Use PDF, Word, OpenDocument, RTF, text, Office or ZIP format for a submitted proposal.')
  }
  const userId = await proposalOwner(rfpId)
  const extension = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
  const path = `${userId}/${rfpId}/${crypto.randomUUID()}.${extension}`

  const upload = await supabase.storage
    .from(PROPOSAL_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false })

  if (upload.error) throw new Error(`Upload failed: ${upload.error.message}`)

  try {
    const row = unwrap(
      await supabase
        .from('proposals')
        .insert({
          user_id: userId,
          rfp_id: rfpId,
          kind: 'submitted',
          title: file.name,
          content,
          file_path: path,
          file_name: file.name,
          file_size: file.size,
          notes,
        })
        .select()
        .single(),
    )
    return toProposal(row)
  } catch (cause) {
    // Don't strand an orphaned object in the bucket if the row insert fails.
    await supabase.storage.from(PROPOSAL_BUCKET).remove([path])
    throw cause
  }
}

/** Short-lived signed URL — the bucket is private, so there is no public path. */
export async function proposalFileUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PROPOSAL_BUCKET)
    .createSignedUrl(filePath, 60)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

export async function deleteProposal(proposal: Proposal): Promise<void> {
  const { error } = await supabase.from('proposals').update({
    archived_at: new Date().toISOString(),
    archived_by: await currentUserId(),
  }).eq('id', proposal.id)
  if (error) throw new Error(error.message)
}

export async function restoreProposal(id: string): Promise<void> {
  const { error } = await supabase.from('proposals').update({ archived_at: null, archived_by: null }).eq('id', id)
  if (error) throw new Error(error.message)
}
