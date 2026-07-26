import { supabase } from './supabase'

/**
 * Context the Edge Function turns into a concept-note draft. Deliberately
 * structured rather than a pre-baked prompt string: the prompt lives on the
 * server so it can be tuned without shipping a new bundle, and so a browser
 * cannot rewrite it.
 */
export interface ConceptNoteContext {
  org: string
  segment: string
  country?: string
  contactRole?: string
  notes?: string
  rfpTitle?: string
}

/**
 * Calls the `concept-note` Edge Function. The Anthropic key lives only in that
 * function's secrets — the browser never sees it and never talks to
 * api.anthropic.com directly.
 */
export async function draftConceptNote(
  context: ConceptNoteContext,
): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ text?: string; error?: string }>(
    'concept-note',
    { body: context },
  )

  if (error) {
    throw new Error(
      `Draft failed: ${error.message}. Check that the concept-note function is deployed and ANTHROPIC_API_KEY is set.`,
    )
  }
  if (data?.error) throw new Error(data.error)
  if (!data?.text) throw new Error('The drafting service returned an empty response.')

  return data.text
}
