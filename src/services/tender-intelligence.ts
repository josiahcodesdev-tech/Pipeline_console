import { supabase } from '@/data/client'

/**
 * The work itself, as the tender describes it.
 *
 * Separate from `metadata`, which is the contract's paperwork — who is buying,
 * by when, for how much. This is what the proposal has to be *about*, and it
 * exists because the designed template asks for it: a stat card wants
 * "18 working days", an executive summary wants the buyer's stated problem in
 * the buyer's own words, a methodology page wants the areas the work covers.
 *
 * Every field is null or empty where the tender does not state it. That is the
 * point: an unstated figure becomes a visible placeholder rather than a
 * plausible invention.
 */
export interface TenderAssignment {
  /** The client's stated problem, in the client's words. */
  problem: string | null
  /** Stated objectives, as written. */
  objectives: string[]
  /** Thematic or technical areas the work must cover. */
  scope: string[]
  /** Who is trained, served or targeted — roles and organisations. */
  participants: string | null
  /** Only where the tender states a number. */
  participantCount: number | null
  /** Working days, only where stated as days. */
  durationDays: number | null
  /** In-person, virtual, blended, residential — as stated. */
  deliveryMode: string | null
  /** Where delivery happens. */
  locations: string[]
  /** Stated expected results and success measures. */
  outcomes: string[]
  /** The buyer's own terms of art, worth reusing verbatim. */
  terminology: string[]
}

export interface TenderAnalysis {
  summary: string
  /**
   * Optional in the type, required in the schema.
   *
   * Every fresh analysis has it. Analyses stored before this field existed do
   * not, and `analysisMarkdown` is run over stored JSON as well as fresh —
   * marking it optional is what stops an old record from crashing the page that
   * displays it.
   */
  assignment?: TenderAssignment
  metadata: Record<string, string | null>
  evaluation: Array<{ criterion: string; weight: number | null; evidence: string; source: string }>
  deliverables: Array<{ name: string; format: string | null; due: string | null; source: string }>
  requirements: Array<{ id: string; verbatim: string; strength: string; category: string; timing: string | null; source: string; evidenceAvailable: boolean; gapAction: string | null }>
  gaps: Array<{ requirementIds: string[]; severity: string; description: string; action: string }>
}

/**
 * The useful half of a failed Edge Function call.
 *
 * A non-2xx arrives as a FunctionsHttpError whose `message` is the bare string
 * "Edge Function returned a non-2xx status code" — the same sentence whether
 * the key is missing, the quota is spent or the PDF was rejected. Everything
 * that distinguishes them is in the response body hanging off `context`.
 *
 * The same helper exists in data/members.ts and services/concept-note.ts; this
 * is the third copy and worth folding into one shared module next time any of
 * them is touched.
 */
async function functionError(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown })?.context
  if (!(context instanceof Response)) return null
  try {
    const body = (await context.json()) as { error?: string }
    return body?.error ?? null
  } catch {
    return null
  }
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>('tender-intelligence', { body })
  if (error) {
    const detail = await functionError(error)
    throw new Error(
      detail ??
        `The tender intelligence service failed (${error.message}). Check that tender-intelligence is deployed and its keys are set.`,
    )
  }
  if (data?.error) throw new Error(data.error)
  if (!data) throw new Error('The tender intelligence service returned no data.')
  return data
}

function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(file)
  })
}

export async function ingestTender(file: File) {
  return ingestDocument(file, 'tender')
}

export async function ingestProposal(file: File) {
  return ingestDocument(file, 'proposal')
}

async function ingestDocument(file: File, purpose: 'tender' | 'proposal') {
  // `truncated` is set when the transcription hit its output ceiling. It is the
  // one failure here that does not look like one — the markdown reads as a
  // complete document and is simply missing its tail, which is where a tender
  // keeps its submission requirements. Optional because only the Claude path
  // reports it; the OpenAI path for Office formats does not.
  return invoke<{ provider: string; model: string; pages: number; markdown: string; tables: unknown[]; paragraphs: unknown[]; truncated?: boolean }>({ action:'ingest', purpose, base64:await base64(file), fileName:file.name, mimeType:file.type })
}

export async function analyzeTender(text: string, knowledge: string, url = '') {
  return invoke<{ analysis: TenderAnalysis; noticeText: string; noticeProblem: string | null }>({ action:'analyze', text, knowledge, url })
}

export async function enrichTender(input: { reference?: string | null; exactPhrase: string; client: string }) {
  return invoke<{ queries: string[]; results: Array<{ query:string; title:string; url:string; content:string; score:number }> }>({ action:'enrich', ...input })
}

export async function indexKnowledge(input: { sourceType: string; sourceId: string; title: string; content: string }) {
  return invoke<{ indexed: number }>({ action:'index', ...input })
}

export async function retrieveKnowledge(query: string, limit = 12) {
  return invoke<{ matches: Array<{ source_type:string; source_id:string; title:string; content:string; metadata:Record<string,unknown>; similarity:number }> }>({ action:'retrieve', query, limit })
}

/** A list as a bulleted block, or a line saying the tender did not say. */
function listBlock(heading: string, items: string[] | undefined): string[] {
  if (!items || items.length === 0) return [`**${heading}:** Not stated`]
  return [`**${heading}:**`, '', ...items.map((item) => `- ${item}`), '']
}

export function analysisMarkdown(value: TenderAnalysis): string {
  const lines = [`## What this assignment is`, '', value.summary, '']

  // Before the paperwork, because this is what the proposal is about and the
  // paperwork is what surrounds it. Omitted entirely for analyses stored before
  // this section existed — an empty heading reads as "the tender said nothing",
  // which is a different and more damaging claim than "this was not asked".
  const work = value.assignment
  if (work) {
    lines.push(
      '## The work itself',
      '',
      `**The client's stated problem:** ${work.problem ?? 'Not stated'}`,
      '',
      ...listBlock('Stated objectives', work.objectives),
      '',
      ...listBlock('Areas the work must cover', work.scope),
      '',
      `**Who it is for:** ${work.participants ?? 'Not stated'}${work.participantCount === null ? '' : ` (${work.participantCount} stated)`}`,
      '',
      `**Duration:** ${work.durationDays === null ? 'Not stated in days' : `${work.durationDays} working days`}`,
      '',
      `**Delivery mode:** ${work.deliveryMode ?? 'Not stated'}`,
      '',
      `**Where:** ${work.locations.length > 0 ? work.locations.join(', ') : 'Not stated'}`,
      '',
      ...listBlock('Expected results', work.outcomes),
      '',
      // Listed rather than described. A proposal that answers in the buyer's
      // vocabulary scores better than one that paraphrases it into ours, and
      // these are the words the drafter should be reaching for.
      ...listBlock("The buyer's own terms, to reuse verbatim", work.terminology),
      '',
    )
  }

  lines.push('## Key facts', '', '| Item | Value |', '|---|---|')
  for (const [key, item] of Object.entries(value.metadata)) lines.push(`| ${key.replace(/([A-Z])/g, ' $1')} | ${item ?? 'Not stated'} |`)
  lines.push('', '## Evaluation matrix', '', '| Criterion | Weight / points | Evidence | Source |', '|---|---:|---|---|')
  for (const row of value.evaluation) lines.push(`| ${row.criterion} | ${row.weight ?? 'Not stated'} | ${row.evidence} | ${row.source} |`)
  lines.push('', '## Deliverables', '', '| Deliverable | Format | Due | Source |', '|---|---|---|---|')
  for (const row of value.deliverables) lines.push(`| ${row.name} | ${row.format ?? 'Not stated'} | ${row.due ?? 'Not stated'} | ${row.source} |`)
  lines.push('', '## Requirements traceability matrix', '', '| ID | Requirement | Strength | Category | Source | Evidence | Gap / action |', '|---|---|---|---|---|---|---|')
  for (const row of value.requirements) lines.push(`| ${row.id} | ${row.verbatim} | ${row.strength} | ${row.category} | ${row.source} | ${row.evidenceAvailable ? 'Available' : 'Missing'} | ${row.gapAction ?? ''} |`)
  lines.push('', '## Gap analysis')
  for (const gap of value.gaps) lines.push(`- **${gap.severity} (${gap.requirementIds.join(', ') || 'general'}):** ${gap.description} — ${gap.action}`)
  return lines.join('\n')
}
