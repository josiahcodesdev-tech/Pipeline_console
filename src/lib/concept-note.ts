import { supabase } from './supabase'
import type { Consultant } from './types'

/** What the drafter is told about each consultant. Mirrors the roster block. */
export type ConsultantBrief = Omit<Consultant, 'id' | 'longBio'>

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
  /** The people available to staff this bid. Proposals only. */
  consultants?: ConsultantBrief[]
  kind: DraftKind
  org: string
  segment: string
  country?: string
  contactRole?: string
  notes?: string
  rfpTitle?: string
  deadline?: string
  /** Drives which assignment playbook the server writes against. */
  serviceAreas?: string
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
  /**
   * Which assignment playbooks the server matched this tender to. Reported so a
   * draft written against the wrong method is diagnosable rather than just
   * disappointing.
   */
  playbooks: string[]
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
    playbooks?: string[]
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

  return {
    text: data.text,
    truncated: Boolean(data.truncated),
    playbooks: data.playbooks ?? [],
  }
}

/**
 * Same draft, streamed.
 *
 * `functions.invoke` buffers the whole response before resolving, which is
 * exactly wrong when the point is to watch the document being written — a full
 * proposal is 8,000 tokens and the better part of a minute of nothing. So this
 * goes to the function URL directly and reads the body as it arrives.
 *
 * `onDelta` is called with each fragment of text, in order. The promise
 * resolves once with the finished document, so callers that also need the whole
 * thing (to save it, to export it) do not have to accumulate it themselves.
 */
export async function draftConceptNoteStreaming(
  context: ConceptNoteContext,
  onDelta: (chunk: string, soFar: string) => void,
): Promise<DraftResult> {
  const base = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  const what = context.kind === 'proposal' ? 'proposal' : 'concept note'

  // The function verifies the caller, so it needs this user's token rather than
  // the anon key. invoke() would have attached it for us.
  const { data: session } = await supabase.auth.getSession()
  const accessToken = session.session?.access_token
  if (!accessToken) throw new Error('You are signed out. Sign in and try again.')

  let response: Response
  try {
    response = await fetch(`${base}/functions/v1/concept-note`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...context, stream: true }),
    })
  } catch {
    throw new Error(`Could not reach the drafting service to draft the ${what}.`)
  }

  if (!response.ok || !response.body) {
    // A failure before the first byte is still a normal JSON error response.
    const detail = await response
      .json()
      .then((body: { error?: string }) => body?.error)
      .catch(() => null)
    throw new Error(
      detail ??
        `Could not draft the ${what} (${response.status}). Check that the concept-note function is deployed and OPENAI_API_KEY is set.`,
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let truncated = false
  let playbooks: string[] = []
  let failure: string | null = null
  let finished = false

  const handle = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    let event: { type?: string; text?: string; message?: string; truncated?: boolean; playbooks?: string[] }
    try {
      event = JSON.parse(trimmed)
    } catch {
      return // A partial line; the next read completes it.
    }
    if (event.type === 'delta' && event.text) {
      text += event.text
      onDelta(event.text, text)
    } else if (event.type === 'meta') {
      playbooks = event.playbooks ?? []
    } else if (event.type === 'done') {
      truncated = Boolean(event.truncated)
      finished = true
    } else if (event.type === 'error') {
      failure = event.message ?? 'The drafting service failed.'
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // Newline-delimited: everything before the last newline is complete, and
    // whatever follows it is a partial line to carry into the next read.
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const raw of lines) handle(raw)
  }
  handle(buffer)

  if (failure) throw new Error(failure)
  // The stream ending without a `done` event means the connection dropped
  // mid-document. Whatever arrived is incomplete, and saying so beats handing
  // over a proposal that stops mid-sentence as though it were finished.
  if (!finished && !text.trim()) {
    throw new Error(`The drafting service returned an empty ${what}.`)
  }

  return { text, truncated: truncated || !finished, playbooks }
}
