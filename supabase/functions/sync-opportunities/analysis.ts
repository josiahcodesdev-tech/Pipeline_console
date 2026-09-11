/**
 * The tender analysis, written by the run that already knows every tender.
 *
 * WHY THIS LIVES IN THE SYNC. `ai_analysis` is what the console's AI
 * intelligence tab reads, and until now it was written by a Python service
 * (ai_tender_intelligence/) that existed on one laptop and ran when somebody
 * typed the command. It scored every tender once in August and then went quiet
 * while this sync kept importing notices every morning, so every tender
 * imported afterwards showed "This tender has not been analysed yet" -- which
 * was true, and was the only honest thing the tab could say.
 *
 * The scoring it performed is the scoring that is already here. `scoreFit` and
 * `matchCapabilities` in normalize.ts decide, every morning, which notices are
 * worth importing and how well each fits; capability_profile.json on the Python
 * side was generated *from* this map. So the analyser was a port of this file's
 * neighbour, running somewhere else, on a schedule nobody kept. Writing the row
 * from here needs no host, no container and no second cron entry: it happens
 * inside the job that is already scheduled, over the rows it has just written.
 *
 * WHAT IT DOES NOT DO, and each is a rule taken from the service it replaces.
 *
 * It does not invent facts. Every field is computed from the tender's own
 * columns or left empty. An unstated value is unstated, and absences are
 * reported through `missing_information` so somebody resolves them rather than
 * reading past a plausible number nobody can source.
 *
 * It does not write prose. `summary` is assembled from the tender's own words
 * and the computed score. That paragraph sits at the top of a bid decision and
 * a fluent sentence smoothing over a missing budget is worse than a blunt one
 * naming it. There is no model call here at all.
 *
 * It does not pretend to predict. `win_probability` stays 0 until this database
 * holds MIN_HISTORY decided bids, and says so in `reasons` rather than printing
 * a percentage drawn from nothing. It currently holds none.
 */

import { CAPABILITIES, PERFECT_FIT } from "./normalize.ts"

/**
 * Which build of the scoring produced a row.
 *
 * The reason `ai_analysis` keeps rows rather than overwriting them: a score is
 * only interpretable next to the thing that produced it, and "the score fell"
 * is a different fact from "the model changed".
 *
 * 2.0.0 and not 1.2.0 because the method changed, not a weight -- the Python
 * NLP layer gave way to the capability map this sync already runs. Raise the
 * minor for a tuned weight or a new term in CAPABILITIES; raise the major for
 * a change of method. EITHER WAY, RAISING IT IS WHAT RE-SCORES THE REGISTER:
 * `writeAnalyses` skips any tender that already has a row at the current
 * version, so an edit to CAPABILITIES reaches existing tenders only when this
 * string changes with it.
 */
export const ANALYSIS_VERSION = "2.0.0"

/**
 * Thresholds, read off the scale rather than picked.
 *
 * A perfect fit is the two heaviest capabilities together (MEL and training,
 * 10 + 10 of an 18-point ceiling), so one flagship service matched squarely
 * scores about 56 -- and a threshold of 60 would rank the firm's own core work
 * as "consider". These were 60/25 on the Python side until a test on a pure MEL
 * tender showed exactly that.
 */
const PURSUE_AT = 50
const DECLINE_BELOW = 25

/**
 * Decided bids needed before a win probability means anything.
 *
 * This firm has tens of bids, not thousands. A 78% drawn from two similar bids
 * is a coin toss with a decimal point on it, and saying "insufficient history"
 * is the only honest output below the floor.
 */
const MIN_HISTORY = 5

/** A tender, as much of it as the scoring reads. */
export interface AnalysableRow {
  id: string
  title: string | null
  org: string | null
  notes: string | null
  deadline: string | null
  value: number | null
  service_areas: string | null
  tender_text: string | null
  notice_text: string | null
  status: string | null
}

export interface MatchedCapability {
  service: string
  score: number
  matched_terms: string[]
}

/** Everything a row of `ai_analysis` needs, minus the tender it belongs to. */
export interface AnalysisPayload {
  summary: string
  score: number
  win_probability: number
  recommendation: string
  keywords: string[]
  themes: string[]
  matched_capabilities: MatchedCapability[]
  requirements: string[]
  risks: string[]
  missing_information: string[]
  similar_bids: Array<{ rfp_id: string; title: string; status: string; similarity: number }>
  reasons: string[]
  model_version: string
  source_kind: string
}

/** Everything the scoring may read, in one lowercased string. */
function haystackOf(row: AnalysableRow): string {
  return [row.title, row.org, row.notes, row.notice_text, row.tender_text]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

/**
 * Which capabilities this tender touches, and the words that said so.
 *
 * The matched terms are carried rather than discarded because they are the
 * answer to "why did it score that?", and a score nobody can interrogate is a
 * score nobody trusts. Per-capability score is that capability's weight against
 * the same ceiling the total uses, so the parts are read on the scale of the
 * whole.
 */
export function matchedCapabilitiesFor(row: AnalysableRow): MatchedCapability[] {
  const haystack = haystackOf(row)
  if (!haystack.trim()) return []

  return CAPABILITIES.flatMap((capability) => {
    const matched = capability.terms.filter((term) => haystack.includes(term))
    if (matched.length === 0) return []
    return [{
      service: capability.label,
      score: Math.min(100, Math.round((capability.weight / PERFECT_FIT) * 100)),
      // Capped: a tender naming a capability twenty ways is not twenty times
      // the evidence, and the list is read by a person.
      matched_terms: matched.slice(0, 8),
    }]
  })
}

/**
 * Obligations stated in the tender's own words.
 *
 * Deterministic and quotative on purpose -- it lifts sentences that carry a
 * modal, it does not summarise them. Most rows in this register are short
 * notices with no attached document, so this is usually empty, and an empty
 * requirements panel on an analysed tender is a finding rather than a blank.
 */
function requirementsFrom(row: AnalysableRow): string[] {
  const source = [row.tender_text, row.notice_text, row.notes].filter(Boolean).join(" ")
  if (!source.trim()) return []

  const MODALS = /\b(must|shall|should|required|mandatory|submit|include|provide)\b/i
  return source
    .split(/(?<=[.?!])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    // Short fragments are headings and list bullets rather than obligations;
    // very long ones are whole paragraphs that happen to contain a "should".
    .filter((sentence) => sentence.length >= 30 && sentence.length <= 320)
    .filter((sentence) => MODALS.test(sentence))
    .slice(0, 8)
}

/** What this tender does not say, and somebody will have to find out. */
function missingFrom(row: AnalysableRow, themes: string[]): string[] {
  const missing: string[] = []
  if (!row.deadline) missing.push("No closing date is recorded, so this cannot be scheduled.")
  if (row.value === null) missing.push("No contract value is stated.")
  if (!row.tender_text?.trim()) {
    missing.push(
      "Only the published notice was read. No Terms of Reference is attached, so scope, deliverables and evaluation criteria are unknown.",
    )
  }
  if (themes.length === 0) {
    missing.push(
      "Nothing in this notice matched the capability statement; it may be filed under the wrong service area.",
    )
  }
  return missing
}

/** What makes this hard to win or hard to deliver, from what is on the row. */
function risksFrom(row: AnalysableRow, score: number): string[] {
  const risks: string[] = []

  if (score < DECLINE_BELOW) {
    risks.push(`Capability match is ${score}%, below the ${DECLINE_BELOW}% at which this is worth declining.`)
  }
  if (row.deadline) {
    const days = Math.ceil((Date.parse(`${row.deadline}T23:59:59Z`) - Date.now()) / 86_400_000)
    if (!Number.isNaN(days) && days >= 0 && days <= 7) {
      risks.push(`Closes in ${days} day${days === 1 ? "" : "s"} - too little time to assemble a full response.`)
    }
  }
  if (!row.tender_text?.trim()) {
    risks.push("Scored from the notice headline alone; the attached document, if any, has not been read.")
  }
  return risks
}

/**
 * Past bids this most resembles.
 *
 * Shared capability labels, as a Jaccard ratio. Nearest-neighbour and nothing
 * cleverer, because the population is tens of bids: anything that looks like
 * training is fitting noise. Empty until bids are marked Won or Lost, which is
 * the state this database is in.
 */
function similarTo(
  themes: string[],
  decided: Array<{ id: string; title: string; status: string; themes: string[] }>,
): AnalysisPayload["similar_bids"] {
  if (themes.length === 0) return []
  const mine = new Set(themes)

  return decided
    .map((bid) => {
      const theirs = new Set(bid.themes)
      const shared = [...mine].filter((theme) => theirs.has(theme)).length
      const union = new Set([...mine, ...theirs]).size
      return {
        rfp_id: bid.id,
        title: bid.title,
        status: bid.status,
        similarity: union === 0 ? 0 : Math.round((shared / union) * 100),
      }
    })
    .filter((bid) => bid.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5)
}

/**
 * One reading of one tender.
 *
 * `decided` is the history the win probability would be drawn from. It is
 * passed in rather than fetched so the whole batch shares one query, and so
 * this function stays pure and testable.
 */
export function analyse(
  row: AnalysableRow,
  decided: Array<{ id: string; title: string; status: string; themes: string[] }> = [],
): AnalysisPayload {
  const matched = matchedCapabilitiesFor(row)
  const themes = matched.map((capability) => capability.service)

  // Deliberately the same arithmetic as scoreFit: summed weights against the
  // ceiling. Recomputed here rather than read off rfps.fit_score so a row whose
  // tags predate a capability change is still scored on today's map.
  const haystack = haystackOf(row)
  const weight = CAPABILITIES
    .filter((capability) => capability.terms.some((term) => haystack.includes(term)))
    .reduce((sum, capability) => sum + capability.weight, 0)
  const score = Math.min(100, Math.round((weight / PERFECT_FIT) * 100))

  const recommendation = score >= PURSUE_AT ? "Pursue" : score >= DECLINE_BELOW ? "Consider" : "Decline"

  const keywords = [...new Set(matched.flatMap((capability) => capability.matched_terms))]
    .map((term) => term.trim())
    .slice(0, 20)

  const reasons: string[] = matched.map(
    (capability) =>
      `${capability.service}: matched ${capability.matched_terms.map((term) => `"${term.trim()}"`).join(", ")}.`,
  )
  if (matched.length === 0) {
    reasons.push("No term in the capability statement appears in this tender.")
  }
  reasons.push(
    decided.length < MIN_HISTORY
      ? `Win probability is not reported: this database holds ${decided.length} decided bid(s), and ${MIN_HISTORY} is the floor below which a percentage would be invented.`
      : `Win probability drawn from ${decided.length} decided bid(s).`,
  )

  // Assembled from the row, never generated. Each clause is a fact already on
  // the record; the only thing added is the arithmetic.
  const summary = [
    `${row.title ?? "Untitled tender"}${row.org ? `, issued by ${row.org}` : ""}.`,
    themes.length
      ? `Matches ${themes.join(", ")} - a ${score}% capability fit.`
      : `Nothing in it matches the capability statement (${score}%).`,
    `Recommendation: ${recommendation.toLowerCase()}.`,
    row.deadline ? `Closes ${row.deadline}.` : "No closing date recorded.",
  ].join(" ")

  return {
    summary,
    score,
    // Zero, and `reasons` says why. See MIN_HISTORY.
    win_probability: 0,
    recommendation,
    keywords,
    themes,
    matched_capabilities: matched,
    requirements: requirementsFrom(row),
    risks: risksFrom(row, score),
    missing_information: missingFrom(row, themes),
    similar_bids: similarTo(themes, decided),
    reasons,
    model_version: ANALYSIS_VERSION,
    source_kind: row.tender_text?.trim() ? "notice+tor" : "notice",
  }
}
