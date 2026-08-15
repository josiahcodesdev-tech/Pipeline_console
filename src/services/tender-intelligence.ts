import { supabase } from '@/data/client'

export interface TenderAnalysis {
  summary: string
  metadata: Record<string, string | null>
  evaluation: Array<{ criterion: string; weight: number | null; evidence: string; source: string }>
  deliverables: Array<{ name: string; format: string | null; due: string | null; source: string }>
  requirements: Array<{ id: string; verbatim: string; strength: string; category: string; timing: string | null; source: string; evidenceAvailable: boolean; gapAction: string | null }>
  gaps: Array<{ requirementIds: string[]; severity: string; description: string; action: string }>
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>('tender-intelligence', { body })
  if (error) throw new Error(error.message)
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
  return invoke<{ provider: string; model: string; pages: number; markdown: string; tables: unknown[]; paragraphs: unknown[] }>({ action:'ingest', base64:await base64(file), fileName:file.name, mimeType:file.type })
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

export function analysisMarkdown(value: TenderAnalysis): string {
  const lines = [`## What this assignment is`, '', value.summary, '', '## Key facts', '', '| Item | Value |', '|---|---|']
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
