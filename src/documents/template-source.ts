import type { TemplateConfig } from './template-slots'

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
}

/** A template with its markup and its reading rules, ready to fill. */
export interface LoadedTemplate {
  name: string
  html: string
  config: TemplateConfig
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
 * Words worth matching a template's name against.
 *
 * Deliberately crude, and deliberately not the server's `selectUploadedTemplate`
 * — that scores a template's full text, which here would mean downloading every
 * one of them to choose between them. With a single template in the folder the
 * choice is not being made at all; this exists so that adding a second one picks
 * the closer of the two rather than always the alphabetically first.
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
  const entries = await listProposalTemplates()
  if (entries.length === 0) {
    throw new Error(
      'No proposal template is available. Add one to proposal-templates/ and rebuild.',
    )
  }

  const wanted = new Set(tokens(assignment))
  const chosen =
    entries.length === 1
      ? entries[0]
      : entries
          .map((entry) => ({
            entry,
            score: tokens(entry.name).filter((word) => wanted.has(word)).length,
          }))
          .sort((a, b) => b.score - a.score)[0].entry

  return load(chosen)
}
