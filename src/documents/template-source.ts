import { sectionBriefs, type TemplateConfig } from './template-slots'

/**
 * Fetching the firm's designed template into the browser.
 *
 * The drafter fills the template client-side — it parses the markup, holds it,
 * and writes the answers back into the elements it already has — so the raw
 * file has to arrive over the network rather than being compiled into anything.
 * The Edge Function's copy is plain text and is a different thing for a
 * different job: it shows the drafter a structure to imitate when writing
 * Markdown. This one *is* the document.
 *
 * Served by the `proposal-templates` plugin in vite.config.ts, from the same
 * folder anybody edits. There is deliberately no second copy: a template that
 * has to be copied somewhere to take effect is a template that will be edited
 * in the wrong place.
 */

const ROOT = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/proposal-templates`

/** One template as the manifest lists it. */
export interface TemplateEntry {
  name: string
  /** File name of the markup, relative to the templates folder. */
  html: string
  /** Its sidecar config, when it has one. */
  config: string | null
  /** Title, headings and configured matching terms extracted at build time. */
  matchText?: string
  /**
   * Whether the design has any words to replace. Computed at build time; see
   * `hasFillableText` in vite.config.ts.
   *
   * Optional so a manifest built before this existed reads as fillable rather
   * than leaving nothing selectable at all.
   */
  fillable?: boolean
}

/** A template with its markup and its reading rules, ready to fill. */
export interface LoadedTemplate {
  name: string
  html: string
  config: TemplateConfig
}

export interface TemplateRecommendation {
  template: LoadedTemplate
  /** Weighted relevance score; zero means the named fallback was used. */
  score: number
  /** Tender words that also occur in the template's selection evidence. */
  matchedTerms: string[]
  candidateCount: number
}

async function fetchText(file: string, what: string): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${ROOT}/${file}`)
  } catch {
    throw new Error(`Could not reach the ${what}. Check that the app is being served, not opened from a file.`)
  }
  if (!response.ok) {
    throw new Error(
      `Could not load the ${what} (${response.status}). It should be in proposal-templates/ — rebuild the app if it was added since the last deploy.`,
    )
  }
  return response.text()
}

/** Every template the build is serving. */
export async function listProposalTemplates(): Promise<TemplateEntry[]> {
  const body = await fetchText('index.json', 'proposal template list')
  const parsed = JSON.parse(body) as { templates?: TemplateEntry[] }
  return parsed.templates ?? []
}

/**
 * Words worth matching a template's name and structural clues against.
 *
 * The manifest carries only titles, headings, metadata and configured matching
 * terms, so selecting among several image-heavy designs does not download all
 * of them. The chosen template alone is fetched.
 */
const NOISE = new Set([
  'and', 'for', 'the', 'proposal', 'template', 'technical', 'draft', 'final',
  'with', 'from', 'this', 'that', 'ministry', 'of',
])

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !NOISE.has(word))
}

async function load(entry: TemplateEntry): Promise<LoadedTemplate> {
  const [html, configText] = await Promise.all([
    fetchText(entry.html, `proposal template "${entry.name}"`),
    entry.config
      ? fetchText(entry.config, `configuration for "${entry.name}"`)
      : Promise.resolve('{}'),
  ])

  let config: TemplateConfig
  try {
    config = JSON.parse(configText) as TemplateConfig
  } catch {
    // A broken sidecar must not be read as "this template needs no config" —
    // that ships the previous client's name in the browser tab and the footer,
    // and the proposal itself reads perfectly.
    throw new Error(
      `The configuration file for "${entry.name}" is not valid JSON. Fix it before drafting.`,
    )
  }

  return { name: entry.name, html, config }
}

/**
 * One named template, for rebuilding a proposal that was written into it.
 *
 * A saved draft names the template it used, and the document is rebuilt from
 * whatever that file says today. Renaming or deleting a template therefore
 * breaks proposals written into it, which is why this says which one is missing
 * rather than falling back to another: a proposal silently re-rendered in a
 * different design is worse than one that cannot be opened.
 */
export async function loadProposalTemplateByName(name: string): Promise<LoadedTemplate> {
  const entries = await listProposalTemplates()
  const entry = entries.find((candidate) => candidate.name === name)
  if (!entry) {
    throw new Error(
      `The template "${name}" this proposal was written into is no longer in proposal-templates/.`,
    )
  }
  return load(entry)
}

/**
 * The template to write this bid into.
 *
 * `assignment` is whatever describes the work — the tender's title, its service
 * areas, the stored reading. Ignored when only one template exists, which is the
 * ordinary case.
 *
 * Fails loudly with nothing to fill rather than falling back to a plain
 * document: silently writing Markdown when the designed proposal was asked for
 * is how somebody sends a client an unbranded page and finds out afterwards.
 */
export async function loadProposalTemplate(assignment = ''): Promise<LoadedTemplate> {
  return (await recommendProposalTemplate(assignment)).template
}

/** Rank every available design and return the best one with user-facing evidence. */
export async function recommendProposalTemplate(
  assignment = '',
): Promise<TemplateRecommendation> {
  const entries = await listProposalTemplates()
  if (entries.length === 0) {
    throw new Error(
      'No proposal template is available. Add one to proposal-templates/ and rebuild.',
    )
  }

  // Designs with nothing to replace, dropped before they are ranked.
  //
  // The loop below already refuses a template with no slots, so this is not
  // what makes the choice correct — it is what makes it cheap. One of these is
  // a proposal rasterised into eighteen page images: ten megabytes fetched and
  // parsed to discover it holds no words, on the way to picking something else.
  //
  // `!== false` rather than `=== true`, so a manifest built before the flag
  // existed leaves every template in the running rather than none.
  const usable = entries.filter((entry) => entry.fillable !== false)
  const candidates = usable.length > 0 ? usable : entries

  const wanted = new Set(tokens(assignment))
  const ranked =
    candidates.length === 1
      ? [{ entry: candidates[0], score: 0, fallback: false, matchedTerms: [] as string[] }]
      : candidates
          .map((entry) => ({
            entry,
            score:
              tokens(entry.name).filter((word) => wanted.has(word)).length * 12 +
              new Set(tokens(entry.matchText ?? '').filter((word) => wanted.has(word))).size * 4,
            fallback: /(^|[_\s-])(default|general|master)([_\s-]|$)/i.test(entry.name),
            matchedTerms: Array.from(
              new Set(tokens(`${entry.name} ${entry.matchText ?? ''}`).filter((word) => wanted.has(word))),
            ).slice(0, 8),
          }))
          .sort(
            (a, b) =>
              b.score - a.score ||
              Number(b.fallback) - Number(a.fallback) ||
              a.entry.name.localeCompare(b.entry.name),
          )

  let chosen: (typeof ranked)[number] | undefined
  let template: LoadedTemplate | undefined
  for (const candidate of ranked) {
    const loaded = await load(candidate.entry)
    if (sectionBriefs(loaded.html, loaded.config).some((section) => section.slots.length > 0)) {
      chosen = candidate
      template = loaded
      break
    }
  }
  if (!chosen || !template) {
    throw new Error(
      'None of the available proposal templates contains fillable text. Run `npm run templates:check` and configure the uploaded files.',
    )
  }
  return {
    template,
    score: chosen.score,
    matchedTerms: chosen.matchedTerms,
    candidateCount: candidates.length,
  }
}
