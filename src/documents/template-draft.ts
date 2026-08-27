import {
  contentOf,
  sectionBriefs,
  sectionsOf,
  type SectionBrief,
  type TemplateConfig,
} from './template-slots'
import { fillTemplate, type FillResult } from './template-fill'
import {
  loadProposalTemplate,
  loadProposalTemplateByName,
  type LoadedTemplate,
} from './template-source'
import {
  draftTemplateSection,
  type ConceptNoteContext,
  type SlotBrief,
} from '@/services/concept-note'
import type { ProposalDesign } from '@/domain/types'

/**
 * Writing a bid into the firm's designed proposal.
 *
 * The whole flow, in one place: fetch the template, read it as a list of words
 * to replace, ask the drafter for one section at a time, and write the answers
 * back into the markup that was never touched. What comes out is the house
 * document — same stylesheet, same layout, same institutional images — carrying
 * this tender's content instead of the last one's.
 *
 * WHY SECTION AT A TIME. The house template holds three hundred-odd slots. As
 * one call that is a prompt no model holds coherently and a reply that fails
 * whole; as nineteen it is nineteen briefs a drafter can actually answer, and a
 * section that fails costs one section. The server counts these against a
 * separate, larger hourly allowance for exactly this reason.
 *
 * WHAT IT WILL NOT DO. Invent evidence to fill a slot. Where a section needs a
 * figure the bid does not have, the drafter writes the honest marker and it
 * lands in the document as a marker. That is the point: a placeholder somebody
 * has to resolve beats a confident number nobody can source.
 */

/** How many sections are written at once. */
const CONCURRENCY = 3

/**
 * Most slots in one call.
 *
 * The server caps this at 120 and would silently drop the rest, which would
 * leave the tail of a long section holding the previous client's wording while
 * reporting success. Chunking below the cap means the caller decides where the
 * split falls rather than discovering it.
 */
const MAX_SLOTS_PER_CALL = 80

/** Attempts per chunk. One retry, because these fail on timeouts as often as anything. */
const ATTEMPTS = 2

export interface DraftProgress {
  /** Chunks finished, successfully or not. */
  done: number
  total: number
  /** The section just finished, for a line of running commentary. */
  label: string
  failed: boolean
}

export interface TemplateDraftResult extends FillResult {
  /** Which template was filled, so a draft is traceable to the file. */
  templateName: string
  /** Sections that could not be written, with why. These keep template wording. */
  failures: Array<{ section: string; reason: string }>
  /** Slots asked for that never came back, across every section. */
  missingIds: string[]
  /** How many slots the template holds in total. */
  slotCount: number
  /** What was written, keyed by slot id. This is what a draft stores. */
  values: Record<string, string>
  /** The same proposal as plain text, for reading, search and model answers. */
  text: string
  /** Which assignment playbooks the tender was matched to. */
  playbooks: string[]
}

function briefsOf(section: SectionBrief): SlotBrief[] {
  return section.slots.map((slot) => ({
    id: slot.id,
    kind: slot.kind,
    original: slot.original,
    budget: slot.budget,
  }))
}

/**
 * The four fields a rebuilt consultant page is made of.
 *
 * These have no slot in the template because what they replace was a picture —
 * a full-page render of a profile, credentials and a role panel, flattened into
 * one JPEG. template-fill rebuilds the page from `<section>.role` and friends;
 * without this, nothing ever asks for those, and every proposal ships two
 * consultant pages reading "[INSERT VERIFIED CONSULTANT RECORD]".
 *
 * Kept in step with `consultantSection` in template-fill by these key names.
 */
const CONSULTANT_FIELDS: ReadonlyArray<{ key: string; label: string; budget: number }> = [
  { key: 'role', label: 'Role in this assignment', budget: 420 },
  { key: 'credentials', label: 'Qualifications', budget: 380 },
  { key: 'experience', label: 'Relevant experience', budget: 520 },
  { key: 'availability', label: 'Availability and status', budget: 260 },
]

function matches(patterns: string[] | undefined, alt: string): boolean {
  return (patterns ?? []).some((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(alt)
    } catch {
      return false
    }
  })
}

/**
 * Extra briefs for the sections whose image is really a page.
 *
 * Addressed by `section.page` id rather than by position, because that is what
 * template-fill reads when it rebuilds them — see `consultantSection`.
 */
function consultantBriefs(
  html: string,
  config: LoadedTemplate['config'],
): Map<string, SlotBrief[]> {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const extra = new Map<string, SlotBrief[]>()

  for (const image of Array.from(parsed.querySelectorAll('img'))) {
    if (!matches(config.rebuildAsTextImages, image.getAttribute('alt') ?? '')) continue
    const id = image.closest('section.page')?.getAttribute('id')
    if (!id || extra.has(id)) continue
    extra.set(
      id,
      CONSULTANT_FIELDS.map((field) => ({
        id: `${id}.${field.key}`,
        kind: 'card-body',
        // No previous wording to show the register — the page it replaces was a
        // picture. The label is what the card will be headed, which is the next
        // best statement of what belongs there.
        original: field.label,
        budget: field.budget,
      })),
    )
  }

  return extra
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size))
  }
  return out
}

/**
 * Runs `work` over `items`, `limit` at a time, in order of completion.
 *
 * A plain `Promise.all` over nineteen sections opens nineteen model calls at
 * once and is rejected by the drafting service before half of them start.
 */
async function pool<T>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      await work(items[index], index)
    }
  })
  await Promise.all(runners)
}

export interface DraftIntoTemplateOptions {
  /** Everything the drafter is told about the bid. `kind` is set here. */
  context: Omit<ConceptNoteContext, 'kind'>
  /** What the finished document calls itself, and who it is for. */
  document: { title: string; client: string }
  /** Loaded ahead of time when the caller wants to report which template. */
  template?: LoadedTemplate
  onProgress?: (progress: DraftProgress) => void
}

export async function draftIntoTemplate({
  context,
  document,
  template,
  onProgress,
}: DraftIntoTemplateOptions): Promise<TemplateDraftResult> {
  const loaded =
    template ??
    (await loadProposalTemplate(
      [
        context.rfpTitle,
        context.serviceAreas,
        context.notes,
        context.analysis,
        context.tenderText,
      ]
        .filter(Boolean)
        .join(' '),
    ))

  // The consultant pages, whose fields exist in the rebuilt markup rather than
  // in the template, and so are invisible to the extractor. Resolved before the
  // filter below: a page that is nothing but a rendered profile has no text
  // slots at all, and dropping it would leave it as a placeholder.
  const consultants = consultantBriefs(loaded.html, loaded.config)

  const sections = sectionBriefs(loaded.html, loaded.config).filter(
    (section) => section.slots.length > 0 || consultants.has(section.id),
  )
  if (sections.length === 0) {
    throw new Error(
      `"${loaded.name}" has no fillable text. Run \`npm run templates:check\` to see how it is being read.`,
    )
  }

  // Flattened before dispatch so the progress count is the number of calls that
  // will actually be made, not the number of sections. A long section is two
  // calls and should look like two.
  const jobs = sections.flatMap((section) =>
    chunk(
      [...briefsOf(section), ...(consultants.get(section.id) ?? [])],
      MAX_SLOTS_PER_CALL,
    ).map((slots, part, parts) => ({
      title: parts.length > 1 ? `${section.title} (${part + 1}/${parts.length})` : section.title,
      section: section.title,
      slots,
    })),
  )

  const values = new Map<string, string>()
  const failures: TemplateDraftResult['failures'] = []
  const missingIds: string[] = []
  // Identical on every call — the server matches them from the tender, not from
  // the section — so the first answer is as good as all of them.
  let playbooks: string[] = []
  let done = 0

  await pool(jobs, CONCURRENCY, async (job) => {
    let reason = ''
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const fill = await draftTemplateSection(
          { ...context, kind: 'proposal-section' },
          { title: job.title },
          job.slots,
        )
        for (const value of fill.values) values.set(value.id, value.text)
        missingIds.push(...fill.missing)
        if (playbooks.length === 0) playbooks = fill.playbooks
        reason = ''
        break
      } catch (cause) {
        reason = cause instanceof Error ? cause.message : String(cause)
      }
    }

    done += 1
    if (reason) failures.push({ section: job.title, reason })
    onProgress?.({ done, total: jobs.length, label: job.title, failed: Boolean(reason) })
  })

  // Filled even when sections failed. A document missing three sections is
  // something to finish; nothing at all is something to start again, and the
  // sixteen that were written cost the same either way. `unfilled` names every
  // slot still holding the template's own words, which is what the caller warns
  // about.
  const result = fillTemplate(loaded.html, values, document, loaded.config)

  return {
    ...result,
    templateName: loaded.name,
    failures,
    missingIds,
    slotCount: sections.reduce((total, section) => total + section.slots.length, 0),
    values: Object.fromEntries(values),
    text: proposalText(result.html, loaded.config),
    playbooks,
  }
}

/**
 * The filled proposal as plain text.
 *
 * Read out of the finished document rather than assembled from the values, so
 * it carries the section order and the headings the reader actually sees — and
 * so the two can never describe different documents.
 *
 * This is what is stored on the draft: it is what the preview panel shows, what
 * a starred model answer teaches the drafter, and the only part that still means
 * something if the template it was written into is one day deleted.
 */
export function proposalText(html: string, config: TemplateConfig = {}): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  return sectionsOf(parsed, config)
    .map((section) =>
      (contentOf(section, config).textContent ?? '')
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n'),
    )
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Rebuilds a saved proposal from the template it was written into.
 *
 * The counterpart to storing answers rather than markup: this is what "Open"
 * runs. It reads the template as it stands today, so a correction to the house
 * design reaches every proposal already written — and so a template that has
 * been renamed or removed fails here, loudly, rather than rendering the wrong
 * document.
 */
export async function renderDesignedProposal(
  design: ProposalDesign,
  document: { title: string; client: string },
): Promise<FillResult> {
  const loaded = await loadProposalTemplateByName(design.template)
  return fillTemplate(
    loaded.html,
    new Map(Object.entries(design.values)),
    document,
    loaded.config,
  )
}
