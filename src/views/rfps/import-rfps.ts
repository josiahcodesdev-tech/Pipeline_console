import type { RfpDraft } from '@/lib/db'
import { isSegment } from '@/lib/types'

export interface ImportResult {
  drafts: RfpDraft[]
  /** Human-readable reasons rows were dropped, so nothing fails silently. */
  skipped: string[]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Accepts `500000`, `"500000"` and `"500,000"`; anything else becomes null. */
function money(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const cleaned = value.replace(/[,\s]/g, '')
    if (!cleaned) return null
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Only `YYYY-MM-DD` survives — a bad date would silently break deadline sorting. */
function isoDate(value: unknown): string {
  const raw = text(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''
}

/**
 * Parses the pasted JSON list of sourced RFPs. Returns per-row reasons rather
 * than throwing on the first bad entry, so one malformed record does not cost
 * the user the whole paste.
 */
export function parseRfpImport(raw: string): ImportResult {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Paste RFP JSON first')

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error('Invalid JSON — check the format')
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Expected a JSON array of RFPs')
  }

  const drafts: RfpDraft[] = []
  const skipped: string[] = []

  parsed.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      skipped.push(`Row ${index + 1}: not an object`)
      return
    }
    const item = entry as Record<string, unknown>
    const title = text(item.title)
    if (!title) {
      skipped.push(`Row ${index + 1}: missing "title"`)
      return
    }

    drafts.push({
      title,
      org: text(item.org),
      segment: isSegment(item.segment) ? item.segment : 'Government',
      deadline: isoDate(item.deadline),
      value: money(item.value),
      // Imported rows always start as Watching — nothing has been decided yet.
      status: 'Watching',
      link: text(item.link),
      notes: text(item.notes),
      source: text(item.source) || 'Imported',
      opportunityType: 'rfp',
      kenya: false,
      serviceAreas: '',

      // Pasted JSON carries no tender document; one is attached later on the profile.

      tenderText: '',

      tenderFileName: '',

      // Hand-pasted rows are not scored — the ranking exists to sort what the

      // sync brought in, and someone who typed a row in already judged it.

      fitScore: 0,
    })
  })

  return { drafts, skipped }
}
