import { supabase } from './client'
import type { AiAnalysis, RfpDocument } from '@/domain/types'
import { unwrap } from './internal'

/**
 * Reading what the Python intelligence layer concluded.
 *
 * The console never calls that service. It writes to Postgres and this reads
 * from Postgres with the client the app already holds, which is what makes the
 * page independent of whether the service happens to be running: a stopped
 * analyser costs yesterday's reading, not today's page.
 *
 * There is no write path here for `ai_analysis` on purpose. Migration 0041
 * gives those tables no insert policy for an authenticated session, so an
 * insert from the browser is refused by the database rather than by a
 * convention in this file that somebody could forget.
 */

const DOCUMENT_BUCKET = 'tenders'
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024

/** What a tender document may be. Anything else is refused before upload. */
const DOCUMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'text/rtf',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
])

interface AnalysisRow {
  id: string
  rfp_id: string
  summary: string | null
  score: number | null
  win_probability: number | null
  recommendation: string | null
  keywords: unknown
  themes: unknown
  matched_capabilities: unknown
  requirements: unknown
  risks: unknown
  missing_information: unknown
  similar_bids: unknown
  reasons: unknown
  model_version: string | null
  source_kind: string | null
  created_at: string
}

interface DocumentRow {
  id: string
  rfp_id: string
  file_name: string | null
  file_path: string | null
  file_size: number | null
  mime_type: string | null
  kind: string | null
  extracted_text: string | null
  ai_summary: string | null
  uploaded_date: string
  created_at: string
}

/**
 * A jsonb array, or an empty one.
 *
 * Guarded rather than cast. These columns are written by a separate service in
 * a separate language, and a shape change there should degrade a panel rather
 * than throw inside a render.
 */
function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function toAnalysis(row: AnalysisRow): AiAnalysis {
  return {
    id: row.id,
    rfpId: row.rfp_id,
    summary: row.summary ?? '',
    score: row.score ?? 0,
    winProbability: row.win_probability ?? 0,
    recommendation: row.recommendation ?? '',
    keywords: list<string>(row.keywords),
    themes: list<string>(row.themes),
    matchedCapabilities: list<AiAnalysis['matchedCapabilities'][number]>(row.matched_capabilities),
    requirements: list<string>(row.requirements),
    risks: list<string>(row.risks),
    missingInformation: list<string>(row.missing_information),
    similarBids: list<AiAnalysis['similarBids'][number]>(row.similar_bids),
    reasons: list<string>(row.reasons),
    modelVersion: row.model_version ?? '',
    sourceKind: row.source_kind ?? '',
    createdAt: row.created_at,
  }
}

function toDocument(row: DocumentRow): RfpDocument {
  return {
    id: row.id,
    rfpId: row.rfp_id,
    fileName: row.file_name ?? '',
    filePath: row.file_path ?? '',
    fileSize: row.file_size,
    mimeType: row.mime_type ?? '',
    kind: row.kind ?? 'other',
    extractedText: row.extracted_text ?? '',
    aiSummary: row.ai_summary ?? '',
    uploadedDate: row.uploaded_date,
    createdAt: row.created_at,
  }
}

/**
 * The newest reading of one tender, or null.
 *
 * Newest rather than all of them: the table is append-only so a tender
 * re-analysed weekly accumulates rows, and the page wants the current answer.
 * The history is there for anyone comparing model versions, which is a
 * different question asked from a different place.
 */
export async function fetchLatestAnalysis(rfpId: string): Promise<AiAnalysis | null> {
  const { data, error } = await supabase
    .from('ai_analysis')
    .select('*')
    .eq('rfp_id', rfpId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // A missing table is not an error worth showing. The Python layer is
  // optional and may not have been installed on this deployment, and a tender
  // page that refuses to render because of that would be a worse failure than
  // the missing panel it is meant to report.
  if (error) {
    if (error.code === '42P01' || error.message.includes('does not exist')) return null
    throw new Error(`Could not read the AI analysis: ${error.message}`)
  }
  return data ? toAnalysis(data as AnalysisRow) : null
}

export async function fetchRfpDocuments(rfpId: string): Promise<RfpDocument[]> {
  const { data, error } = await supabase
    .from('rfp_documents')
    .select('*')
    .eq('rfp_id', rfpId)
    .order('created_at', { ascending: true })

  if (error) {
    if (error.code === '42P01' || error.message.includes('does not exist')) return []
    throw new Error(`Could not read the tender documents: ${error.message}`)
  }
  return (data as DocumentRow[]).map(toDocument)
}

/**
 * Who an uploaded document must belong to.
 *
 * The tender's owner, not the uploader. Oversight may attach a TOR to a
 * member's bid, and a file filed under the admin sits in a folder the member's
 * own storage policy hides from them — help they cannot open. Same rule as
 * proposals; see migration 0029.
 */
async function documentOwner(rfpId: string): Promise<string> {
  const { data } = await supabase.from('rfps').select('user_id').eq('id', rfpId).maybeSingle()
  if (!data?.user_id) throw new Error('That tender could not be found.')
  return data.user_id as string
}

/**
 * What kind of document this is, guessed from its name for the `kind` column.
 *
 * Separators are normalised to spaces first. `\b` does not fire between an
 * underscore and a letter — both are word characters — so `\btor\b` missed
 * `CARKAP_TOR.pdf`, and underscore-separated names are the common case rather
 * than the exception. Kept in step with `classify` in pdf_processor.py, which
 * had the same bug.
 */
export function documentKind(fileName: string): string {
  const name = fileName.toLowerCase().replace(/[_\-.]+/g, ' ')
  if (/\b(tor|terms of reference)\b/.test(name)) return 'tor'
  if (/\b(rfp|rfq|itb|request for proposals?|invitation to bid)\b/.test(name)) return 'rfp'
  if (/\b(evaluation|scoring|criteria)\b/.test(name)) return 'evaluation'
  if (/\b(annex|appendix|attachment|schedule)\b/.test(name)) return 'annex'
  return 'other'
}

/**
 * Stores a tender document and records it against the tender.
 *
 * The file goes up first and the row second, so a failed upload leaves no row
 * pointing at nothing. The reverse order leaves the documents list showing a
 * file that cannot be opened, which is the failure people report as "the
 * download is broken".
 *
 * `extractedText` is optional and usually supplied: the console already runs
 * an uploaded PDF through layout-aware OCR, and passing that text here saves
 * the Python layer re-reading a file it would extract less well.
 */
export async function uploadRfpDocument(
  rfpId: string,
  file: File,
  extractedText = '',
): Promise<RfpDocument> {
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new Error('Tender documents are limited to 25 MB.')
  }
  if (file.type && !DOCUMENT_TYPES.has(file.type)) {
    throw new Error(`${file.type} is not a document type this stores.`)
  }

  const owner = await documentOwner(rfpId)
  const extension = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
  const path = `${owner}/${rfpId}/${crypto.randomUUID()}.${extension}`

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(path, file, { contentType: file.type || 'application/octet-stream' })
  if (uploadError) throw new Error(`Could not upload ${file.name}: ${uploadError.message}`)

  try {
    const row = unwrap(
      await supabase
        .from('rfp_documents')
        .insert({
          rfp_id: rfpId,
          user_id: owner,
          file_name: file.name,
          file_path: path,
          file_size: file.size,
          mime_type: file.type || '',
          kind: documentKind(file.name),
          extracted_text: extractedText,
        })
        .select()
        .single(),
    )
    return toDocument(row as DocumentRow)
  } catch (cause) {
    // The row failed, so the object is an orphan nobody will ever find. Tidied
    // up here rather than left in the bucket accruing storage cost for a file
    // no record points at.
    await supabase.storage.from(DOCUMENT_BUCKET).remove([path])
    throw cause
  }
}

/** A signed URL for one document. Short-lived: the bucket is private. */
export async function rfpDocumentUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(filePath, 60 * 10)
  if (error || !data?.signedUrl) {
    throw new Error(`Could not open the document: ${error?.message ?? 'no URL returned'}`)
  }
  return data.signedUrl
}

export async function deleteRfpDocument(document: RfpDocument): Promise<void> {
  // Row first here, and deliberately the other way round from upload. A
  // deleted file with a surviving row is a broken link; a deleted row with a
  // surviving file is a few kilobytes nobody sees. The second is the better
  // failure to be left with.
  const { error } = await supabase.from('rfp_documents').delete().eq('id', document.id)
  if (error) throw new Error(`Could not remove the document: ${error.message}`)
  if (document.filePath) {
    await supabase.storage.from(DOCUMENT_BUCKET).remove([document.filePath])
  }
}
