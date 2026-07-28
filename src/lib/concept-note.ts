import { supabase } from './supabase'

/**
 * Context the Edge Function turns into a concept-note draft. Deliberately
 * structured rather than a pre-baked prompt string: the prompt lives on the
 * server so it can be tuned without shipping a new bundle, and so a browser
 * cannot rewrite it.
 */
/**
 * Which document to draft.
 *
 * A lead gets a *concept note* — unsolicited outreach that has to justify its
 * own relevance. An RFP gets a *proposal*, which answers a brief that already
 * exists, so it leads with the response rather than the introduction.
 */
export type DraftKind = 'concept-note' | 'proposal'

/**
 * How many worked examples to send. Every one is included in full on every
 * draft, so this is a cost ceiling as much as a quality one — two is enough to
 * establish a voice, and past that the marginal example mostly buys tokens.
 */
export const MAX_EXEMPLARS = 2

/**
 * Longest example sent, in characters. A 700-word proposal is roughly 5,000,
 * so this fits a full one while stopping a pasted 40-page bid from dominating
 * the prompt.
 */
export const MAX_EXEMPLAR_CHARS = 12_000

export interface ConceptNoteContext {
  kind: DraftKind
  org: string
  segment: string
  country?: string
  contactRole?: string
  notes?: string
  rfpTitle?: string
  deadline?: string
  /** House rules for this kind of document. */
  guidance?: string
  /** Organisation facts reused verbatim. */
  boilerplate?: string
  /** Worked examples to imitate. */
  examples?: string[]
}

/** UI labels, so the dialog and the buttons never disagree. */
export const DRAFT_LABELS: Record<
  DraftKind,
  { title: string; action: string; loading: string }
> = {
  'concept-note': {
    title: 'Concept note draft',
    action: 'Draft concept note',
    loading: 'Drafting concept note…',
  },
  proposal: {
    title: 'Proposal draft',
    action: 'Draft proposal',
    loading: 'Drafting proposal…',
  },
}

export interface DraftResult {
  text: string
  /** True when the model hit the token ceiling and the draft is cut short. */
  truncated: boolean
}

/**
 * Calls the `concept-note` Edge Function. The OpenAI key lives only in that
 * function's secrets — the browser never sees it and never talks to
 * api.openai.com directly.
 */
export async function draftConceptNote(
  context: ConceptNoteContext,
): Promise<DraftResult> {
  const { data, error } = await supabase.functions.invoke<{
    text?: string
    truncated?: boolean
    error?: string
  }>('concept-note', { body: context })

  if (error) {
    const what = context.kind === 'proposal' ? 'proposal' : 'concept note'
    throw new Error(
      `Could not draft the ${what}: ${error.message}. Check that the concept-note function is deployed and OPENAI_API_KEY is set.`,
    )
  }
  if (data?.error) throw new Error(data.error)
  if (!data?.text) throw new Error('The drafting service returned an empty response.')

  return { text: data.text, truncated: Boolean(data.truncated) }
}
